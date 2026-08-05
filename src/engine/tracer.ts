/**
 * Deterministic multipath solver.
 *
 * Rather than launching random rays and collecting them in reception spheres,
 * paths are enumerated and solved in closed form by the method of images:
 *
 *   order 0  direct path, attenuated by every surface it crosses
 *   order 1  one specular reflection, plus transmissions on both legs
 *   order 2  two specular reflections (restricted to the largest reflectors)
 *   diffraction  single UTD edge diffraction, plus transmissions on both legs
 *
 * The consequences matter: every path's length, incidence angles and phase are
 * exact rather than quantised by ray spacing, the result is reproducible with no
 * Monte-Carlo noise, and there is no reception-sphere double counting to
 * compensate for. The price is the order-2 reflector cap, which is applied to
 * the largest surfaces first (floor, ceiling, long walls) because those carry
 * essentially all of the second-order energy indoors.
 *
 * Because walls are zero-thickness surfaces carrying a multilayer stack, a
 * transmitted ray continues in a straight line: the stack's transfer matrix
 * already contains the internal refraction and multiple reflections. That is
 * what makes closed-form image solving valid here even with transmissions.
 */

import {
  cAdd,
  cAbs2,
  cMul,
  cScale,
  C,
  type Complex,
} from '../physics/complex'
import { C_LIGHT, type MaterialDefinition } from '../physics/materials'
import { solveStack, type StackLayer } from '../physics/layerStack'
import { utdDiffractionCoefficient } from '../physics/utd'
import { evaluateAntenna, type AntennaSpec } from '../physics/antenna'
import type { Surface, Vec3 } from '../scene/model'
import {
  Bvh,
  buildFacets,
  vAdd,
  vCross,
  vDot,
  vLen,
  vNorm,
  vScale,
  vSub,
  v3,
  type Facet,
} from './geometry'

// ---------------------------------------------------------------------------
// Complex 3-vectors, the polarisation state carried along a path
// ---------------------------------------------------------------------------

interface CVec3 {
  x: Complex
  y: Complex
  z: Complex
}

const cvFromReal = (v: Vec3): CVec3 => ({ x: C(v.x), y: C(v.y), z: C(v.z) })

const cvScale = (v: CVec3, s: Complex): CVec3 => ({
  x: cMul(v.x, s),
  y: cMul(v.y, s),
  z: cMul(v.z, s),
})

const cvAdd = (a: CVec3, b: CVec3): CVec3 => ({
  x: cAdd(a.x, b.x),
  y: cAdd(a.y, b.y),
  z: cAdd(a.z, b.z),
})

/** Projection of a complex field vector onto a real unit vector. */
function cvDotReal(v: CVec3, r: Vec3): Complex {
  return {
    re: v.x.re * r.x + v.y.re * r.y + v.z.re * r.z,
    im: v.x.im * r.x + v.y.im * r.y + v.z.im * r.z,
  }
}

const cvNorm2 = (v: CVec3): number => cAbs2(v.x) + cAbs2(v.y) + cAbs2(v.z)

// ---------------------------------------------------------------------------
// Stack coefficient lookup
// ---------------------------------------------------------------------------

const ANGLE_BINS = 181 // 0.5 degree resolution from 0 to 90

export interface StackCoefficients {
  rTE: Float64Array
  rTM: Float64Array
  tTE: Float64Array
  tTM: Float64Array
}

/**
 * Precompute reflection and transmission coefficients versus incidence angle
 * for one build-up at one frequency. Interleaved [re, im] pairs.
 */
function tabulateStack(
  layers: StackLayer[],
  materials: Map<string, MaterialDefinition>,
  freqHz: number,
): StackCoefficients {
  const rTE = new Float64Array(ANGLE_BINS * 2)
  const rTM = new Float64Array(ANGLE_BINS * 2)
  const tTE = new Float64Array(ANGLE_BINS * 2)
  const tTM = new Float64Array(ANGLE_BINS * 2)

  for (let i = 0; i < ANGLE_BINS; i++) {
    // Clamp just short of grazing: at exactly 90 degrees the TM admittance
    // diverges and the solution is meaningless.
    const angle = Math.min((i / (ANGLE_BINS - 1)) * (Math.PI / 2), Math.PI / 2 - 1e-4)
    const te = solveStack(layers, materials, freqHz, angle, 'TE').solution
    const tm = solveStack(layers, materials, freqHz, angle, 'TM').solution
    rTE[i * 2] = te.r.re
    rTE[i * 2 + 1] = te.r.im
    tTE[i * 2] = te.t.re
    tTE[i * 2 + 1] = te.t.im
    rTM[i * 2] = tm.r.re
    rTM[i * 2 + 1] = tm.r.im
    tTM[i * 2] = tm.t.re
    tTM[i * 2 + 1] = tm.t.im
  }
  return { rTE, rTM, tTE, tTM }
}

function sample(table: Float64Array, cosIncidence: number): Complex {
  const angle = Math.acos(Math.max(0, Math.min(1, cosIncidence)))
  const pos = (angle / (Math.PI / 2)) * (ANGLE_BINS - 1)
  const i0 = Math.max(0, Math.min(ANGLE_BINS - 1, Math.floor(pos)))
  const i1 = Math.min(ANGLE_BINS - 1, i0 + 1)
  const f = pos - i0
  return {
    re: table[i0 * 2] * (1 - f) + table[i1 * 2] * f,
    im: table[i0 * 2 + 1] * (1 - f) + table[i1 * 2 + 1] * f,
  }
}

// ---------------------------------------------------------------------------
// Scene compilation for the engine
// ---------------------------------------------------------------------------

export interface DiffractionEdge {
  a: Vec3
  b: Vec3
  /** The surface the edge belongs to, for its face reflection coefficients. */
  facetIndex: number
}

export class TraceScene {
  readonly bvh: Bvh
  readonly facets: Facet[]
  readonly coefficients: Map<string, StackCoefficients>
  readonly edges: DiffractionEdge[]
  readonly freqHz: number
  readonly wavelength: number
  readonly k: number

  constructor(
    surfaces: Surface[],
    stacksByType: Map<string, StackLayer[]>,
    materials: Map<string, MaterialDefinition>,
    freqHz: number,
    edges: DiffractionEdge[],
  ) {
    this.facets = buildFacets(surfaces)
    this.bvh = new Bvh(this.facets)
    this.freqHz = freqHz
    this.wavelength = C_LIGHT / freqHz
    this.k = (2 * Math.PI) / this.wavelength
    this.edges = edges

    this.coefficients = new Map()
    for (const [typeId, layers] of stacksByType) {
      this.coefficients.set(typeId, tabulateStack(layers, materials, freqHz))
    }
  }

  coefficientsFor(facet: Facet): StackCoefficients | undefined {
    return this.coefficients.get(facet.surface.typeId)
  }
}

// ---------------------------------------------------------------------------
// Path representation
// ---------------------------------------------------------------------------

export type InteractionKind = 'transmission' | 'reflection' | 'diffraction'

export interface PathInteraction {
  kind: InteractionKind
  point: Vec3
  surfaceId: string
  role: string
  /** Incidence angle from the normal, degrees. */
  incidenceDeg: number
}

export interface PropagationPath {
  /** Total unfolded length, m. */
  lengthM: number
  /** Complex channel coefficient; received power = |h|^2 * transmit power. */
  h: Complex
  /** Power carried by this path relative to the transmit power, linear. */
  gain: number
  reflections: number
  transmissions: number
  diffractions: number
  interactions: PathInteraction[]
  /** Arrival direction at the receiver (unit, pointing from the last hop). */
  arrivalDir: Vec3
  departureDir: Vec3
}

export interface TraceOptions {
  maxReflectionOrder: 0 | 1 | 2
  /** Second-order reflections consider only this many largest reflectors. */
  secondOrderReflectorCap: number
  enableDiffraction: boolean
  /** Discard a path once its power is this many dB below the strongest. */
  dynamicRangeDb: number
  /** Stop transmitting through walls after this many. */
  maxTransmissions: number
}

export const DEFAULT_TRACE_OPTIONS: TraceOptions = {
  maxReflectionOrder: 2,
  secondOrderReflectorCap: 40,
  enableDiffraction: true,
  dynamicRangeDb: 45,
  maxTransmissions: 8,
}

// ---------------------------------------------------------------------------
// Field propagation along a polyline
// ---------------------------------------------------------------------------

/**
 * Apply one surface interaction to the carried field. `dirIn` is the incoming
 * unit direction; returns the new field and outgoing direction.
 */
function applyInteraction(
  scene: TraceScene,
  facet: Facet,
  field: CVec3,
  dirIn: Vec3,
  reflect: boolean,
): { field: CVec3; dirOut: Vec3 } | null {
  const coeffs = scene.coefficientsFor(facet)
  if (!coeffs) return null

  const cosIncidence = Math.abs(vDot(dirIn, facet.normal))
  // Perpendicular (TE) direction: normal to the plane of incidence.
  let perp = vCross(dirIn, facet.normal)
  const perpLen = vLen(perp)
  if (perpLen < 1e-8) {
    // Normal incidence: the plane of incidence is undefined, so any transverse
    // pair works and TE/TM coincide.
    const seed = Math.abs(dirIn.z) > 0.9 ? v3(1, 0, 0) : v3(0, 0, 1)
    perp = vNorm(vCross(dirIn, seed))
  } else {
    perp = vScale(perp, 1 / perpLen)
  }
  const parIn = vCross(perp, dirIn)

  const cPerp = cvDotReal(field, perp)
  const cPar = cvDotReal(field, parIn)

  const dirOut = reflect
    ? vNorm(vSub(dirIn, vScale(facet.normal, 2 * vDot(dirIn, facet.normal))))
    : dirIn
  const parOut = vCross(perp, dirOut)

  const teCoeff = sample(reflect ? coeffs.rTE : coeffs.tTE, cosIncidence)
  const tmCoeff = sample(reflect ? coeffs.rTM : coeffs.tTM, cosIncidence)

  const out = cvAdd(
    cvScale(cvFromReal(perp), cMul(cPerp, teCoeff)),
    cvScale(cvFromReal(parOut), cMul(cPar, tmCoeff)),
  )
  return { field: out, dirOut }
}

/**
 * Walk a straight leg, applying every surface it crosses as a transmission.
 * `skip` holds facet indices to ignore (the reflectors that define the path).
 */
function traverseLeg(
  scene: TraceScene,
  from: Vec3,
  to: Vec3,
  field: CVec3,
  dir: Vec3,
  skip: Set<number>,
  interactions: PathInteraction[],
  budget: { transmissions: number },
): CVec3 | null {
  let current = field
  for (const hit of scene.bvh.crossingsBetween(from, to)) {
    if (skip.has(hit.facet.index)) continue
    if (budget.transmissions <= 0) return null
    budget.transmissions--

    const applied = applyInteraction(scene, hit.facet, current, dir, false)
    if (!applied) continue
    current = applied.field
    interactions.push({
      kind: 'transmission',
      point: hit.point,
      surfaceId: hit.facet.surface.id,
      role: hit.facet.surface.role,
      incidenceDeg: (Math.acos(Math.min(1, hit.cosIncidence)) * 180) / Math.PI,
    })
    if (cvNorm2(current) < 1e-14) return null
  }
  return current
}

// ---------------------------------------------------------------------------
// Path enumeration
// ---------------------------------------------------------------------------

export interface Transmitter {
  position: Vec3
  antenna: AntennaSpec
}

export interface Receiver {
  position: Vec3
  antenna: AntennaSpec
}

/** Mirror a point through a facet's plane. */
function mirror(point: Vec3, facet: Facet): Vec3 {
  const distance = vDot(facet.normal, point) - facet.d
  return vSub(point, vScale(facet.normal, 2 * distance))
}

/** Signed distance of a point from a facet's plane. */
const planeDistance = (point: Vec3, facet: Facet): number =>
  vDot(facet.normal, point) - facet.d

/**
 * Where the segment from `a` to `b` meets a facet's plane, if it lies inside the
 * facet rectangle. Returns null otherwise.
 */
function planeHitInsideFacet(a: Vec3, b: Vec3, facet: Facet): Vec3 | null {
  const da = planeDistance(a, facet)
  const db = planeDistance(b, facet)
  const denom = da - db
  if (Math.abs(denom) < 1e-12) return null
  const t = da / denom
  if (t <= 1e-6 || t >= 1 - 1e-6) return null
  const point = vAdd(a, vScale(vSub(b, a), t))

  const rel = vSub(point, facet.surface.p0)
  const u = vDot(rel, facet.e1) * facet.invLen1Sq
  if (u < 0 || u > 1) return null
  const v = vDot(rel, facet.e2) * facet.invLen2Sq
  if (v < 0 || v > 1) return null
  return point
}

/**
 * Assemble the channel coefficient for a polyline path through `points`
 * (transmitter first, receiver last) reflecting off `reflectors` in order.
 */
function buildSpecularPath(
  scene: TraceScene,
  tx: Transmitter,
  rx: Receiver,
  points: Vec3[],
  reflectors: Facet[],
  options: TraceOptions,
): PropagationPath | null {
  const skip = new Set(reflectors.map((f) => f.index))
  const interactions: PathInteraction[] = []
  const budget = { transmissions: options.maxTransmissions }

  const departureDir = vNorm(vSub(points[1], points[0]))
  const txResponse = evaluateAntenna(tx.antenna, departureDir)
  if (txResponse.gainLinear <= 0) return null

  let field: CVec3 = cvFromReal(txResponse.polarisation)
  let dir = departureDir
  let length = 0

  for (let i = 0; i < points.length - 1; i++) {
    const from = points[i]
    const to = points[i + 1]
    dir = vNorm(vSub(to, from))
    length += vLen(vSub(to, from))

    const after = traverseLeg(scene, from, to, field, dir, skip, interactions, budget)
    if (!after) return null
    field = after

    if (i < reflectors.length) {
      const facet = reflectors[i]
      const applied = applyInteraction(scene, facet, field, dir, true)
      if (!applied) return null
      field = applied.field
      interactions.push({
        kind: 'reflection',
        point: to,
        surfaceId: facet.surface.id,
        role: facet.surface.role,
        incidenceDeg:
          (Math.acos(Math.min(1, Math.abs(vDot(dir, facet.normal)))) * 180) / Math.PI,
      })
      dir = applied.dirOut
      if (cvNorm2(field) < 1e-14) return null
    }
  }

  const arrivalDir = dir
  const rxResponse = evaluateAntenna(rx.antenna, vScale(arrivalDir, -1))
  if (rxResponse.gainLinear <= 0) return null

  // Free-space propagator with the unfolded path length, plus antenna gains and
  // the polarisation projection onto the receive antenna.
  const spread = scene.wavelength / (4 * Math.PI * length)
  const phase = C(Math.cos(-scene.k * length), Math.sin(-scene.k * length))
  const polProjection = cvDotReal(field, rxResponse.polarisation)
  const amplitude =
    spread * Math.sqrt(txResponse.gainLinear) * Math.sqrt(rxResponse.gainLinear)

  const h = cScale(cMul(polProjection, phase), amplitude)
  if (!Number.isFinite(h.re) || !Number.isFinite(h.im)) return null

  return {
    lengthM: length,
    h,
    gain: cAbs2(h),
    reflections: reflectors.length,
    transmissions: interactions.filter((i) => i.kind === 'transmission').length,
    diffractions: 0,
    interactions,
    arrivalDir,
    departureDir,
  }
}

/**
 * Diffraction point on a straight edge for given source and field points.
 * For a straight edge the Keller cone condition (equal angles to the edge)
 * reduces to the same "mirror" split as a planar reflection, using the
 * perpendicular distances from each end point to the edge line.
 */
function diffractionPoint(edgeA: Vec3, edgeB: Vec3, source: Vec3, field: Vec3): Vec3 | null {
  const axis = vSub(edgeB, edgeA)
  const edgeLen = vLen(axis)
  if (edgeLen < 1e-6) return null
  const e = vScale(axis, 1 / edgeLen)

  const projectOn = (p: Vec3) => vDot(vSub(p, edgeA), e)
  const perpDist = (p: Vec3) => {
    const along = projectOn(p)
    const foot = vAdd(edgeA, vScale(e, along))
    return vLen(vSub(p, foot))
  }

  const sAlong = projectOn(source)
  const fAlong = projectOn(field)
  const sPerp = perpDist(source)
  const fPerp = perpDist(field)
  const total = sPerp + fPerp
  if (total < 1e-9) return null

  const along = sAlong + ((fAlong - sAlong) * sPerp) / total
  if (along < 0 || along > edgeLen) return null // diffraction point falls off the edge
  return vAdd(edgeA, vScale(e, along))
}

function buildDiffractionPath(
  scene: TraceScene,
  tx: Transmitter,
  rx: Receiver,
  edge: DiffractionEdge,
  options: TraceOptions,
): PropagationPath | null {
  const qd = diffractionPoint(edge.a, edge.b, tx.position, rx.position)
  if (!qd) return null

  const facet = scene.facets[edge.facetIndex]
  const toEdge = vSub(qd, tx.position)
  const sPrime = vLen(toEdge)
  const fromEdge = vSub(rx.position, qd)
  const s = vLen(fromEdge)
  if (sPrime < 1e-3 || s < 1e-3) return null

  const dirIn = vScale(toEdge, 1 / sPrime)
  const dirOut = vScale(fromEdge, 1 / s)
  const edgeAxis = vNorm(vSub(edge.b, edge.a))

  // Keller cone half-angle.
  const beta0 = Math.acos(Math.max(-1, Math.min(1, Math.abs(vDot(dirIn, edgeAxis)))))
  const sinBeta0 = Math.sin(beta0)
  if (sinBeta0 < 1e-3) return null

  // Face-local azimuths, measured from the surface in the plane perpendicular
  // to the edge. `faceDir` lies in the surface, perpendicular to the edge, and
  // must point from the edge *into* the face: it is the phi = 0 reference, so
  // getting its sign wrong swaps the lit and shadow regions and makes the
  // diffracted field add where it should subtract.
  //
  // cross(normal, edgeAxis) has the right axis but a sign that depends on which
  // way round the wall happened to be drawn, so the direction is taken from the
  // facet's own centroid instead, which cannot flip.
  const facetCentre = vScale(
    vAdd(vAdd(facet.surface.p0, facet.surface.p1), vAdd(facet.surface.p2, facet.surface.p3)),
    0.25,
  )
  const towardsCentre = vSub(facetCentre, qd)
  const inPlane = vSub(towardsCentre, vScale(edgeAxis, vDot(towardsCentre, edgeAxis)))
  const faceDir =
    vLen(inPlane) > 1e-9 ? vScale(inPlane, 1 / vLen(inPlane)) : vNorm(vCross(facet.normal, edgeAxis))
  const azimuth = (d: Vec3) => {
    const perp = vSub(d, vScale(edgeAxis, vDot(d, edgeAxis)))
    const len = vLen(perp)
    if (len < 1e-9) return 0
    const u = vScale(perp, 1 / len)
    let a = Math.atan2(vDot(u, facet.normal), vDot(u, faceDir))
    if (a < 0) a += 2 * Math.PI
    return a
  }
  // Incidence is measured for the ray travelling towards the edge.
  const phiPrime = azimuth(vScale(dirIn, -1))
  const phi = azimuth(dirOut)

  const departureDir = dirIn
  const txResponse = evaluateAntenna(tx.antenna, departureDir)
  const rxResponse = evaluateAntenna(rx.antenna, vScale(dirOut, -1))
  if (txResponse.gainLinear <= 0 || rxResponse.gainLinear <= 0) return null

  const interactions: PathInteraction[] = []
  const budget = { transmissions: options.maxTransmissions }
  const skip = new Set<number>([edge.facetIndex])

  let field: CVec3 = cvFromReal(txResponse.polarisation)
  const legIn = traverseLeg(scene, tx.position, qd, field, dirIn, skip, interactions, budget)
  if (!legIn) return null
  field = legIn

  // Face reflection coefficients at the diffraction geometry (Luebbers).
  const coeffs = scene.coefficientsFor(facet)
  if (!coeffs) return null
  const cosFace = Math.abs(Math.cos(phiPrime))
  const r0 = sample(coeffs.rTE, cosFace)
  const rN = sample(coeffs.rTM, cosFace)

  const d = utdDiffractionCoefficient({
    k: scene.k,
    sPrime,
    s,
    beta0,
    phiPrime,
    phi,
    n: 2, // zero-thickness surface: every free edge is a half-plane edge
    r0,
    rN,
  })

  const legOut = traverseLeg(scene, qd, rx.position, field, dirOut, skip, interactions, budget)
  if (!legOut) return null
  field = legOut

  interactions.push({
    kind: 'diffraction',
    point: qd,
    surfaceId: facet.surface.id,
    role: facet.surface.role,
    incidenceDeg: (beta0 * 180) / Math.PI,
  })

  // Diffracted field: E_i(Qd) * D * sqrt(s'/(s(s'+s))) * exp(-jks).
  const spreading = Math.sqrt(sPrime / (s * (sPrime + s)))
  const totalLength = sPrime + s
  const phase = C(Math.cos(-scene.k * totalLength), Math.sin(-scene.k * totalLength))
  const polProjection = cvDotReal(field, rxResponse.polarisation)

  const amplitude =
    (scene.wavelength / (4 * Math.PI)) *
    (1 / sPrime) *
    spreading *
    Math.sqrt(txResponse.gainLinear) *
    Math.sqrt(rxResponse.gainLinear)

  const h = cScale(cMul(cMul(polProjection, d), phase), amplitude)
  if (!Number.isFinite(h.re) || !Number.isFinite(h.im)) return null

  return {
    lengthM: totalLength,
    h,
    gain: cAbs2(h),
    reflections: 0,
    transmissions: interactions.filter((i) => i.kind === 'transmission').length,
    diffractions: 1,
    interactions,
    arrivalDir: dirOut,
    departureDir,
  }
}

/** Facets sorted by area, used to cap the second-order reflector set. */
export function significantReflectors(scene: TraceScene, cap: number): Facet[] {
  return [...scene.facets].sort((a, b) => b.areaM2 - a.areaM2).slice(0, cap)
}

/** All paths from one transmitter to one receiver. */
export function tracePaths(
  scene: TraceScene,
  tx: Transmitter,
  rx: Receiver,
  options: TraceOptions,
  secondOrderSet?: Facet[],
): PropagationPath[] {
  const paths: PropagationPath[] = []

  const direct = buildSpecularPath(scene, tx, rx, [tx.position, rx.position], [], options)
  if (direct) paths.push(direct)

  if (options.maxReflectionOrder >= 1) {
    for (const facet of scene.facets) {
      const dTx = planeDistance(tx.position, facet)
      const dRx = planeDistance(rx.position, facet)
      // A specular reflection needs both points strictly on the same side.
      if (dTx * dRx <= 0) continue
      const image = mirror(tx.position, facet)
      const q = planeHitInsideFacet(image, rx.position, facet)
      if (!q) continue
      const path = buildSpecularPath(scene, tx, rx, [tx.position, q, rx.position], [facet], options)
      if (path) paths.push(path)
    }
  }

  if (options.maxReflectionOrder >= 2) {
    const set = secondOrderSet ?? significantReflectors(scene, options.secondOrderReflectorCap)
    for (const f1 of set) {
      if (planeDistance(tx.position, f1) === 0) continue
      const image1 = mirror(tx.position, f1)
      for (const f2 of set) {
        if (f2.index === f1.index) continue
        if (planeDistance(rx.position, f2) * planeDistance(image1, f2) >= 0) continue
        const image2 = mirror(image1, f2)
        const q2 = planeHitInsideFacet(image2, rx.position, f2)
        if (!q2) continue
        const q1 = planeHitInsideFacet(image1, q2, f1)
        if (!q1) continue
        const path = buildSpecularPath(
          scene,
          tx,
          rx,
          [tx.position, q1, q2, rx.position],
          [f1, f2],
          options,
        )
        if (path) paths.push(path)
      }
    }
  }

  if (options.enableDiffraction) {
    for (const edge of scene.edges) {
      const path = buildDiffractionPath(scene, tx, rx, edge, options)
      if (path) paths.push(path)
    }
  }

  if (paths.length === 0) return paths

  // Trim anything far below the dominant path: it cannot move the sum.
  const strongest = Math.max(...paths.map((p) => p.gain))
  const floor = strongest * Math.pow(10, -options.dynamicRangeDb / 10)
  return paths.filter((p) => p.gain >= floor).sort((a, b) => b.gain - a.gain)
}

/** Coherent sum of a path set: the complex channel coefficient. */
export function coherentSum(paths: PropagationPath[]): Complex {
  let acc = C(0, 0)
  for (const p of paths) acc = cAdd(acc, p.h)
  return acc
}

/** Incoherent (power) sum: the local-average field a moving client sees. */
export function incoherentSum(paths: PropagationPath[]): number {
  let acc = 0
  for (const p of paths) acc += p.gain
  return acc
}
