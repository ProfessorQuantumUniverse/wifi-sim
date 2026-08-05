/**
 * The editable building model, in metres, and its compilation into the flat
 * surface list the propagation engine consumes.
 *
 * Walls, floors, ceilings and furniture faces are all represented to the engine
 * as zero-thickness surfaces carrying a multilayer stack. That is the intended
 * use of the transfer-matrix coefficients: the stack already accounts for the
 * construction's internal structure and its multiple internal reflections, so
 * refracting a ray through the slab volume as well would double-count it. Slab
 * thicknesses (0.1-0.3 m) are also small against room-scale path lengths.
 */

import type { Vec2 } from '../core/types'
import type { StackLayer } from '../physics/layerStack'

export interface WallType {
  id: string
  name: string
  /** Ordered from the "a-side" of the wall to the "b-side". */
  layers: StackLayer[]
  /** Colour used in the editor. */
  colour: string
}

export type OpeningKind = 'window' | 'door' | 'passage'

export interface Opening {
  id: string
  kind: OpeningKind
  /** Distance along the wall from endpoint a, to the opening's near edge, m. */
  offsetM: number
  widthM: number
  /** Height of the opening's lower edge above the floor, m. */
  sillM: number
  /** Height of the opening's upper edge above the floor, m. */
  headM: number
  /**
   * Build-up filling the opening. A passage uses the air type; a window uses a
   * glazing stack; a door uses a leaf stack.
   */
  typeId: string
  /**
   * Frame width around the opening, m. The frame is modelled as its own surface
   * with `frameTypeId`, which is what makes mullions between large panes show up
   * in the result instead of being averaged away.
   */
  frameWidthM: number
  frameTypeId: string
  /** Vertical mullions splitting the opening into equal panes. 0 = none. */
  mullionCount: number
  mullionWidthM: number
}

export interface SceneWall {
  id: string
  a: Vec2
  b: Vec2
  typeId: string
  /** Bottom and top of the wall above floor level, m. */
  baseM: number
  topM: number
  openings: Opening[]
  /**
   * Thickness recovered from the scan, m. Informational: it is what the wall
   * type was matched against, and it lets you spot a wall whose assigned
   * build-up disagrees with the drawing.
   */
  measuredThicknessM?: number
}

export interface FurnitureBox {
  id: string
  name: string
  /** Centre position, m. */
  centre: Vec2
  widthM: number
  depthM: number
  /** Rotation about the vertical axis, radians. */
  rotationRad: number
  baseM: number
  heightM: number
  typeId: string
}

export interface Scene {
  ceilingHeightM: number
  wallTypes: WallType[]
  walls: SceneWall[]
  furniture: FurnitureBox[]
  floorTypeId: string
  ceilingTypeId: string
}

// ---------------------------------------------------------------------------
// Compiled geometry
// ---------------------------------------------------------------------------

export interface Vec3 {
  x: number
  y: number
  z: number
}

export type SurfaceRole = 'wall' | 'opening' | 'frame' | 'mullion' | 'floor' | 'ceiling' | 'furniture'

/**
 * An axis-independent planar quad. `p0..p3` wind counter-clockwise seen from the
 * side the normal points to. The engine triangulates as (p0,p1,p2)+(p0,p2,p3).
 */
export interface Surface {
  id: string
  role: SurfaceRole
  typeId: string
  sourceId: string
  p0: Vec3
  p1: Vec3
  p2: Vec3
  p3: Vec3
  normal: Vec3
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

function normalise(v: Vec3): Vec3 {
  const l = Math.hypot(v.x, v.y, v.z) || 1
  return { x: v.x / l, y: v.y / l, z: v.z / l }
}

/**
 * Build a quad, or return null if it is degenerate. A zero-area surface has no
 * meaningful normal and would make the tracer's intersection test divide by
 * zero, so such quads must never reach the engine.
 */
function makeQuad(
  id: string,
  role: SurfaceRole,
  typeId: string,
  sourceId: string,
  p0: Vec3,
  p1: Vec3,
  p2: Vec3,
  p3: Vec3,
): Surface | null {
  const raw = cross(sub(p1, p0), sub(p3, p0))
  if (Math.hypot(raw.x, raw.y, raw.z) < 1e-9) return null
  return { id, role, typeId, sourceId, p0, p1, p2, p3, normal: normalise(raw) }
}

/** A rectangle in a wall's local (along-wall, height) frame. */
interface WallPanel {
  role: SurfaceRole
  typeId: string
  s0: number
  s1: number
  z0: number
  z1: number
}

/**
 * Split a wall face into panels: the solid remainder plus, for each opening, its
 * frame ring, its mullions, and the infill panes between them.
 *
 * The solid part is produced by a guillotine subdivision: cut the face into
 * horizontal bands at every opening's sill and head, then within each band cut
 * vertically at every opening's edges, and keep the cells no opening covers.
 * That yields a small, non-overlapping set of rectangles for any arrangement of
 * openings without needing a general polygon-clipping library.
 */
function panelsForWall(wall: SceneWall, wallLengthM: number): WallPanel[] {
  const z0 = wall.baseM
  const z1 = wall.topM
  const panels: WallPanel[] = []

  // Clamp openings to the wall and expand each into its outer (frame) extent.
  const boxes = wall.openings.map((o) => {
    const outerS0 = Math.max(0, o.offsetM - o.frameWidthM)
    const outerS1 = Math.min(wallLengthM, o.offsetM + o.widthM + o.frameWidthM)
    const outerZ0 = Math.max(z0, o.sillM - o.frameWidthM)
    const outerZ1 = Math.min(z1, o.headM + o.frameWidthM)
    return { o, outerS0, outerS1, outerZ0, outerZ1 }
  })

  // --- solid remainder ---
  const sCuts = new Set<number>([0, wallLengthM])
  const zCuts = new Set<number>([z0, z1])
  for (const b of boxes) {
    sCuts.add(Math.max(0, Math.min(wallLengthM, b.outerS0)))
    sCuts.add(Math.max(0, Math.min(wallLengthM, b.outerS1)))
    zCuts.add(Math.max(z0, Math.min(z1, b.outerZ0)))
    zCuts.add(Math.max(z0, Math.min(z1, b.outerZ1)))
  }
  const sList = [...sCuts].sort((p, q) => p - q)
  const zList = [...zCuts].sort((p, q) => p - q)

  for (let i = 0; i + 1 < sList.length; i++) {
    for (let j = 0; j + 1 < zList.length; j++) {
      const cs0 = sList[i]
      const cs1 = sList[i + 1]
      const cz0 = zList[j]
      const cz1 = zList[j + 1]
      if (cs1 - cs0 < 1e-6 || cz1 - cz0 < 1e-6) continue
      const ms = (cs0 + cs1) / 2
      const mz = (cz0 + cz1) / 2
      const covered = boxes.some(
        (b) => ms > b.outerS0 && ms < b.outerS1 && mz > b.outerZ0 && mz < b.outerZ1,
      )
      if (!covered) {
        panels.push({ role: 'wall', typeId: wall.typeId, s0: cs0, s1: cs1, z0: cz0, z1: cz1 })
      }
    }
  }

  // --- frames, mullions and panes ---
  for (const b of boxes) {
    const o = b.o
    const inS0 = Math.max(0, o.offsetM)
    const inS1 = Math.min(wallLengthM, o.offsetM + o.widthM)
    const inZ0 = Math.max(z0, o.sillM)
    const inZ1 = Math.min(z1, o.headM)
    if (inS1 - inS0 < 1e-6 || inZ1 - inZ0 < 1e-6) continue

    if (o.frameWidthM > 0) {
      // Frame ring: four rectangles around the aperture.
      const ring: Array<[number, number, number, number]> = [
        [b.outerS0, b.outerS1, b.outerZ0, inZ0], // below
        [b.outerS0, b.outerS1, inZ1, b.outerZ1], // above
        [b.outerS0, inS0, inZ0, inZ1], // left
        [inS1, b.outerS1, inZ0, inZ1], // right
      ]
      for (const [s0, s1, zz0, zz1] of ring) {
        if (s1 - s0 > 1e-6 && zz1 - zz0 > 1e-6) {
          panels.push({ role: 'frame', typeId: o.frameTypeId, s0, s1, z0: zz0, z1: zz1 })
        }
      }
    }

    // Panes separated by mullions.
    const nPanes = Math.max(1, o.mullionCount + 1)
    const mullionW = o.mullionCount > 0 ? o.mullionWidthM : 0
    const paneW = (inS1 - inS0 - mullionW * o.mullionCount) / nPanes
    let cursor = inS0
    for (let k = 0; k < nPanes; k++) {
      const paneS1 = cursor + paneW
      if (paneW > 1e-6) {
        panels.push({ role: 'opening', typeId: o.typeId, s0: cursor, s1: paneS1, z0: inZ0, z1: inZ1 })
      }
      cursor = paneS1
      if (k < nPanes - 1 && mullionW > 1e-6) {
        panels.push({
          role: 'mullion',
          typeId: o.frameTypeId,
          s0: cursor,
          s1: cursor + mullionW,
          z0: inZ0,
          z1: inZ1,
        })
      }
      cursor += mullionW
    }
  }

  return panels
}

/** Turn the editable scene into the surface list the engine traces against. */
/** Floor and ceiling extend this far past the outermost walls, metres. */
const SLAB_MARGIN_M = 0.3

export function compileScene(scene: Scene): Surface[] {
  const surfaces: Surface[] = []
  let counter = 0
  const nextId = () => `s${counter++}`
  const push = (s: Surface | null) => {
    if (s) surfaces.push(s)
  }

  // --- walls ---
  for (const wall of scene.walls) {
    const dx = wall.b.x - wall.a.x
    const dy = wall.b.y - wall.a.y
    const length = Math.hypot(dx, dy)
    if (length < 1e-6) continue
    const ux = dx / length
    const uy = dy / length

    for (const panel of panelsForWall(wall, length)) {
      const x0 = wall.a.x + ux * panel.s0
      const y0 = wall.a.y + uy * panel.s0
      const x1 = wall.a.x + ux * panel.s1
      const y1 = wall.a.y + uy * panel.s1
      push(
        makeQuad(
          nextId(),
          panel.role,
          panel.typeId,
          wall.id,
          { x: x0, y: y0, z: panel.z0 },
          { x: x1, y: y1, z: panel.z0 },
          { x: x1, y: y1, z: panel.z1 },
          { x: x0, y: y0, z: panel.z1 },
        ),
      )
    }
  }

  // --- floor and ceiling, spanning the walls' bounding box plus a margin ---
  const bounds = sceneBounds(scene)
  if (bounds && bounds.maxX - bounds.minX > 0.1 && bounds.maxY - bounds.minY > 0.1) {
    const minX = bounds.minX - SLAB_MARGIN_M
    const minY = bounds.minY - SLAB_MARGIN_M
    const maxX = bounds.maxX + SLAB_MARGIN_M
    const maxY = bounds.maxY + SLAB_MARGIN_M
    // Floor normal points up into the room, ceiling normal points down into it.
    push(
      makeQuad(
        nextId(),
        'floor',
        scene.floorTypeId,
        'floor',
        { x: minX, y: minY, z: 0 },
        { x: maxX, y: minY, z: 0 },
        { x: maxX, y: maxY, z: 0 },
        { x: minX, y: maxY, z: 0 },
      ),
    )
    const h = scene.ceilingHeightM
    push(
      makeQuad(
        nextId(),
        'ceiling',
        scene.ceilingTypeId,
        'ceiling',
        { x: minX, y: maxY, z: h },
        { x: maxX, y: maxY, z: h },
        { x: maxX, y: minY, z: h },
        { x: minX, y: minY, z: h },
      ),
    )
  }

  // --- furniture: top face plus four sides ---
  for (const f of scene.furniture) {
    const c = Math.cos(f.rotationRad)
    const s = Math.sin(f.rotationRad)
    const hw = f.widthM / 2
    const hd = f.depthM / 2
    const corner = (sx: number, sy: number): Vec2 => ({
      x: f.centre.x + sx * hw * c - sy * hd * s,
      y: f.centre.y + sx * hw * s + sy * hd * c,
    })
    const c00 = corner(-1, -1)
    const c10 = corner(1, -1)
    const c11 = corner(1, 1)
    const c01 = corner(-1, 1)
    const zb = f.baseM
    const zt = f.baseM + f.heightM

    const sides: Array<[Vec2, Vec2]> = [
      [c00, c10],
      [c10, c11],
      [c11, c01],
      [c01, c00],
    ]
    for (const [p, q] of sides) {
      push(
        makeQuad(
          nextId(),
          'furniture',
          f.typeId,
          f.id,
          { x: p.x, y: p.y, z: zb },
          { x: q.x, y: q.y, z: zb },
          { x: q.x, y: q.y, z: zt },
          { x: p.x, y: p.y, z: zt },
        ),
      )
    }
    push(
      makeQuad(
        nextId(),
        'furniture',
        f.typeId,
        f.id,
        { x: c00.x, y: c00.y, z: zt },
        { x: c10.x, y: c10.y, z: zt },
        { x: c11.x, y: c11.y, z: zt },
        { x: c01.x, y: c01.y, z: zt },
      ),
    )
  }

  return surfaces
}

export function sceneBounds(
  scene: Scene,
): { minX: number; minY: number; maxX: number; maxY: number } | null {
  if (scene.walls.length === 0) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const w of scene.walls) {
    minX = Math.min(minX, w.a.x, w.b.x)
    maxX = Math.max(maxX, w.a.x, w.b.x)
    minY = Math.min(minY, w.a.y, w.b.y)
    maxY = Math.max(maxY, w.a.y, w.b.y)
  }
  return { minX, minY, maxX, maxY }
}

export function wallLength(w: SceneWall): number {
  return Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y)
}
