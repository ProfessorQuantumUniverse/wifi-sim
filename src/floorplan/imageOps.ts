/**
 * Raster operations for turning a scanned architectural drawing into a clean
 * binary wall mask. Everything here works on plain typed arrays so it can run
 * inside a worker and be transferred back without a copy.
 */

export interface GrayWeights {
  r: number
  g: number
  b: number
}

/** Rec. ITU-R BT.709-6 luma coefficients, the default grayscale mix. */
export const REC709: GrayWeights = { r: 0.2126, g: 0.7152, b: 0.0722 }

/** Rec. ITU-R BT.601-7 luma coefficients, often better on blueprint scans. */
export const REC601: GrayWeights = { r: 0.299, g: 0.587, b: 0.114 }

export function toGray(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  w: GrayWeights,
): Float32Array {
  const n = width * height
  const out = new Float32Array(n)
  const sum = w.r + w.g + w.b
  const kr = w.r / sum
  const kg = w.g / sum
  const kb = w.b / sum
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    out[i] = kr * rgba[p] + kg * rgba[p + 1] + kb * rgba[p + 2]
  }
  return out
}

/**
 * Brightness / contrast / gamma, applied in that order.
 *
 * `brightness` and `contrast` are in [-100, 100]. The contrast factor is the
 * classic GIMP-style S-curve slope f = 259(C+255) / (255(259-C)); gamma is the
 * usual display-style power law out = 255 * (in/255)^(1/gamma).
 */
export function applyLevels(
  gray: Float32Array,
  brightness: number,
  contrast: number,
  gamma: number,
): Float32Array {
  const out = new Float32Array(gray.length)
  const c = Math.max(-100, Math.min(100, contrast))
  const f = (259 * (c + 255)) / (255 * (259 - c))
  const invGamma = 1 / Math.max(0.01, gamma)

  // 256-entry LUT: the transform is a pure function of the input level.
  const lut = new Float32Array(256)
  for (let i = 0; i < 256; i++) {
    let v = i + brightness * 2.55
    v = f * (v - 128) + 128
    v = Math.max(0, Math.min(255, v))
    lut[i] = 255 * Math.pow(v / 255, invGamma)
  }

  for (let i = 0; i < gray.length; i++) {
    const idx = gray[i] < 0 ? 0 : gray[i] > 255 ? 255 : gray[i] | 0
    out[i] = lut[idx]
  }
  return out
}

/**
 * Separable box blur, repeated `passes` times. Three passes converge to a
 * Gaussian (central limit); used to knock down scanner grain before threshold.
 */
export function boxBlur(
  src: Float32Array,
  width: number,
  height: number,
  radius: number,
  passes = 3,
): Float32Array {
  if (radius <= 0) return src.slice()
  let cur = src.slice()
  const tmp = new Float32Array(src.length)
  const win = 2 * radius + 1

  for (let p = 0; p < passes; p++) {
    // Horizontal.
    for (let y = 0; y < height; y++) {
      const row = y * width
      let acc = 0
      for (let x = -radius; x <= radius; x++) {
        acc += cur[row + Math.max(0, Math.min(width - 1, x))]
      }
      for (let x = 0; x < width; x++) {
        tmp[row + x] = acc / win
        const outIdx = Math.max(0, Math.min(width - 1, x - radius))
        const inIdx = Math.max(0, Math.min(width - 1, x + radius + 1))
        acc += cur[row + inIdx] - cur[row + outIdx]
      }
    }
    // Vertical.
    for (let x = 0; x < width; x++) {
      let acc = 0
      for (let y = -radius; y <= radius; y++) {
        acc += tmp[Math.max(0, Math.min(height - 1, y)) * width + x]
      }
      for (let y = 0; y < height; y++) {
        cur[y * width + x] = acc / win
        const outIdx = Math.max(0, Math.min(height - 1, y - radius))
        const inIdx = Math.max(0, Math.min(height - 1, y + radius + 1))
        acc += tmp[inIdx * width + x] - tmp[outIdx * width + x]
      }
    }
  }
  return cur
}

/**
 * Otsu's method: the global threshold maximising between-class variance.
 * Otsu, "A Threshold Selection Method from Gray-Level Histograms",
 * IEEE Trans. SMC 9(1), 1979.
 */
export function otsuThreshold(gray: Float32Array): number {
  const hist = new Float64Array(256)
  for (let i = 0; i < gray.length; i++) {
    const v = gray[i] < 0 ? 0 : gray[i] > 255 ? 255 : gray[i] | 0
    hist[v]++
  }
  const total = gray.length
  let sumAll = 0
  for (let t = 0; t < 256; t++) sumAll += t * hist[t]

  let sumB = 0
  let wB = 0
  let best = 0
  let bestVar = -1
  for (let t = 0; t < 256; t++) {
    wB += hist[t]
    if (wB === 0) continue
    const wF = total - wB
    if (wF === 0) break
    sumB += t * hist[t]
    const mB = sumB / wB
    const mF = (sumAll - sumB) / wF
    const between = wB * wF * (mB - mF) * (mB - mF)
    if (between > bestVar) {
      bestVar = between
      best = t
    }
  }
  return best
}

/** Integral image (summed-area table) with a zero-padded first row/column. */
function integralImage(gray: Float32Array, width: number, height: number): Float64Array {
  const iw = width + 1
  const out = new Float64Array(iw * (height + 1))
  for (let y = 0; y < height; y++) {
    let rowSum = 0
    for (let x = 0; x < width; x++) {
      rowSum += gray[y * width + x]
      out[(y + 1) * iw + (x + 1)] = out[y * iw + (x + 1)] + rowSum
    }
  }
  return out
}

/**
 * Binarise. Foreground (1) is the *dark* ink: walls, text, dimension lines,
 * because architectural scans are dark-on-light.
 *
 * `adaptive` uses a local mean over a (2r+1)^2 window minus an offset C, which
 * survives the uneven exposure typical of a flatbed scan of a large plan.
 */
export type ThresholdMode = 'manual' | 'otsu' | 'adaptive'

export function binarize(
  gray: Float32Array,
  width: number,
  height: number,
  mode: ThresholdMode,
  manualLevel: number,
  adaptiveRadius: number,
  adaptiveOffset: number,
): { mask: Uint8Array; effectiveLevel: number } {
  const n = width * height
  const mask = new Uint8Array(n)

  if (mode === 'adaptive') {
    const r = Math.max(1, adaptiveRadius | 0)
    const ii = integralImage(gray, width, height)
    const iw = width + 1
    for (let y = 0; y < height; y++) {
      const y0 = Math.max(0, y - r)
      const y1 = Math.min(height - 1, y + r)
      for (let x = 0; x < width; x++) {
        const x0 = Math.max(0, x - r)
        const x1 = Math.min(width - 1, x + r)
        const area = (x1 - x0 + 1) * (y1 - y0 + 1)
        const sum =
          ii[(y1 + 1) * iw + (x1 + 1)] -
          ii[y0 * iw + (x1 + 1)] -
          ii[(y1 + 1) * iw + x0] +
          ii[y0 * iw + x0]
        const mean = sum / area
        mask[y * width + x] = gray[y * width + x] < mean - adaptiveOffset ? 1 : 0
      }
    }
    return { mask, effectiveLevel: -1 }
  }

  const level = mode === 'otsu' ? otsuThreshold(gray) : manualLevel
  for (let i = 0; i < n; i++) mask[i] = gray[i] < level ? 1 : 0
  return { mask, effectiveLevel: level }
}

export interface Component {
  label: number
  area: number
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * 8-connected component labelling via an explicit stack (no recursion: these
 * images run to several megapixels).
 * Labels are 1-based; 0 means background.
 */
export function connectedComponents(
  mask: Uint8Array,
  width: number,
  height: number,
): { labels: Int32Array; components: Component[] } {
  const n = width * height
  const labels = new Int32Array(n)
  const components: Component[] = []
  const stack = new Int32Array(n)
  let next = 1

  for (let seed = 0; seed < n; seed++) {
    if (mask[seed] !== 1 || labels[seed] !== 0) continue
    const label = next++
    let sp = 0
    stack[sp++] = seed
    labels[seed] = label

    let area = 0
    let minX = width
    let minY = height
    let maxX = -1
    let maxY = -1

    while (sp > 0) {
      const p = stack[--sp]
      const px = p % width
      const py = (p / width) | 0
      area++
      if (px < minX) minX = px
      if (px > maxX) maxX = px
      if (py < minY) minY = py
      if (py > maxY) maxY = py

      for (let dy = -1; dy <= 1; dy++) {
        const ny = py + dy
        if (ny < 0 || ny >= height) continue
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = px + dx
          if (nx < 0 || nx >= width) continue
          const q = ny * width + nx
          if (mask[q] === 1 && labels[q] === 0) {
            labels[q] = label
            stack[sp++] = q
          }
        }
      }
    }

    components.push({ label, area, minX, minY, maxX, maxY })
  }

  return { labels, components }
}

/** Drop connected components smaller than `minArea` pixels (speckle, text dots). */
export function despeckle(
  mask: Uint8Array,
  width: number,
  height: number,
  minArea: number,
): Uint8Array {
  if (minArea <= 1) return mask.slice()
  const { labels, components } = connectedComponents(mask, width, height)
  const keep = new Uint8Array(components.length + 1)
  for (const c of components) if (c.area >= minArea) keep[c.label] = 1
  const out = new Uint8Array(mask.length)
  for (let i = 0; i < out.length; i++) out[i] = keep[labels[i]] === 1 ? 1 : 0
  return out
}

/** Pixel-wise `a AND NOT b`. */
export function subtract(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length)
  for (let i = 0; i < a.length; i++) out[i] = a[i] === 1 && b[i] === 0 ? 1 : 0
  return out
}

/** Rectangular crop of a mask into a new, smaller buffer. */
export function cropMask(
  mask: Uint8Array,
  width: number,
  rect: { x: number; y: number; w: number; h: number },
): Uint8Array {
  const out = new Uint8Array(rect.w * rect.h)
  for (let y = 0; y < rect.h; y++) {
    const src = (rect.y + y) * width + rect.x
    out.set(mask.subarray(src, src + rect.w), y * rect.w)
  }
  return out
}
