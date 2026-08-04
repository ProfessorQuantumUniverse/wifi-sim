/**
 * Zhang-Suen parallel thinning.
 *
 * T. Y. Zhang and C. Y. Suen, "A Fast Parallel Algorithm for Thinning Digital
 * Patterns", Comm. ACM 27(3), 1984, 236-239.
 *
 * Reduces the wall mask to an 8-connected one-pixel-wide centreline, which is
 * what the vectoriser walks to recover wall segments. The mask is padded by one
 * pixel so the 3x3 neighbourhood needs no bounds checks in the inner loop.
 */

/** Returns a 1-px-wide skeleton with the same dimensions as the input mask. */
export function zhangSuenSkeleton(
  mask: Uint8Array,
  width: number,
  height: number,
  maxIterations = 200,
): Uint8Array {
  const pw = width + 2
  const ph = height + 2
  let img = new Uint8Array(pw * ph)
  for (let y = 0; y < height; y++) {
    img.set(mask.subarray(y * width, y * width + width), (y + 1) * pw + 1)
  }

  const doomed = new Int32Array(pw * ph)

  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false

    for (let step = 0; step < 2; step++) {
      let nDoomed = 0

      for (let y = 1; y < ph - 1; y++) {
        const row = y * pw
        for (let x = 1; x < pw - 1; x++) {
          const p = row + x
          if (img[p] !== 1) continue

          const p2 = img[p - pw]
          const p3 = img[p - pw + 1]
          const p4 = img[p + 1]
          const p5 = img[p + pw + 1]
          const p6 = img[p + pw]
          const p7 = img[p + pw - 1]
          const p8 = img[p - 1]
          const p9 = img[p - pw - 1]

          const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9
          if (b < 2 || b > 6) continue

          // A = number of 0 -> 1 transitions around the ordered ring.
          let a = 0
          if (p2 === 0 && p3 === 1) a++
          if (p3 === 0 && p4 === 1) a++
          if (p4 === 0 && p5 === 1) a++
          if (p5 === 0 && p6 === 1) a++
          if (p6 === 0 && p7 === 1) a++
          if (p7 === 0 && p8 === 1) a++
          if (p8 === 0 && p9 === 1) a++
          if (p9 === 0 && p2 === 1) a++
          if (a !== 1) continue

          if (step === 0) {
            if (p2 * p4 * p6 !== 0) continue
            if (p4 * p6 * p8 !== 0) continue
          } else {
            if (p2 * p4 * p8 !== 0) continue
            if (p2 * p6 * p8 !== 0) continue
          }

          doomed[nDoomed++] = p
        }
      }

      if (nDoomed > 0) {
        changed = true
        for (let i = 0; i < nDoomed; i++) img[doomed[i]] = 0
      }
    }

    if (!changed) break
  }

  const out = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) {
    out.set(img.subarray((y + 1) * pw + 1, (y + 1) * pw + 1 + width), y * width)
  }
  return out
}

/** 8-connected neighbour count for every skeleton pixel (0 for background). */
export function neighbourCounts(
  skel: Uint8Array,
  width: number,
  height: number,
): Uint8Array {
  const out = new Uint8Array(skel.length)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      if (skel[p] !== 1) continue
      let c = 0
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy
        if (ny < 0 || ny >= height) continue
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          if (nx < 0 || nx >= width) continue
          if (skel[ny * width + nx] === 1) c++
        }
      }
      out[p] = c
    }
  }
  return out
}

// Spur removal is done on the extracted polyline graph rather than on the
// raster (see `pruneDanglingBranches` in vectorize.ts): a raster erosion pass
// cannot distinguish a spur from the tip of a real wall, whereas on the graph a
// spur is exactly a short branch with a free end.
