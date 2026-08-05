import { create } from 'zustand'
import type { Vec2 } from '../core/types'
import type { TracedWall } from '../floorplan/vectorize'
import { AIR_TYPE_ID, DEFAULT_SCENE_DEFAULTS, DEFAULT_WALL_TYPES } from '../scene/defaults'
import {
  wallLength,
  type FurnitureBox,
  type Opening,
  type OpeningKind,
  type Scene,
  type SceneWall,
  type WallType,
} from '../scene/model'
import type { CustomMaterial } from '../physics/materials'
import type { StackLayer } from '../physics/layerStack'

export type SceneSelection =
  | { kind: 'none' }
  | { kind: 'wall'; id: string }
  | { kind: 'opening'; wallId: string; openingId: string }
  | { kind: 'furniture'; id: string }

export type SceneTool = 'select' | 'draw-wall' | 'add-opening' | 'add-furniture'

/** Maps source-image pixels onto scene metres, so the scan can stay as a backdrop. */
export interface PlanTransform {
  originPx: Vec2
  metresPerPixel: number
}

const HISTORY_LIMIT = 120

interface SceneState {
  scene: Scene
  customMaterials: CustomMaterial[]
  transform: PlanTransform | null
  selection: SceneSelection
  tool: SceneTool
  /** Which kind of opening the add-opening tool places. */
  pendingOpeningKind: OpeningKind
  /** Frequency the wall inspector reports at, Hz. */
  inspectorFreqHz: number

  /** Undo/redo stacks of whole-scene snapshots. */
  past: Scene[]
  future: Scene[]

  undo: () => void
  redo: () => void
  /**
   * Record the current scene before a continuous gesture (a drag) starts, so
   * the whole gesture collapses into one undo step instead of one per frame.
   */
  pushHistory: () => void

  importTracedWalls: (walls: TracedWall[], transform: PlanTransform) => void
  setCeilingHeight: (h: number) => void
  setFloorType: (id: string) => void
  setCeilingType: (id: string) => void

  setSelection: (s: SceneSelection) => void
  setTool: (t: SceneTool) => void
  setPendingOpeningKind: (k: OpeningKind) => void
  setInspectorFreq: (hz: number) => void

  addWall: (a: Vec2, b: Vec2) => void
  updateWall: (id: string, patch: Partial<SceneWall>, record?: boolean) => void
  deleteWall: (id: string) => void
  setWallTypeForAll: (typeId: string) => void

  addOpening: (wallId: string, kind: OpeningKind, offsetM: number) => void
  updateOpening: (wallId: string, openingId: string, patch: Partial<Opening>) => void
  deleteOpening: (wallId: string, openingId: string) => void

  addFurniture: (centre: Vec2) => void
  updateFurniture: (id: string, patch: Partial<FurnitureBox>, record?: boolean) => void
  deleteFurniture: (id: string) => void

  upsertWallType: (t: WallType) => void
  deleteWallType: (id: string) => void
  setTypeLayers: (typeId: string, layers: StackLayer[]) => void
  addCustomMaterial: (m: CustomMaterial) => void
  deleteCustomMaterial: (id: string) => void
}

const emptyScene = (): Scene => ({
  ceilingHeightM: DEFAULT_SCENE_DEFAULTS.ceilingHeightM,
  wallTypes: DEFAULT_WALL_TYPES.map((t) => ({ ...t, layers: t.layers.map((l) => ({ ...l })) })),
  walls: [],
  furniture: [],
  floorTypeId: DEFAULT_SCENE_DEFAULTS.floorTypeId,
  ceilingTypeId: DEFAULT_SCENE_DEFAULTS.ceilingTypeId,
})

export function totalThickness(t: WallType): number {
  return t.layers.reduce((acc, l) => acc + l.thicknessM, 0)
}

/**
 * Pick the library build-up whose total thickness is closest to the thickness
 * measured off the drawing. Only structural wall types are candidates. Glazing,
 * door leaves and frames are chosen per opening, not per wall.
 */
function matchWallType(measuredM: number, types: WallType[]): string {
  const candidates = types.filter(
    (t) =>
      t.id !== AIR_TYPE_ID &&
      !t.id.startsWith('glass-') &&
      !t.id.startsWith('door-') &&
      !t.id.startsWith('frame-') &&
      !t.id.startsWith('furniture-') &&
      !t.id.startsWith('slab-'),
  )
  if (candidates.length === 0) return DEFAULT_SCENE_DEFAULTS.wallTypeId
  let best = candidates[0]
  let bestErr = Infinity
  for (const t of candidates) {
    const err = Math.abs(totalThickness(t) - measuredM)
    if (err < bestErr) {
      bestErr = err
      best = t
    }
  }
  return best.id
}

let idCounter = 0
const uid = (prefix: string) => `${prefix}${Date.now().toString(36)}${(idCounter++).toString(36)}`

export const useSceneStore = create<SceneState>((set) => {
  /**
   * Apply a scene mutation. `record` pushes the pre-edit scene onto the undo
   * stack; pass false for the intermediate frames of a drag.
   */
  const edit = (
    fn: (scene: Scene) => Scene,
    extra: Partial<SceneState> = {},
    record = true,
  ) =>
    set((st) => ({
      scene: fn(st.scene),
      ...(record
        ? { past: [...st.past, st.scene].slice(-HISTORY_LIMIT), future: [] }
        : {}),
      ...extra,
    }))

  return {
    scene: emptyScene(),
    customMaterials: [],
    transform: null,
    selection: { kind: 'none' },
    tool: 'select',
    pendingOpeningKind: 'window',
    inspectorFreqHz: 5.5e9,
    past: [],
    future: [],

    undo: () =>
      set((st) => {
        if (st.past.length === 0) return {}
        const previous = st.past[st.past.length - 1]
        return {
          scene: previous,
          past: st.past.slice(0, -1),
          future: [st.scene, ...st.future].slice(0, HISTORY_LIMIT),
          selection: { kind: 'none' },
        }
      }),

    redo: () =>
      set((st) => {
        if (st.future.length === 0) return {}
        const next = st.future[0]
        return {
          scene: next,
          past: [...st.past, st.scene].slice(-HISTORY_LIMIT),
          future: st.future.slice(1),
          selection: { kind: 'none' },
        }
      }),

    pushHistory: () =>
      set((st) => ({ past: [...st.past, st.scene].slice(-HISTORY_LIMIT), future: [] })),

    importTracedWalls: (walls, transform) =>
      set((st) => {
        const toScene = (p: Vec2): Vec2 => ({
          x: (p.x - transform.originPx.x) * transform.metresPerPixel,
          y: (p.y - transform.originPx.y) * transform.metresPerPixel,
        })
        const types = st.scene.wallTypes
        const sceneWalls: SceneWall[] = walls.map((w) => {
          const measured = w.thicknessPx * transform.metresPerPixel
          return {
            id: uid('w'),
            a: toScene(w.a),
            b: toScene(w.b),
            typeId: matchWallType(measured, types),
            baseM: 0,
            topM: st.scene.ceilingHeightM,
            openings: [],
            measuredThicknessM: measured,
          }
        })
        return {
          transform,
          selection: { kind: 'none' },
          scene: { ...st.scene, walls: sceneWalls },
          past: [...st.past, st.scene].slice(-HISTORY_LIMIT),
          future: [],
        }
      }),

    setCeilingHeight: (h) =>
      edit((s) => ({
        ...s,
        ceilingHeightM: h,
        // Walls that reached the old ceiling follow it up or down.
        walls: s.walls.map((w) =>
          Math.abs(w.topM - s.ceilingHeightM) < 1e-6 ? { ...w, topM: h } : w,
        ),
      })),
    setFloorType: (id) => edit((s) => ({ ...s, floorTypeId: id })),
    setCeilingType: (id) => edit((s) => ({ ...s, ceilingTypeId: id })),

    setSelection: (selection) => set({ selection }),
    setTool: (tool) => set({ tool }),
    setPendingOpeningKind: (pendingOpeningKind) => set({ pendingOpeningKind }),
    setInspectorFreq: (inspectorFreqHz) => set({ inspectorFreqHz }),

    addWall: (a, b) => {
      const id = uid('w')
      edit(
        (s) => ({
          ...s,
          walls: [
            ...s.walls,
            {
              id,
              a,
              b,
              typeId: DEFAULT_SCENE_DEFAULTS.wallTypeId,
              baseM: 0,
              topM: s.ceilingHeightM,
              openings: [],
            },
          ],
        }),
        { selection: { kind: 'wall', id } },
      )
    },

    updateWall: (id, patch, record = true) =>
      edit(
        (s) => ({ ...s, walls: s.walls.map((w) => (w.id === id ? { ...w, ...patch } : w)) }),
        {},
        record,
      ),

    deleteWall: (id) =>
      edit((s) => ({ ...s, walls: s.walls.filter((w) => w.id !== id) }), {
        selection: { kind: 'none' },
      }),

    setWallTypeForAll: (typeId) =>
      edit((s) => ({ ...s, walls: s.walls.map((w) => ({ ...w, typeId })) })),

    addOpening: (wallId, kind, offsetM) => {
      const openingId = uid('o')
      edit(
        (s) => {
          const wall = s.walls.find((w) => w.id === wallId)
          if (!wall) return s
          const len = wallLength(wall)
          const defaults: Record<OpeningKind, Partial<Opening>> = {
            window: {
              widthM: 1.2,
              sillM: 0.9,
              headM: 2.1,
              typeId: DEFAULT_SCENE_DEFAULTS.windowTypeId,
              frameWidthM: 0.07,
            },
            door: {
              widthM: 0.885,
              sillM: 0,
              headM: 2.01,
              typeId: DEFAULT_SCENE_DEFAULTS.doorTypeId,
              frameWidthM: 0.05,
            },
            passage: { widthM: 1.0, sillM: 0, headM: 2.1, typeId: AIR_TYPE_ID, frameWidthM: 0 },
          }
          const base = defaults[kind]
          const width = base.widthM ?? 1
          const opening: Opening = {
            id: openingId,
            kind,
            offsetM: Math.max(0, Math.min(len - width, offsetM - width / 2)),
            widthM: width,
            sillM: base.sillM ?? 0,
            headM: base.headM ?? 2.1,
            typeId: base.typeId ?? AIR_TYPE_ID,
            frameWidthM: base.frameWidthM ?? 0,
            frameTypeId: DEFAULT_SCENE_DEFAULTS.frameTypeId,
            mullionCount: 0,
            mullionWidthM: 0.06,
          }
          return {
            ...s,
            walls: s.walls.map((w) =>
              w.id === wallId ? { ...w, openings: [...w.openings, opening] } : w,
            ),
          }
        },
        { selection: { kind: 'opening', wallId, openingId } },
      )
    },

    updateOpening: (wallId, openingId, patch) =>
      edit((s) => ({
        ...s,
        walls: s.walls.map((w) =>
          w.id === wallId
            ? { ...w, openings: w.openings.map((o) => (o.id === openingId ? { ...o, ...patch } : o)) }
            : w,
        ),
      })),

    deleteOpening: (wallId, openingId) =>
      edit(
        (s) => ({
          ...s,
          walls: s.walls.map((w) =>
            w.id === wallId ? { ...w, openings: w.openings.filter((o) => o.id !== openingId) } : w,
          ),
        }),
        { selection: { kind: 'wall', id: wallId } },
      ),

    addFurniture: (centre) => {
      const id = uid('f')
      edit(
        (s) => ({
          ...s,
          furniture: [
            ...s.furniture,
            {
              id,
              name: 'Furniture',
              centre,
              widthM: 1.2,
              depthM: 0.6,
              rotationRad: 0,
              baseM: 0,
              heightM: 0.8,
              typeId: 'furniture-wood',
            },
          ],
        }),
        { selection: { kind: 'furniture', id } },
      )
    },

    updateFurniture: (id, patch, record = true) =>
      edit(
        (s) => ({
          ...s,
          furniture: s.furniture.map((f) => (f.id === id ? { ...f, ...patch } : f)),
        }),
        {},
        record,
      ),

    deleteFurniture: (id) =>
      edit((s) => ({ ...s, furniture: s.furniture.filter((f) => f.id !== id) }), {
        selection: { kind: 'none' },
      }),

    upsertWallType: (t) =>
      edit((s) => ({
        ...s,
        wallTypes: s.wallTypes.some((x) => x.id === t.id)
          ? s.wallTypes.map((x) => (x.id === t.id ? t : x))
          : [...s.wallTypes, t],
      })),

    deleteWallType: (id) =>
      edit((s) => ({ ...s, wallTypes: s.wallTypes.filter((t) => t.id !== id) })),

    setTypeLayers: (typeId, layers) =>
      edit((s) => ({
        ...s,
        wallTypes: s.wallTypes.map((t) => (t.id === typeId ? { ...t, layers } : t)),
      })),

    addCustomMaterial: (m) =>
      set((s) => ({ customMaterials: [...s.customMaterials.filter((x) => x.id !== m.id), m] })),

    deleteCustomMaterial: (id) =>
      set((s) => ({ customMaterials: s.customMaterials.filter((m) => m.id !== id) })),
  }
})

/** Material lookup map covering both the ITU table and any user additions. */
export function selectWallType(scene: Scene, id: string): WallType | undefined {
  return scene.wallTypes.find((t) => t.id === id)
}
