/**
 * Skeleton raster -> wall segments.
 *
 * Pipeline: build a pixel graph from the thinned mask, drop spur branches,
 * simplify each chain (Douglas-Peucker), then clean up the resulting segment
 * soup (endpoint clustering, optional orthogonal snap, collinear merge) and
 * recover each wall's physical thickness from the distance transform.
 */

import type { Vec2 } from '../core/types'

export interface TracedWall {
  id: string
  a: Vec2
  b: Vec2
  /** Median stroke width along the segment, in pixels of the source image. */
  thicknessPx: number
}

interface PixelNode {
  id: number
  x: number
  y: number
}

interface PixelChain {
  a: number
  b: number
  pts: number[] // flat [x0, y0, x1, y1, ...] including both endpoints
}

interface PixelGraph {
  nodes: PixelNode[]
  chains: PixelChain[]
}

// ---------------------------------------------------------------------------
// Pixel graph
// ---------------------------------------------------------------------------

const NEIGHBOUR_DX = [0, 1, 1, 1, 0, -1, -1, -1]
const NEIGHBOUR_DY = [-1, -1, 0, 1, 1, 1, 0, -1]

function degreeOf(
  skel: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  let c = 0
  for (let k = 0; k < 8; k++) {
    const nx = x + NEIGHBOUR_DX[k]
    const ny = y + NEIGHBOUR_DY[k]
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
    if (skel[ny * width + nx] === 1) c++
  }
  return c
}

/**
 * Walk the skeleton into nodes (degree != 2) and chains of degree-2 pixels
 * between them. Closed loops with no junction get an arbitrary seed node.
 */
function buildPixelGraph(skel: Uint8Array, width: number, height: number): PixelGraph {
  const n = width * height
  const nodeIdAt = new Int32Array(n).fill(-1)
  const nodes: PixelNode[] = []

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      if (skel[p] !== 1) continue
      const deg = degreeOf(skel, width, height, x, y)
      if (deg !== 2) {
        nodeIdAt[p] = nodes.length
        nodes.push({ id: nodes.length, x, y })
      }
    }
  }

  const chains: PixelChain[] = []
  const chainVisited = new Uint8Array(n) // degree-2 pixels already consumed
  const directLinks = new Set<number>() // node-to-node adjacency, deduplicated

  const traceFrom = (startNode: PixelNode, firstX: number, firstY: number): void => {
    const pts: number[] = [startNode.x, startNode.y]
    let prevX = startNode.x
    let prevY = startNode.y
    let curX = firstX
    let curY = firstY

    for (;;) {
      const cur = curY * width + curX
      pts.push(curX, curY)

      if (nodeIdAt[cur] >= 0) {
        chains.push({ a: startNode.id, b: nodeIdAt[cur], pts })
        return
      }

      chainVisited[cur] = 1

      // A degree-2 pixel has exactly two skeleton neighbours: where we came
      // from, and where we go next.
      let nextX = -1
      let nextY = -1
      for (let k = 0; k < 8; k++) {
        const nx = curX + NEIGHBOUR_DX[k]
        const ny = curY + NEIGHBOUR_DY[k]
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        if (skel[ny * width + nx] !== 1) continue
        if (nx === prevX && ny === prevY) continue
        nextX = nx
        nextY = ny
        break
      }
      if (nextX < 0) {
        // Dead end that is not marked as a node (can happen on a 1-px stub).
        chains.push({ a: startNode.id, b: -1, pts })
        return
      }

      prevX = curX
      prevY = curY
      curX = nextX
      curY = nextY
    }
  }

  for (const node of nodes) {
    for (let k = 0; k < 8; k++) {
      const nx = node.x + NEIGHBOUR_DX[k]
      const ny = node.y + NEIGHBOUR_DY[k]
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const q = ny * width + nx
      if (skel[q] !== 1) continue

      if (nodeIdAt[q] >= 0) {
        // Adjacent junction pixels: record once, in a canonical order.
        const other = nodeIdAt[q]
        const key = node.id < other ? node.id * nodes.length + other : other * nodes.length + node.id
        if (directLinks.has(key)) continue
        directLinks.add(key)
        chains.push({ a: node.id, b: other, pts: [node.x, node.y, nx, ny] })
        continue
      }

      if (chainVisited[q] === 1) continue
      traceFrom(node, nx, ny)
    }
  }

  // Pure loops: skeleton components where every pixel has degree 2.
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      if (skel[p] !== 1 || chainVisited[p] === 1 || nodeIdAt[p] >= 0) continue
      const seed: PixelNode = { id: nodes.length, x, y }
      nodeIdAt[p] = seed.id
      nodes.push(seed)
      for (let k = 0; k < 8; k++) {
        const nx = x + NEIGHBOUR_DX[k]
        const ny = y + NEIGHBOUR_DY[k]
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
        const q = ny * width + nx
        if (skel[q] !== 1 || chainVisited[q] === 1) continue
        traceFrom(seed, nx, ny)
        break
      }
    }
  }

  return { nodes, chains }
}

function chainLength(pts: number[]): number {
  let len = 0
  for (let i = 2; i < pts.length; i += 2) {
    len += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1])
  }
  return len
}

/**
 * Iteratively drop chains that dead-end (one endpoint has no other chain) and
 * are shorter than `minLengthPx`. Repeated because removing one spur can expose
 * another behind it.
 */
function pruneDanglingBranches(graph: PixelGraph, minLengthPx: number): PixelChain[] {
  let chains = graph.chains.slice()
  if (minLengthPx <= 0) return chains

  for (let pass = 0; pass < 20; pass++) {
    const degree = new Map<number, number>()
    for (const c of chains) {
      degree.set(c.a, (degree.get(c.a) ?? 0) + 1)
      if (c.b !== c.a) degree.set(c.b, (degree.get(c.b) ?? 0) + 1)
    }

    const kept = chains.filter((c) => {
      const dangling = (degree.get(c.a) ?? 0) <= 1 || c.b < 0 || (degree.get(c.b) ?? 0) <= 1
      return !(dangling && chainLength(c.pts) < minLengthPx)
    })

    if (kept.length === chains.length) break
    chains = kept
  }
  return chains
}

// ---------------------------------------------------------------------------
// Simplification
// ---------------------------------------------------------------------------

function perpendicularDistance(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(px - ax, py - ay)
  const t = ((px - ax) * dx + (py - ay) * dy) / len2
  const cx = ax + t * dx
  const cy = ay + t * dy
  return Math.hypot(px - cx, py - cy)
}

/** Douglas-Peucker on a flat [x, y, ...] point list; iterative, no recursion. */
function simplifyPolyline(pts: number[], epsilon: number): number[] {
  const count = pts.length / 2
  if (count < 3) return pts.slice()

  const keep = new Uint8Array(count)
  keep[0] = 1
  keep[count - 1] = 1

  const stack: number[] = [0, count - 1]
  while (stack.length > 0) {
    const last = stack.pop()!
    const first = stack.pop()!
    let maxDist = -1
    let index = -1
    for (let i = first + 1; i < last; i++) {
      const d = perpendicularDistance(
        pts[i * 2],
        pts[i * 2 + 1],
        pts[first * 2],
        pts[first * 2 + 1],
        pts[last * 2],
        pts[last * 2 + 1],
      )
      if (d > maxDist) {
        maxDist = d
        index = i
      }
    }
    if (maxDist > epsilon && index > 0) {
      keep[index] = 1
      stack.push(first, index, index, last)
    }
  }

  const out: number[] = []
  for (let i = 0; i < count; i++) {
    if (keep[i] === 1) out.push(pts[i * 2], pts[i * 2 + 1])
  }
  return out
}

// ---------------------------------------------------------------------------
// Segment cleanup
// ---------------------------------------------------------------------------

interface RawSegment {
  ai: number // index into the shared point array
  bi: number
}

/**
 * Cluster endpoints that are within `tolerance` of each other into one shared
 * point, so walls meeting at a corner end up with an identical vertex.
 * Uses a uniform hash grid of cell size `tolerance`.
 */
function clusterPoints(
  coords: number[],
  tolerance: number,
): { points: Vec2[]; remap: Int32Array } {
  const count = coords.length / 2
  const remap = new Int32Array(count).fill(-1)
  const points: Vec2[] = []
  const cell = Math.max(1e-6, tolerance)
  const grid = new Map<string, number[]>()

  for (let i = 0; i < count; i++) {
    const x = coords[i * 2]
    const y = coords[i * 2 + 1]
    const cx = Math.floor(x / cell)
    const cy = Math.floor(y / cell)

    let target = -1
    outer: for (let gy = cy - 1; gy <= cy + 1 && target < 0; gy++) {
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        const bucket = grid.get(`${gx},${gy}`)
        if (!bucket) continue
        for (const pi of bucket) {
          if (Math.hypot(points[pi].x - x, points[pi].y - y) <= tolerance) {
            target = pi
            break outer
          }
        }
      }
    }

    if (target < 0) {
      target = points.length
      points.push({ x, y })
      const key = `${cx},${cy}`
      const bucket = grid.get(key)
      if (bucket) bucket.push(target)
      else grid.set(key, [target])
    }
    remap[i] = target
  }

  return { points, remap }
}

/**
 * Gauss-Seidel relaxation that pulls near-axis-aligned segments onto the axis.
 * Operating on the shared point array (rather than per segment) keeps corners
 * joined; a few sweeps are enough for a floorplan, which is mostly orthogonal.
 */
function orthogonalSnap(
  points: Vec2[],
  segments: RawSegment[],
  angleToleranceDeg: number,
  sweeps = 6,
): void {
  if (angleToleranceDeg <= 0) return
  const tol = (angleToleranceDeg * Math.PI) / 180

  for (let s = 0; s < sweeps; s++) {
    for (const seg of segments) {
      const a = points[seg.ai]
      const b = points[seg.bi]
      const dx = b.x - a.x
      const dy = b.y - a.y
      if (dx === 0 && dy === 0) continue
      const angle = Math.atan2(dy, dx)
      // Deviation from the nearest multiple of 90 degrees.
      const quarter = Math.PI / 2
      const nearest = Math.round(angle / quarter) * quarter
      if (Math.abs(angle - nearest) > tol) continue

      if (Math.abs(Math.cos(nearest)) > 0.5) {
        // Horizontal: equalise y.
        const my = (a.y + b.y) / 2
        a.y = my
        b.y = my
      } else {
        // Vertical: equalise x.
        const mx = (a.x + b.x) / 2
        a.x = mx
        b.x = mx
      }
    }
  }
}

/** Merge chains of two segments that meet at a degree-2 vertex almost straight. */
function mergeCollinear(
  points: Vec2[],
  segments: RawSegment[],
  angleToleranceDeg: number,
): RawSegment[] {
  if (angleToleranceDeg <= 0) return segments
  const tol = (angleToleranceDeg * Math.PI) / 180
  let segs = segments.slice()

  for (let pass = 0; pass < 20; pass++) {
    const incident = new Map<number, number[]>()
    segs.forEach((seg, i) => {
      for (const vi of [seg.ai, seg.bi]) {
        const list = incident.get(vi)
        if (list) list.push(i)
        else incident.set(vi, [i])
      }
    })

    const dead = new Uint8Array(segs.length)
    let merged = false

    for (const [vi, list] of incident) {
      if (list.length !== 2) continue
      const [i, j] = list
      if (dead[i] === 1 || dead[j] === 1) continue

      const segI = segs[i]
      const segJ = segs[j]
      const farI = segI.ai === vi ? segI.bi : segI.ai
      const farJ = segJ.ai === vi ? segJ.bi : segJ.ai
      if (farI === farJ) continue

      const v = points[vi]
      const angI = Math.atan2(points[farI].y - v.y, points[farI].x - v.x)
      const angJ = Math.atan2(points[farJ].y - v.y, points[farJ].x - v.x)
      // Straight-through means the two directions are ~180 degrees apart.
      let delta = Math.abs(angI - angJ)
      if (delta > Math.PI) delta = 2 * Math.PI - delta
      if (Math.abs(delta - Math.PI) > tol) continue

      dead[i] = 1
      dead[j] = 1
      segs.push({ ai: farI, bi: farJ })
      merged = true
    }

    segs = segs.filter((_, i) => dead[i] !== 1)
    if (!merged) break
  }

  return segs
}

// ---------------------------------------------------------------------------
// Thickness
// ---------------------------------------------------------------------------

/**
 * Median stroke width along a segment, from the distance transform of the mask.
 * The middle 60% is sampled: near a junction the inscribed disk grows into the
 * crossing wall and would overstate the thickness.
 */
function measureThickness(
  a: Vec2,
  b: Vec2,
  dist2: Float64Array,
  width: number,
  height: number,
): number {
  const length = Math.hypot(b.x - a.x, b.y - a.y)
  const samples = Math.max(3, Math.min(64, Math.round(length / 2)))
  const values: number[] = []

  for (let i = 0; i < samples; i++) {
    const t = 0.2 + (0.6 * i) / Math.max(1, samples - 1)
    const x = Math.round(a.x + t * (b.x - a.x))
    const y = Math.round(a.y + t * (b.y - a.y))
    if (x < 0 || y < 0 || x >= width || y >= height) continue
    values.push(Math.sqrt(dist2[y * width + x]))
  }

  if (values.length === 0) return 0
  values.sort((p, q) => p - q)
  const median = values[values.length >> 1]
  // The distance transform gives the inscribed radius; width is twice that,
  // plus one for the centre pixel itself.
  return 2 * median + 1
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export interface VectorizeOptions {
  /** Douglas-Peucker tolerance, pixels. */
  simplifyEpsilonPx: number
  /** Drop dead-end branches shorter than this, pixels. */
  spurLengthPx: number
  /** Endpoints closer than this become one vertex, pixels. */
  snapTolerancePx: number
  /** Pull segments within this many degrees of an axis onto it. 0 disables. */
  orthoToleranceDeg: number
  /** Merge two segments meeting almost straight, within this many degrees. */
  collinearToleranceDeg: number
  /** Discard resulting walls shorter than this, pixels. */
  minWallLengthPx: number
}

export const DEFAULT_VECTORIZE_OPTIONS: VectorizeOptions = {
  simplifyEpsilonPx: 3,
  spurLengthPx: 12,
  snapTolerancePx: 8,
  orthoToleranceDeg: 6,
  collinearToleranceDeg: 8,
  minWallLengthPx: 10,
}

export function vectorizeSkeleton(
  skel: Uint8Array,
  maskDist2: Float64Array,
  width: number,
  height: number,
  opts: VectorizeOptions,
): TracedWall[] {
  const graph = buildPixelGraph(skel, width, height)
  const chains = pruneDanglingBranches(graph, opts.spurLengthPx)

  // Chains -> polylines -> straight segments, collecting endpoints into one
  // shared coordinate list so the cleanup passes can weld them.
  const coords: number[] = []
  const rawPairs: Array<[number, number]> = []

  for (const chain of chains) {
    const simplified = simplifyPolyline(chain.pts, opts.simplifyEpsilonPx)
    for (let i = 2; i < simplified.length; i += 2) {
      const ai = coords.length / 2
      coords.push(simplified[i - 2], simplified[i - 1])
      const bi = coords.length / 2
      coords.push(simplified[i], simplified[i + 1])
      rawPairs.push([ai, bi])
    }
  }

  const { points, remap } = clusterPoints(coords, opts.snapTolerancePx)
  let segments: RawSegment[] = rawPairs
    .map(([ai, bi]) => ({ ai: remap[ai], bi: remap[bi] }))
    .filter((s) => s.ai !== s.bi)

  orthogonalSnap(points, segments, opts.orthoToleranceDeg)
  segments = mergeCollinear(points, segments, opts.collinearToleranceDeg)

  // Deduplicate segments that ended up identical after welding.
  const seen = new Set<string>()
  const walls: TracedWall[] = []
  for (const seg of segments) {
    const lo = Math.min(seg.ai, seg.bi)
    const hi = Math.max(seg.ai, seg.bi)
    const key = `${lo}:${hi}`
    if (seen.has(key)) continue
    seen.add(key)

    const a = points[seg.ai]
    const b = points[seg.bi]
    if (Math.hypot(b.x - a.x, b.y - a.y) < opts.minWallLengthPx) continue

    walls.push({
      id: `w${walls.length}`,
      a: { x: a.x, y: a.y },
      b: { x: b.x, y: b.y },
      thicknessPx: measureThickness(a, b, maskDist2, width, height),
    })
  }

  return walls
}
