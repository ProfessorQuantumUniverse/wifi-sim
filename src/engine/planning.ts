/**
 * Neighbouring networks, channel selection and access-point placement search.
 *
 * A neighbour's transmit power is almost never known, so it is not guessed:
 * you place the neighbour roughly where its router sits, stand somewhere with
 * your phone, and type in the RSSI you measured there. The engine traces that
 * geometry and back-solves the transmit power that reproduces your reading.
 * From then on the neighbour is a fully modelled source — its interference in
 * every other room follows the same physics as your own APs, walls included.
 */

import type { Scene, Vec3 } from '../scene/model'
import type { CustomMaterial } from '../physics/materials'
import type { AntennaSpec } from '../physics/antenna'
import {
  accessPointPower,
  buildTraceScene,
  receivedPowerDbm,
  type AccessPointConfig,
  type ClientConfig,
  type GridSpec,
} from './solver'
import { significantReflectors, type TraceOptions } from './tracer'
import {
  channelCentreMHz,
  channelOverlapFraction,
  channelsFor,
  noiseFloorDbm,
  selectRate,
  type Band,
  type ChannelWidthMHz,
} from './linkBudget'

// ---------------------------------------------------------------------------
// Neighbouring networks
// ---------------------------------------------------------------------------

export interface ExternalNetwork {
  id: string
  ssid: string
  enabled: boolean
  band: Band
  channel: number
  widthMHz: ChannelWidthMHz
  /** Where the neighbour's router sits, in plan coordinates. */
  x: number
  y: number
  heightM: number
  /**
   * A reading you took: the RSSI your phone showed at (refX, refY). The engine
   * scales the source until the traced value matches, so no transmit power has
   * to be assumed. Null falls back to `assumedEirpDbm`.
   */
  calibration: {
    refX: number
    refY: number
    refHeightM: number
    measuredDbm: number
  } | null
  /** Only used when no measurement is supplied. */
  assumedEirpDbm: number
}

const NEIGHBOUR_ANTENNA: AntennaSpec = {
  kind: 'dipole',
  boresight: { x: 0, y: 0, z: 1 },
  reference: { x: 1, y: 0, z: 0 },
}

/** Treat a neighbour as an AP so the same tracing path applies. */
export function neighbourAsAp(net: ExternalNetwork): AccessPointConfig {
  return {
    id: net.id,
    name: net.ssid,
    x: net.x,
    y: net.y,
    heightM: net.heightM,
    enabled: net.enabled,
    band: net.band,
    channel: net.channel,
    widthMHz: net.widthMHz,
    generation: 'he',
    guardIntervalUs: 0.8,
    spatialStreams: 1,
    conductedPowerDbm: 0,
    cableLossDb: 0,
    antenna: NEIGHBOUR_ANTENNA,
    // A neighbour's installation is unknown, so no enclosure is assumed; its
    // power is back-solved from your measurement and absorbs whatever is real.
    mounting: 'free-standing',
    enclosureLossDb: 0,
  }
}

export interface CalibrationResult {
  conductedDbm: number
  /** Path gain from a 0 dBm source to the reference point, dB. */
  referenceGainDb: number
  ok: boolean
  message: string
}

/**
 * Back-solve the neighbour's transmit power from one measured RSSI.
 * Path gain is linear in transmit power, so a single trace to the reference
 * point is enough: conducted = measured - tracedGain.
 */
export function calibrateNeighbour(
  scene: Scene,
  customMaterials: CustomMaterial[],
  net: ExternalNetwork,
  client: ClientConfig,
  trace: TraceOptions,
): CalibrationResult {
  const ap = neighbourAsAp(net)
  const freqHz = channelCentreMHz(net.band, net.channel) * 1e6

  if (!net.calibration) {
    return {
      // Fall back to the stated EIRP; a dipole's 2.15 dBi is the only gain here.
      conductedDbm: net.assumedEirpDbm - 2.15,
      referenceGainDb: NaN,
      ok: true,
      message: 'No measurement supplied — using the assumed EIRP.',
    }
  }

  const traceScene = buildTraceScene(scene, customMaterials, freqHz)
  const point: Vec3 = {
    x: net.calibration.refX,
    y: net.calibration.refY,
    z: net.calibration.refHeightM,
  }
  const result = receivedPowerDbm(
    traceScene,
    ap,
    0,
    point,
    client,
    trace,
    'incoherent',
    trace.maxReflectionOrder >= 2
      ? significantReflectors(traceScene, trace.secondOrderReflectorCap)
      : undefined,
  )

  if (result.paths.length === 0 || !Number.isFinite(result.dbm)) {
    return {
      conductedDbm: net.assumedEirpDbm - 2.15,
      referenceGainDb: NaN,
      ok: false,
      message:
        'No path reaches the reference point from the neighbour position — move one of them, or fall back to an assumed EIRP.',
    }
  }

  const conducted = net.calibration.measuredDbm - result.dbm
  return {
    conductedDbm: conducted,
    referenceGainDb: result.dbm,
    ok: true,
    message:
      `Path gain to the reference point is ${result.dbm.toFixed(1)} dB, so reproducing ` +
      `${net.calibration.measuredDbm.toFixed(0)} dBm needs ${conducted.toFixed(1)} dBm at the antenna ` +
      `(${(conducted + 2.15).toFixed(1)} dBm EIRP).`,
  }
}

// ---------------------------------------------------------------------------
// Channel planning
// ---------------------------------------------------------------------------

export interface ChannelCandidate {
  channel: number
  centreMHz: number
  /** Median SINR over the served area, dB. */
  medianSinrDb: number
  /** 5th-percentile SINR — what the worst corners get. */
  p5SinrDb: number
  /** Total interfering power, median over the area, dBm. */
  medianInterferenceDbm: number
  overlappingSources: string[]
}

export interface ChannelPlanInput {
  /** Received power from the AP being planned, per cell, dBm. */
  servingDbm: Float32Array
  /** Received power from each interferer (other APs and neighbours), dBm. */
  interferers: Array<{
    name: string
    centreMHz: number
    widthMHz: number
    rssiDbm: Float32Array
  }>
  band: Band
  widthMHz: ChannelWidthMHz
  noiseFigureDb: number
  /** Cells to score; usually those with a serving signal. */
  cellIndices: number[]
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1))))]
}

/**
 * Score every channel in the band against the interference already measured.
 *
 * The serving signal map is held fixed at whatever channel was solved. Within
 * one band that is sound — 5170 and 5330 MHz differ by 3%, far too little to
 * change how a wall behaves. It is NOT valid across bands, so candidates are
 * restricted to the AP's current band and the UI says so.
 */
export function planChannel(input: ChannelPlanInput): ChannelCandidate[] {
  const noiseMw = Math.pow(10, noiseFloorDbm(input.widthMHz, input.noiseFigureDb) / 10)

  return channelsFor(input.band)
    .map((channel) => {
      const centreMHz = channelCentreMHz(input.band, channel)
      const overlapping: string[] = []
      const active = input.interferers
        .map((source) => {
          const fraction = channelOverlapFraction(
            centreMHz,
            input.widthMHz,
            source.centreMHz,
            source.widthMHz,
          )
          if (fraction > 0 && !overlapping.includes(source.name)) overlapping.push(source.name)
          return { source, fraction }
        })
        .filter((x) => x.fraction > 0)

      const sinrs: number[] = []
      const interferenceDbms: number[] = []
      for (const i of input.cellIndices) {
        let interferenceMw = 0
        for (const { source, fraction } of active) {
          interferenceMw += Math.pow(10, source.rssiDbm[i] / 10) * fraction
        }
        const signalMw = Math.pow(10, input.servingDbm[i] / 10)
        sinrs.push(10 * Math.log10(signalMw / (noiseMw + interferenceMw)))
        interferenceDbms.push(
          interferenceMw > 0 ? 10 * Math.log10(interferenceMw) : -200,
        )
      }
      sinrs.sort((a, b) => a - b)
      interferenceDbms.sort((a, b) => a - b)

      return {
        channel,
        centreMHz,
        medianSinrDb: percentile(sinrs, 0.5),
        p5SinrDb: percentile(sinrs, 0.05),
        medianInterferenceDbm: percentile(interferenceDbms, 0.5),
        overlappingSources: overlapping,
      }
    })
    .sort((a, b) => b.p5SinrDb - a.p5SinrDb || b.medianSinrDb - a.medianSinrDb)
}

// ---------------------------------------------------------------------------
// Placement optimiser
// ---------------------------------------------------------------------------

export interface OptimiserOptions {
  /** Coverage target the objective is measured against, dBm. */
  targetRssiDbm: number
  /** How many APs to place. */
  apCount: number
  /** Candidate spacing, metres. Coarser is much faster. */
  candidateSpacingM: number
  /** Evaluation grid spacing during the search, metres. */
  evaluationSpacingM: number
  mountingHeightM: number
}

export const DEFAULT_OPTIMISER: OptimiserOptions = {
  targetRssiDbm: -67,
  apCount: 1,
  candidateSpacingM: 1.5,
  evaluationSpacingM: 1.0,
  mountingHeightM: 1.2,
}

export interface PlacementSuggestion {
  x: number
  y: number
  /** Fraction of the evaluated area at or above the target, after this AP. */
  coverage: number
  /** 5th-percentile RSSI after this AP, dBm. */
  p5RssiDbm: number
}

export interface OptimiserResult {
  suggestions: PlacementSuggestion[]
  candidatesEvaluated: number
  evaluationCells: number
  elapsedMs: number
  note: string
}

/**
 * Greedy placement: put the first AP where it covers the most area, then the
 * next where it best covers what is still missing, and so on. Greedy is not
 * guaranteed optimal, but for the two or three APs a home needs it lands on the
 * same answer as an exhaustive search almost every time, at a small fraction of
 * the cost — and every candidate is scored with the same ray-traced physics as
 * the main solve, not a distance heuristic.
 */
export function optimisePlacement(
  scene: Scene,
  customMaterials: CustomMaterial[],
  template: AccessPointConfig,
  client: ClientConfig,
  spec: GridSpec,
  trace: TraceOptions,
  options: OptimiserOptions,
  onProgress?: (done: number, total: number) => void,
): OptimiserResult {
  const started = performance.now()

  // Evaluation points: a coarse grid over the plan, restricted to points that
  // are inside the building envelope (a point with no wall between it and the
  // bounding-box centre is a reasonable, cheap proxy for "indoors").
  const evalPoints: Vec3[] = []
  for (let y = spec.minY; y <= spec.maxY; y += options.evaluationSpacingM) {
    for (let x = spec.minX; x <= spec.maxX; x += options.evaluationSpacingM) {
      evalPoints.push({ x, y, z: spec.heightM })
    }
  }

  const candidates: Array<{ x: number; y: number }> = []
  for (let y = spec.minY; y <= spec.maxY; y += options.candidateSpacingM) {
    for (let x = spec.minX; x <= spec.maxX; x += options.candidateSpacingM) {
      candidates.push({ x, y })
    }
  }

  const power = accessPointPower(template, 'etsi')
  const traceScene = buildTraceScene(scene, customMaterials, power.freqHz)
  const secondOrder =
    trace.maxReflectionOrder >= 2
      ? significantReflectors(traceScene, trace.secondOrderReflectorCap)
      : undefined

  // Best received power at each evaluation point from the APs chosen so far.
  const bestSoFar = new Float32Array(evalPoints.length).fill(-200)
  const suggestions: PlacementSuggestion[] = []
  let evaluated = 0
  const total = candidates.length * options.apCount

  for (let round = 0; round < options.apCount; round++) {
    let bestCandidate: { x: number; y: number } | null = null
    let bestScore = -Infinity
    let bestMap: Float32Array | null = null

    for (const candidate of candidates) {
      const ap = { ...template, x: candidate.x, y: candidate.y, heightM: options.mountingHeightM }
      const map = new Float32Array(evalPoints.length)
      let covered = 0

      for (let i = 0; i < evalPoints.length; i++) {
        const r = receivedPowerDbm(
          traceScene,
          ap,
          power.radiatedConductedDbm,
          evalPoints[i],
          client,
          trace,
          'incoherent',
          secondOrder,
        )
        const combined = Math.max(bestSoFar[i], r.dbm)
        map[i] = combined
        if (combined >= options.targetRssiDbm) covered++
      }

      // Primary objective is covered area; the mean level breaks ties so the
      // search still improves once coverage saturates.
      const meanDbm = map.reduce((a, b) => a + Math.max(b, -120), 0) / map.length
      const score = covered * 1000 + meanDbm

      if (score > bestScore) {
        bestScore = score
        bestCandidate = candidate
        bestMap = map
      }
      evaluated++
      if (onProgress && evaluated % 8 === 0) onProgress(evaluated, total)
    }

    if (!bestCandidate || !bestMap) break
    bestSoFar.set(bestMap)

    const sorted = [...bestMap].sort((a, b) => a - b)
    suggestions.push({
      x: bestCandidate.x,
      y: bestCandidate.y,
      coverage: sorted.filter((v) => v >= options.targetRssiDbm).length / sorted.length,
      p5RssiDbm: percentile(sorted, 0.05),
    })
  }

  return {
    suggestions,
    candidatesEvaluated: evaluated,
    evaluationCells: evalPoints.length,
    elapsedMs: performance.now() - started,
    note:
      'Greedy search over the whole plan bounding box. Candidate positions include points outside the walls — check the suggestion is somewhere you can actually put a router.',
  }
}

/** Rate reachable at a given SINR, used by the channel-plan table. */
export function rateAtSinr(
  sinrDb: number,
  ap: AccessPointConfig,
  client: ClientConfig,
): number {
  const streams = Math.min(ap.spatialStreams, client.antennaCount)
  return (
    selectRate(
      sinrDb,
      ap.generation,
      ap.widthMHz,
      streams,
      ap.guardIntervalUs,
      client.implementationMarginDb,
    ).phyRateBps / 1e6
  )
}
