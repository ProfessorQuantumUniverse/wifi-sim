import { create } from 'zustand'
import type { Vec2 } from '../core/types'
import {
  DEFAULT_FLOORPLAN_PARAMS,
  type FloorplanParams,
  type Rect,
} from '../floorplan/pipeline'
import type { TracedWall } from '../floorplan/vectorize'

export type Tool = 'pan' | 'roi' | 'exclude' | 'calibrate'

export interface LoadedImage {
  bitmap: ImageBitmap
  width: number
  height: number
  name: string
}

export interface TraceStats {
  effectiveThreshold: number
  foregroundPixels: number
  coveragePercent: number
  wallCount: number
  maskMs: number
  vectorMs: number
}

export interface Calibration {
  a: Vec2 | null
  b: Vec2 | null
  /** Real-world distance between a and b, in metres. */
  realMetres: number
}

export interface ViewState {
  zoom: number
  panX: number
  panY: number
}

export interface LayerVisibility {
  source: boolean
  mask: boolean
  skeleton: boolean
  walls: boolean
}

interface FloorplanState {
  image: LoadedImage | null
  params: FloorplanParams
  maskBitmap: ImageBitmap | null
  skeletonBitmap: ImageBitmap | null
  walls: TracedWall[]
  /** True when the mask changed after the last trace, so the walls are outdated. */
  wallsStale: boolean
  stats: TraceStats | null
  busy: boolean
  error: string | null

  tool: Tool
  view: ViewState
  layers: LayerVisibility
  calibration: Calibration
  /** Live preview of the rectangle currently being dragged. */
  pendingRect: Rect | null

  setImage: (image: LoadedImage | null) => void
  patchParams: (patch: Partial<FloorplanParams>) => void
  patchVectorize: (patch: Partial<FloorplanParams['vectorize']>) => void
  resetParams: () => void
  setResult: (r: {
    maskBitmap: ImageBitmap | null
    skeletonBitmap: ImageBitmap | null
    walls: TracedWall[] | null
    stats: TraceStats
  }) => void
  setBusy: (busy: boolean) => void
  setError: (error: string | null) => void

  setTool: (tool: Tool) => void
  setView: (view: Partial<ViewState>) => void
  toggleLayer: (layer: keyof LayerVisibility) => void
  setCalibration: (patch: Partial<Calibration>) => void
  setPendingRect: (rect: Rect | null) => void
  addExcludeRect: (rect: Rect) => void
  clearExcludeRects: () => void
  setWalls: (walls: TracedWall[]) => void
}

export const useFloorplanStore = create<FloorplanState>((set) => ({
  image: null,
  params: DEFAULT_FLOORPLAN_PARAMS,
  maskBitmap: null,
  skeletonBitmap: null,
  walls: [],
  wallsStale: false,
  stats: null,
  busy: false,
  error: null,

  tool: 'pan',
  view: { zoom: 1, panX: 0, panY: 0 },
  layers: { source: true, mask: true, skeleton: false, walls: true },
  calibration: { a: null, b: null, realMetres: 5 },
  pendingRect: null,

  setImage: (image) =>
    set({
      image,
      maskBitmap: null,
      skeletonBitmap: null,
      walls: [],
      wallsStale: false,
      stats: null,
      error: null,
      calibration: { a: null, b: null, realMetres: 5 },
      params: { ...DEFAULT_FLOORPLAN_PARAMS, roi: null, excludeRects: [] },
    }),

  patchParams: (patch) =>
    set((s) => ({ params: { ...s.params, ...patch }, wallsStale: s.walls.length > 0 })),

  patchVectorize: (patch) =>
    set((s) => ({
      params: { ...s.params, vectorize: { ...s.params.vectorize, ...patch } },
      wallsStale: s.walls.length > 0,
    })),

  resetParams: () =>
    set((s) => ({
      params: {
        ...DEFAULT_FLOORPLAN_PARAMS,
        roi: s.params.roi,
        excludeRects: s.params.excludeRects,
      },
    })),

  setResult: ({ maskBitmap, skeletonBitmap, walls, stats }) =>
    set((s) => ({
      maskBitmap,
      skeletonBitmap: skeletonBitmap ?? s.skeletonBitmap,
      walls: walls ?? s.walls,
      wallsStale: walls ? false : s.wallsStale,
      stats,
      error: null,
    })),

  setBusy: (busy) => set({ busy }),
  setError: (error) => set({ error }),

  setTool: (tool) => set({ tool }),
  setView: (view) => set((s) => ({ view: { ...s.view, ...view } })),
  toggleLayer: (layer) =>
    set((s) => ({ layers: { ...s.layers, [layer]: !s.layers[layer] } })),
  setCalibration: (patch) =>
    set((s) => ({ calibration: { ...s.calibration, ...patch } })),
  setPendingRect: (pendingRect) => set({ pendingRect }),
  addExcludeRect: (rect) =>
    set((s) => ({
      params: { ...s.params, excludeRects: [...s.params.excludeRects, rect] },
    })),
  clearExcludeRects: () =>
    set((s) => ({ params: { ...s.params, excludeRects: [] } })),
  setWalls: (walls) => set({ walls }),
}))

/**
 * Metres per source-image pixel, or null while the plan is uncalibrated.
 * Everything downstream (wall thickness, room size, propagation distances)
 * depends on this, so the UI blocks the next milestone until it is set.
 */
export function metresPerPixel(cal: Calibration): number | null {
  if (!cal.a || !cal.b || cal.realMetres <= 0) return null
  const px = Math.hypot(cal.b.x - cal.a.x, cal.b.y - cal.a.y)
  if (px < 1e-6) return null
  return cal.realMetres / px
}
