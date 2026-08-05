/**
 * Exact squared Euclidean distance transform.
 *
 * Felzenszwalb & Huttenlocher, "Distance Transforms of Sampled Functions",
 * Theory of Computing 8 (2012) 415-428. O(n) per dimension, separable.
 *
 * We use it for three things:
 *  - exact disk erosion/dilation (erosion by a disk of radius r keeps exactly the
 *    pixels whose distance to the background exceeds r), which makes morphology
 *    cost two EDT passes instead of a naive r^2 kernel sweep;
 *  - local stroke half-width, which is the distance transform value on the ridge;
 *  - wall thickness recovery during vectorisation.
 */

const INF = 1e20

/** 1-D lower envelope of parabolas. `f` in, `d` out, `v`/`z` are scratch buffers. */
function dt1d(
  f: Float64Array,
  d: Float64Array,
  v: Int32Array,
  z: Float64Array,
  n: number,
): void {
  let k = 0
  v[0] = 0
  z[0] = -INF
  z[1] = INF

  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    while (s <= z[k]) {
      k--
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
    }
    k++
    v[k] = q
    z[k] = s
    z[k + 1] = INF
  }

  k = 0
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++
    const dx = q - v[k]
    d[q] = dx * dx + f[v[k]]
  }
}

/**
 * Squared Euclidean distance from every pixel to the nearest pixel where
 * `mask[i] === seedValue`.
 *
 * Pass `seedValue = 0` to get "distance to background" (the inside-thickness
 * measure of a foreground stroke); pass `1` to get "distance to foreground".
 * Result is in squared pixels. Compare against `r * r` to avoid a sqrt.
 */
export function edtSquared(
  mask: Uint8Array,
  width: number,
  height: number,
  seedValue: 0 | 1,
): Float64Array {
  const n = width * height
  const out = new Float64Array(n)
  for (let i = 0; i < n; i++) out[i] = mask[i] === seedValue ? 0 : INF

  const maxDim = Math.max(width, height)
  const f = new Float64Array(maxDim)
  const d = new Float64Array(maxDim)
  const v = new Int32Array(maxDim)
  const z = new Float64Array(maxDim + 1)

  // Columns.
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = out[y * width + x]
    dt1d(f, d, v, z, height)
    for (let y = 0; y < height; y++) out[y * width + x] = d[y]
  }

  // Rows.
  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) f[x] = out[row + x]
    dt1d(f, d, v, z, width)
    for (let x = 0; x < width; x++) out[row + x] = d[x]
  }

  return out
}

/**
 * Erosion by a disk of radius `r`: keep foreground pixels whose distance to the
 * background is strictly greater than `r`. Exact, not an octagonal approximation.
 */
export function erodeDisk(
  mask: Uint8Array,
  width: number,
  height: number,
  r: number,
): Uint8Array {
  if (r <= 0) return mask.slice()
  const dist2 = edtSquared(mask, width, height, 0)
  const r2 = r * r
  const out = new Uint8Array(mask.length)
  for (let i = 0; i < out.length; i++) out[i] = dist2[i] > r2 ? 1 : 0
  return out
}

/** Dilation by a disk of radius `r`: every pixel within `r` of the foreground. */
export function dilateDisk(
  mask: Uint8Array,
  width: number,
  height: number,
  r: number,
): Uint8Array {
  if (r <= 0) return mask.slice()
  const dist2 = edtSquared(mask, width, height, 1)
  const r2 = r * r
  const out = new Uint8Array(mask.length)
  for (let i = 0; i < out.length; i++) out[i] = dist2[i] <= r2 ? 1 : 0
  return out
}

/** Opening: drops every stroke narrower than `2r`, leaves wider strokes intact. */
export function openDisk(
  mask: Uint8Array,
  width: number,
  height: number,
  r: number,
): Uint8Array {
  if (r <= 0) return mask.slice()
  return dilateDisk(erodeDisk(mask, width, height, r), width, height, r)
}

/** Closing: bridges gaps and notches narrower than `2r`. */
export function closeDisk(
  mask: Uint8Array,
  width: number,
  height: number,
  r: number,
): Uint8Array {
  if (r <= 0) return mask.slice()
  return erodeDisk(dilateDisk(mask, width, height, r), width, height, r)
}
