/**
 * Ray/geometry primitives for the propagation engine.
 *
 * Every compiled surface is a rectangle (a parallelogram with orthogonal edges),
 * which makes the intersection test exact and cheap: intersect the plane, then
 * express the hit point in the rectangle's own edge basis and check both
 * parameters lie in [0, 1]. No triangulation, no barycentric coordinates.
 */

import type { Surface, Vec3 } from '../scene/model'

export const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z })
export const vAdd = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z })
export const vSub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
export const vScale = (a: Vec3, k: number): Vec3 => ({ x: a.x * k, y: a.y * k, z: a.z * k })
export const vDot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z
export const vLen = (a: Vec3): number => Math.hypot(a.x, a.y, a.z)

export function vCross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }
}

export function vNorm(a: Vec3): Vec3 {
  const l = vLen(a) || 1
  return { x: a.x / l, y: a.y / l, z: a.z / l }
}

/** Precomputed per-surface data the tracer needs on every intersection test. */
export interface Facet {
  index: number
  surface: Surface
  /** Edge vectors from p0. */
  e1: Vec3
  e2: Vec3
  invLen1Sq: number
  invLen2Sq: number
  normal: Vec3
  /** Plane constant: dot(normal, p0). */
  d: number
  areaM2: number
  min: Vec3
  max: Vec3
}

export function buildFacets(surfaces: Surface[]): Facet[] {
  return surfaces.map((surface, index) => {
    const e1 = vSub(surface.p1, surface.p0)
    const e2 = vSub(surface.p3, surface.p0)
    const l1 = vDot(e1, e1)
    const l2 = vDot(e2, e2)
    const pts = [surface.p0, surface.p1, surface.p2, surface.p3]
    const min = v3(
      Math.min(...pts.map((p) => p.x)),
      Math.min(...pts.map((p) => p.y)),
      Math.min(...pts.map((p) => p.z)),
    )
    const max = v3(
      Math.max(...pts.map((p) => p.x)),
      Math.max(...pts.map((p) => p.y)),
      Math.max(...pts.map((p) => p.z)),
    )
    return {
      index,
      surface,
      e1,
      e2,
      invLen1Sq: 1 / l1,
      invLen2Sq: 1 / l2,
      normal: surface.normal,
      d: vDot(surface.normal, surface.p0),
      areaM2: Math.sqrt(l1 * l2),
      min,
      max,
    }
  })
}

export interface Hit {
  facet: Facet
  /** Distance along the ray. */
  t: number
  point: Vec3
  /** Cosine of the angle between the ray and the surface normal, always > 0. */
  cosIncidence: number
}

const EPS = 1e-9

/**
 * Ray/rectangle intersection. `origin` + t*`dir` with `dir` unit length.
 * Returns null outside (tMin, tMax) or outside the rectangle.
 */
export function intersectFacet(
  facet: Facet,
  origin: Vec3,
  dir: Vec3,
  tMin: number,
  tMax: number,
): Hit | null {
  const denom = vDot(facet.normal, dir)
  if (Math.abs(denom) < EPS) return null
  const t = (facet.d - vDot(facet.normal, origin)) / denom
  if (t <= tMin || t >= tMax) return null

  const point = vAdd(origin, vScale(dir, t))
  const rel = vSub(point, facet.surface.p0)
  const u = vDot(rel, facet.e1) * facet.invLen1Sq
  if (u < 0 || u > 1) return null
  const v = vDot(rel, facet.e2) * facet.invLen2Sq
  if (v < 0 || v > 1) return null

  return { facet, t, point, cosIncidence: Math.abs(denom) }
}

// ---------------------------------------------------------------------------
// BVH
// ---------------------------------------------------------------------------

interface BvhNode {
  min: Vec3
  max: Vec3
  /** Leaf: index range into the ordered facet list. Interior: -1. */
  start: number
  count: number
  left: number
  right: number
}

export class Bvh {
  private nodes: BvhNode[] = []
  private order: number[] = []
  readonly facets: Facet[]

  constructor(facets: Facet[]) {
    this.facets = facets
    this.order = facets.map((_, i) => i)
    if (facets.length > 0) this.build(0, facets.length)
  }

  private build(start: number, end: number): number {
    const nodeIndex = this.nodes.length
    let min = v3(Infinity, Infinity, Infinity)
    let max = v3(-Infinity, -Infinity, -Infinity)
    for (let i = start; i < end; i++) {
      const f = this.facets[this.order[i]]
      min = v3(Math.min(min.x, f.min.x), Math.min(min.y, f.min.y), Math.min(min.z, f.min.z))
      max = v3(Math.max(max.x, f.max.x), Math.max(max.y, f.max.y), Math.max(max.z, f.max.z))
    }
    this.nodes.push({ min, max, start, count: end - start, left: -1, right: -1 })

    const count = end - start
    if (count <= 4) return nodeIndex

    // Median split on the widest axis of the centroid spread.
    const ex = max.x - min.x
    const ey = max.y - min.y
    const ez = max.z - min.z
    const axis: 'x' | 'y' | 'z' = ex > ey && ex > ez ? 'x' : ey > ez ? 'y' : 'z'
    const slice = this.order.slice(start, end)
    slice.sort((a, b) => {
      const fa = this.facets[a]
      const fb = this.facets[b]
      return fa.min[axis] + fa.max[axis] - (fb.min[axis] + fb.max[axis])
    })
    for (let i = 0; i < slice.length; i++) this.order[start + i] = slice[i]

    const mid = start + (count >> 1)
    const node = this.nodes[nodeIndex]
    node.count = 0
    node.left = this.build(start, mid)
    node.right = this.build(mid, end)
    return nodeIndex
  }

  private static slabTest(node: BvhNode, o: Vec3, invDir: Vec3, tMax: number): boolean {
    let tmin = 0
    let tmax = tMax
    for (const axis of ['x', 'y', 'z'] as const) {
      const inv = invDir[axis]
      let t0 = (node.min[axis] - o[axis]) * inv
      let t1 = (node.max[axis] - o[axis]) * inv
      if (t0 > t1) {
        const tmp = t0
        t0 = t1
        t1 = tmp
      }
      if (t0 > tmin) tmin = t0
      if (t1 < tmax) tmax = t1
      if (tmax < tmin) return false
    }
    return true
  }

  /** Call `visit` for every facet the ray intersects in (tMin, tMax). Unordered. */
  forEachHit(
    origin: Vec3,
    dir: Vec3,
    tMin: number,
    tMax: number,
    visit: (hit: Hit) => void,
  ): void {
    if (this.nodes.length === 0) return
    const invDir = v3(1 / dir.x, 1 / dir.y, 1 / dir.z)
    const stack: number[] = [0]

    while (stack.length > 0) {
      const nodeIndex = stack.pop()!
      const node = this.nodes[nodeIndex]
      if (!Bvh.slabTest(node, origin, invDir, tMax)) continue

      if (node.left < 0) {
        for (let i = node.start; i < node.start + node.count; i++) {
          const hit = intersectFacet(this.facets[this.order[i]], origin, dir, tMin, tMax)
          if (hit) visit(hit)
        }
      } else {
        stack.push(node.left, node.right)
      }
    }
  }

  /** All facets crossed between two points, sorted by distance from `from`. */
  crossingsBetween(from: Vec3, to: Vec3): Hit[] {
    const delta = vSub(to, from)
    const distance = vLen(delta)
    if (distance < 1e-9) return []
    const dir = vScale(delta, 1 / distance)
    const hits: Hit[] = []
    // Small epsilons keep the endpoints themselves from registering as hits.
    this.forEachHit(from, dir, 1e-4, distance - 1e-4, (h) => hits.push(h))
    hits.sort((a, b) => a.t - b.t)
    return hits
  }
}
