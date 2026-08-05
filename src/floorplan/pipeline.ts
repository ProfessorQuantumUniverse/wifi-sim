/**
 * The full scan -> wall-segments pipeline, in one place so the worker and any
 * future headless use share exactly the same ordering of operations.
 */

import {
  applyLevels,
  binarize,
  boxBlur,
  despeckle,
  REC601,
  subtract,
  toGray,
  type GrayWeights,
  type ThresholdMode,
} from './imageOps'
import { closeDisk, edtSquared, openDisk } from './edt'
import { zhangSuenSkeleton } from './skeleton'
import {
  DEFAULT_VECTORIZE_OPTIONS,
  vectorizeSkeleton,
  type TracedWall,
  type VectorizeOptions,
} from './vectorize'

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface FloorplanParams {
  /** Region of interest; everything outside is discarded. null = whole image. */
  roi: Rect | null
  /** Rectangles blanked out inside the ROI (title blocks, detail drawings). */
  excludeRects: Rect[]

  grayWeights: GrayWeights
  brightness: number
  contrast: number
  gamma: number
  blurRadius: number

  thresholdMode: ThresholdMode
  manualLevel: number
  adaptiveRadius: number
  adaptiveOffset: number
  /** Set for plans drawn light-on-dark (negatives, inverted CAD exports). */
  invertInput: boolean

  /** Disk radius, px. Removes every stroke thinner than 2r. The key control. */
  openRadius: number
  /** Disk radius, px. Bridges gaps in wall strokes (door swings, scan dropouts). */
  closeRadius: number
  /** Disk radius, px. Removes strokes thicker than 2r (filled areas). 0 = off. */
  maxThicknessRadius: number
  /** Connected components below this pixel area are dropped. */
  minComponentArea: number

  vectorize: VectorizeOptions
}

export const DEFAULT_FLOORPLAN_PARAMS: FloorplanParams = {
  roi: null,
  excludeRects: [],
  grayWeights: REC601,
  brightness: 0,
  contrast: 0,
  gamma: 1,
  blurRadius: 0,
  thresholdMode: 'otsu',
  manualLevel: 128,
  adaptiveRadius: 25,
  adaptiveOffset: 10,
  invertInput: false,
  openRadius: 3,
  closeRadius: 2,
  maxThicknessRadius: 0,
  minComponentArea: 250,
  vectorize: DEFAULT_VECTORIZE_OPTIONS,
}

export interface MaskResult {
  mask: Uint8Array
  dist2: Float64Array
  width: number
  height: number
  effectiveThreshold: number
  foregroundPixels: number
}

function applyRegions(
  mask: Uint8Array,
  width: number,
  height: number,
  roi: Rect | null,
  excludes: Rect[],
): void {
  if (roi) {
    const x0 = Math.max(0, Math.floor(roi.x))
    const y0 = Math.max(0, Math.floor(roi.y))
    const x1 = Math.min(width, Math.ceil(roi.x + roi.w))
    const y1 = Math.min(height, Math.ceil(roi.y + roi.h))
    for (let y = 0; y < height; y++) {
      const row = y * width
      if (y < y0 || y >= y1) {
        mask.fill(0, row, row + width)
        continue
      }
      mask.fill(0, row, row + x0)
      mask.fill(0, row + x1, row + width)
    }
  }

  for (const r of excludes) {
    const x0 = Math.max(0, Math.floor(r.x))
    const y0 = Math.max(0, Math.floor(r.y))
    const x1 = Math.min(width, Math.ceil(r.x + r.w))
    const y1 = Math.min(height, Math.ceil(r.y + r.h))
    for (let y = y0; y < y1; y++) mask.fill(0, y * width + x0, y * width + x1)
  }
}

/** Stages 1-6: pixels in, clean binary wall mask + its distance transform out. */
export function runMaskStage(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  p: FloorplanParams,
): MaskResult {
  let gray = toGray(rgba, width, height, p.grayWeights)
  gray = applyLevels(gray, p.brightness, p.contrast, p.gamma)
  if (p.blurRadius > 0) gray = boxBlur(gray, width, height, Math.round(p.blurRadius))

  const { mask, effectiveLevel } = binarize(
    gray,
    width,
    height,
    p.thresholdMode,
    p.manualLevel,
    p.adaptiveRadius,
    p.adaptiveOffset,
  )

  if (p.invertInput) {
    for (let i = 0; i < mask.length; i++) mask[i] = mask[i] === 1 ? 0 : 1
  }

  applyRegions(mask, width, height, p.roi, p.excludeRects)

  let m = p.openRadius > 0 ? openDisk(mask, width, height, p.openRadius) : mask

  if (p.maxThicknessRadius > 0) {
    m = subtract(m, openDisk(m, width, height, p.maxThicknessRadius))
  }
  if (p.closeRadius > 0) m = closeDisk(m, width, height, p.closeRadius)
  if (p.minComponentArea > 1) m = despeckle(m, width, height, p.minComponentArea)

  let foreground = 0
  for (let i = 0; i < m.length; i++) foreground += m[i]

  return {
    mask: m,
    dist2: edtSquared(m, width, height, 0),
    width,
    height,
    effectiveThreshold: effectiveLevel,
    foregroundPixels: foreground,
  }
}

/** Stages 7-9: thin the mask and turn the centrelines into wall segments. */
export function runVectorStage(
  maskResult: MaskResult,
  opts: VectorizeOptions,
): { skeleton: Uint8Array; walls: TracedWall[] } {
  const skeleton = zhangSuenSkeleton(maskResult.mask, maskResult.width, maskResult.height)
  const walls = vectorizeSkeleton(
    skeleton,
    maskResult.dist2,
    maskResult.width,
    maskResult.height,
    opts,
  )
  return { skeleton, walls }
}
