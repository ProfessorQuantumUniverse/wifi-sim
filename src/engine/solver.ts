/**
 * Turns an edited Scene into a TraceScene, then sweeps a receiver grid.
 */

import type { Scene, Surface, Vec3 } from '../scene/model'
import { compileScene, sceneBounds, wallLength } from '../scene/model'
import { ITU_MATERIALS, type CustomMaterial, type MaterialDefinition } from '../physics/materials'
import type { StackLayer } from '../physics/layerStack'
import type { AntennaSpec } from '../physics/antenna'
import type { MountingKind } from './mounting'
import { peakGainDbi } from '../physics/antenna'
import {
  coherentSum,
  incoherentSum,
  significantReflectors,
  tracePaths,
  TraceScene,
  type DiffractionEdge,
  type PropagationPath,
  type TraceOptions,
} from './tracer'
import {
  channelCentreMHz,
  channelOverlapFraction,
  checkCompliance,
  noiseFloorDbm,
  selectRate,
  throughput,
  DEFAULT_MAC,
  type Band,
  type ChannelWidthMHz,
  type Generation,
  type MacParameters,
  type RegulatoryDomain,
} from './linkBudget'

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface AccessPointConfig {
  id: string
  name: string
  /** Plan position, metres. */
  x: number
  y: number
  heightM: number
  enabled: boolean

  band: Band
  channel: number
  widthMHz: ChannelWidthMHz
  generation: Generation
  guardIntervalUs: number
  spatialStreams: number

  /** Power delivered to the antenna connector, dBm. */
  conductedPowerDbm: number
  /** Feeder/connector loss between radio and antenna, dB. */
  cableLossDb: number
  antenna: AntennaSpec
  /** How it is installed — sets the height, the antenna tilt and the enclosure. */
  mounting: MountingKind
  /**
   * Loss of whatever sits immediately in front of the antenna (a cabinet door,
   * a screen back). Applies in every direction, before any wall loss.
   */
  enclosureLossDb: number
}

export interface ClientConfig {
  heightM: number
  antenna: AntennaSpec
  /** Receive chains; caps the usable spatial streams together with the AP's. */
  antennaCount: number
  noiseFigureDb: number
  /** Attenuation from the user's hand and body, dB. */
  bodyLossDb: number
  /** Chipset margin relative to the IEEE reference receiver, dB. */
  implementationMarginDb: number
}

export interface GridSpec {
  minX: number
  minY: number
  maxX: number
  maxY: number
  /** Cell size, metres. */
  resolutionM: number
  /** Height above the floor the map is evaluated at, metres. */
  heightM: number
}

export interface SolveSettings {
  domain: RegulatoryDomain
  trace: TraceOptions
  mac: MacParameters
  /** Report the coherent sum (shows standing waves) or the local average. */
  combining: 'coherent' | 'incoherent'
  /**
   * Neighbouring networks, already calibrated to a conducted power so the
   * worker does not have to redo the back-solve on every run.
   */
  externalSources: Array<{ ap: AccessPointConfig; conductedDbm: number }>
}

// ---------------------------------------------------------------------------
// Scene adaptation
// ---------------------------------------------------------------------------

export function buildMaterialMap(custom: CustomMaterial[]): Map<string, MaterialDefinition> {
  const m = new Map<string, MaterialDefinition>()
  for (const x of ITU_MATERIALS) m.set(x.id, x)
  for (const x of custom) m.set(x.id, x)
  return m
}

/**
 * Diffraction edges, taken straight from the scene rather than by analysing
 * surface adjacency: the vertical jambs plus head and sill of every opening,
 * and a vertical edge at any wall end that no other wall meets. Those are
 * exactly the discontinuities that cast a shadow boundary indoors.
 */
function collectEdges(scene: Scene, surfaces: Surface[]): DiffractionEdge[] {
  const edges: DiffractionEdge[] = []
  const facetForWall = new Map<string, number>()
  surfaces.forEach((s, i) => {
    if (s.role === 'wall' && !facetForWall.has(s.sourceId)) facetForWall.set(s.sourceId, i)
  })

  const JOIN_TOL = 0.15
  const endpoints: Vec3[] = []
  for (const w of scene.walls) {
    endpoints.push({ x: w.a.x, y: w.a.y, z: 0 }, { x: w.b.x, y: w.b.y, z: 0 })
  }
  const isShared = (x: number, y: number): boolean => {
    let count = 0
    for (const p of endpoints) {
      if (Math.hypot(p.x - x, p.y - y) < JOIN_TOL) count++
      if (count > 1) return true
    }
    return false
  }

  for (const wall of scene.walls) {
    const facetIndex = facetForWall.get(wall.id)
    if (facetIndex === undefined) continue

    // Free wall ends.
    for (const p of [wall.a, wall.b]) {
      if (isShared(p.x, p.y)) continue
      edges.push({
        a: { x: p.x, y: p.y, z: wall.baseM },
        b: { x: p.x, y: p.y, z: wall.topM },
        facetIndex,
      })
    }

    // Opening apertures.
    const len = wallLength(wall)
    if (len < 1e-6) continue
    const ux = (wall.b.x - wall.a.x) / len
    const uy = (wall.b.y - wall.a.y) / len
    for (const o of wall.openings) {
      const s0 = Math.max(0, o.offsetM)
      const s1 = Math.min(len, o.offsetM + o.widthM)
      if (s1 - s0 < 1e-6 || o.headM - o.sillM < 1e-6) continue
      const at = (s: number, z: number): Vec3 => ({
        x: wall.a.x + ux * s,
        y: wall.a.y + uy * s,
        z,
      })
      // Two jambs, head and sill.
      edges.push({ a: at(s0, o.sillM), b: at(s0, o.headM), facetIndex })
      edges.push({ a: at(s1, o.sillM), b: at(s1, o.headM), facetIndex })
      edges.push({ a: at(s0, o.headM), b: at(s1, o.headM), facetIndex })
      if (o.sillM > 1e-3) edges.push({ a: at(s0, o.sillM), b: at(s1, o.sillM), facetIndex })
    }
  }

  return edges
}

export function buildTraceScene(
  scene: Scene,
  customMaterials: CustomMaterial[],
  freqHz: number,
): TraceScene {
  const surfaces = compileScene(scene)
  const stacks = new Map<string, StackLayer[]>()
  for (const t of scene.wallTypes) stacks.set(t.id, t.layers)
  return new TraceScene(
    surfaces,
    stacks,
    buildMaterialMap(customMaterials),
    freqHz,
    collectEdges(scene, surfaces),
  )
}

/** EIRP, and whether it is within the domain's limit for that channel. */
export function accessPointPower(ap: AccessPointConfig, domain: RegulatoryDomain) {
  const gain = peakGainDbi(ap.antenna)
  // The enclosure sits outside the antenna, so it reduces what actually gets
  // radiated — but it is not part of the EIRP a regulator measures at the
  // antenna, so compliance is checked before it and propagation after it.
  const effectiveConducted = ap.conductedPowerDbm - ap.cableLossDb
  const eirpDbm = effectiveConducted + gain
  const centreMHz = channelCentreMHz(ap.band, ap.channel)
  return {
    gainDbi: gain,
    effectiveConductedDbm: effectiveConducted,
    /** What the tracer launches with: conducted power after the enclosure. */
    radiatedConductedDbm: effectiveConducted - (ap.enclosureLossDb ?? 0),
    eirpDbm,
    centreMHz,
    freqHz: centreMHz * 1e6,
    compliance: checkCompliance(domain, centreMHz, ap.widthMHz, eirpDbm),
  }
}

// ---------------------------------------------------------------------------
// Grid solve
// ---------------------------------------------------------------------------

export interface GridResult {
  cols: number
  rows: number
  spec: GridSpec
  /** Received power from the best-serving AP, dBm. */
  rssiDbm: Float32Array
  sinrDb: Float32Array
  mcs: Int8Array
  phyRateMbps: Float32Array
  throughputMbps: Float32Array
  /** Index into the AP list, or -1 where nothing is receivable. */
  bestAp: Int16Array
  pathCount: Int32Array
  /** Received power per AP, dBm; outer index is the AP. */
  perApRssiDbm: Float32Array[]
  /** Received power per neighbouring network, dBm. */
  perExternalRssiDbm: Float32Array[]
  /** Total co- and adjacent-channel interference at the serving channel, dBm. */
  interferenceDbm: Float32Array
}

const NO_SIGNAL_DBM = -200

export function defaultGridFor(scene: Scene, resolutionM = 0.35, heightM = 1.1): GridSpec | null {
  const b = sceneBounds(scene)
  if (!b) return null
  return {
    minX: b.minX,
    minY: b.minY,
    maxX: b.maxX,
    maxY: b.maxY,
    resolutionM,
    heightM,
  }
}

/**
 * Received power at one point from one AP, in dBm, plus the paths that produced
 * it. `combining` selects the coherent sum (with its interference fringes) or
 * the incoherent local average.
 */
export function receivedPowerDbm(
  traceScene: TraceScene,
  ap: AccessPointConfig,
  conductedDbm: number,
  point: Vec3,
  client: ClientConfig,
  options: TraceOptions,
  combining: 'coherent' | 'incoherent',
  secondOrderSet?: ReturnType<typeof significantReflectors>,
): { dbm: number; paths: PropagationPath[] } {
  const paths = tracePaths(
    traceScene,
    { position: { x: ap.x, y: ap.y, z: ap.heightM }, antenna: ap.antenna },
    { position: point, antenna: client.antenna },
    options,
    secondOrderSet,
  )
  if (paths.length === 0) return { dbm: NO_SIGNAL_DBM, paths }

  let gain: number
  if (combining === 'coherent') {
    const h = coherentSum(paths)
    gain = h.re * h.re + h.im * h.im
  } else {
    gain = incoherentSum(paths)
  }
  if (!(gain > 0)) return { dbm: NO_SIGNAL_DBM, paths }
  return { dbm: conductedDbm + 10 * Math.log10(gain) - client.bodyLossDb, paths }
}

export interface SolveProgress {
  (done: number, total: number): void
}

/**
 * Sweep the grid for every enabled AP. Each AP gets its own TraceScene because
 * the stack coefficient tables are frequency-specific.
 */
export function solveGrid(
  scene: Scene,
  customMaterials: CustomMaterial[],
  aps: AccessPointConfig[],
  client: ClientConfig,
  spec: GridSpec,
  settings: SolveSettings,
  onProgress?: SolveProgress,
): GridResult {
  const cols = Math.max(1, Math.ceil((spec.maxX - spec.minX) / spec.resolutionM) + 1)
  const rows = Math.max(1, Math.ceil((spec.maxY - spec.minY) / spec.resolutionM) + 1)
  const cells = cols * rows
  const active = aps.filter((a) => a.enabled)

  const perApRssiDbm = active.map(() => new Float32Array(cells).fill(NO_SIGNAL_DBM))
  const pathCount = new Int32Array(cells)

  const makeContext = (ap: AccessPointConfig, conductedOverride?: number) => {
    const power = accessPointPower(ap, settings.domain)
    const traceScene = buildTraceScene(scene, customMaterials, power.freqHz)
    return {
      ap,
      power,
      conductedDbm: conductedOverride ?? power.radiatedConductedDbm,
      traceScene,
      secondOrder:
        settings.trace.maxReflectionOrder >= 2
          ? significantReflectors(traceScene, settings.trace.secondOrderReflectorCap)
          : undefined,
    }
  }

  const contexts = active.map((ap) => makeContext(ap))
  const externals = (settings.externalSources ?? [])
    .filter((e) => e.ap.enabled)
    .map((e) => makeContext(e.ap, e.conductedDbm))
  const perExternalRssiDbm = externals.map(() => new Float32Array(cells).fill(NO_SIGNAL_DBM))

  let done = 0
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const index = row * cols + col
      const point: Vec3 = {
        x: spec.minX + col * spec.resolutionM,
        y: spec.minY + row * spec.resolutionM,
        z: spec.heightM,
      }

      for (let a = 0; a < contexts.length; a++) {
        const ctx = contexts[a]
        const result = receivedPowerDbm(
          ctx.traceScene,
          ctx.ap,
          ctx.conductedDbm,
          point,
          client,
          settings.trace,
          settings.combining,
          ctx.secondOrder,
        )
        perApRssiDbm[a][index] = result.dbm
        pathCount[index] += result.paths.length
      }

      for (let e = 0; e < externals.length; e++) {
        const ctx = externals[e]
        perExternalRssiDbm[e][index] = receivedPowerDbm(
          ctx.traceScene,
          ctx.ap,
          ctx.conductedDbm,
          point,
          client,
          settings.trace,
          settings.combining,
          ctx.secondOrder,
        ).dbm
      }

      done++
      if (onProgress && done % 256 === 0) onProgress(done, cells)
    }
  }

  // Best server, SINR against co-channel neighbours, then rate.
  const rssiDbm = new Float32Array(cells).fill(NO_SIGNAL_DBM)
  const sinrDb = new Float32Array(cells).fill(-50)
  const mcs = new Int8Array(cells).fill(-1)
  const phyRateMbps = new Float32Array(cells)
  const throughputMbps = new Float32Array(cells)
  const bestAp = new Int16Array(cells).fill(-1)
  const interferenceDbm = new Float32Array(cells).fill(NO_SIGNAL_DBM)

  for (let i = 0; i < cells; i++) {
    let best = -1
    let bestDbm = NO_SIGNAL_DBM
    for (let a = 0; a < contexts.length; a++) {
      if (perApRssiDbm[a][i] > bestDbm) {
        bestDbm = perApRssiDbm[a][i]
        best = a
      }
    }
    if (best < 0 || bestDbm <= NO_SIGNAL_DBM + 1) continue

    const ctx = contexts[best]
    const noise = noiseFloorDbm(ctx.ap.widthMHz, client.noiseFigureDb)

    // Co- and adjacent-channel interference from the other APs and from every
    // neighbouring network, weighted by how much of each one's occupied
    // spectrum falls inside the serving channel.
    let interferenceMw = 0
    const addInterference = (
      centreMHz: number,
      widthMHz: number,
      rssiDbm: number,
    ): void => {
      const fraction = channelOverlapFraction(
        ctx.power.centreMHz,
        ctx.ap.widthMHz,
        centreMHz,
        widthMHz,
      )
      if (fraction <= 0 || rssiDbm <= NO_SIGNAL_DBM + 1) return
      interferenceMw += Math.pow(10, rssiDbm / 10) * fraction
    }

    for (let a = 0; a < contexts.length; a++) {
      if (a === best) continue
      addInterference(contexts[a].power.centreMHz, contexts[a].ap.widthMHz, perApRssiDbm[a][i])
    }
    for (let e = 0; e < externals.length; e++) {
      addInterference(
        externals[e].power.centreMHz,
        externals[e].ap.widthMHz,
        perExternalRssiDbm[e][i],
      )
    }
    interferenceDbm[i] = interferenceMw > 0 ? 10 * Math.log10(interferenceMw) : NO_SIGNAL_DBM

    const noiseMw = Math.pow(10, noise / 10)
    const signalMw = Math.pow(10, bestDbm / 10)
    const sinr = 10 * Math.log10(signalMw / (noiseMw + interferenceMw))

    const streams = Math.min(ctx.ap.spatialStreams, client.antennaCount)
    const rate = selectRate(
      sinr,
      ctx.ap.generation,
      ctx.ap.widthMHz,
      streams,
      ctx.ap.guardIntervalUs,
      client.implementationMarginDb,
    )
    const tp = throughput(rate.phyRateBps, settings.mac)

    rssiDbm[i] = bestDbm
    sinrDb[i] = sinr
    mcs[i] = rate.mcs
    phyRateMbps[i] = rate.phyRateBps / 1e6
    throughputMbps[i] = tp.throughputBps / 1e6
    bestAp[i] = best
  }

  return {
    cols,
    rows,
    spec,
    rssiDbm,
    sinrDb,
    mcs,
    phyRateMbps,
    throughputMbps,
    bestAp,
    pathCount,
    perApRssiDbm,
    perExternalRssiDbm,
    interferenceDbm,
  }
}

export const DEFAULT_CLIENT: ClientConfig = {
  heightM: 1.1,
  antenna: {
    kind: 'dipole',
    boresight: { x: 0, y: 0, z: 1 },
    reference: { x: 1, y: 0, z: 0 },
  },
  antennaCount: 2,
  noiseFigureDb: 7,
  bodyLossDb: 3,
  implementationMarginDb: 5,
}

export const DEFAULT_SOLVE_SETTINGS: Omit<SolveSettings, 'trace'> = {
  domain: 'etsi',
  mac: DEFAULT_MAC,
  combining: 'incoherent',
  externalSources: [],
}
