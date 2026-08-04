import { create } from 'zustand'
import type { Vec3 } from '../scene/model'
import type { AccessPointConfig, ClientConfig, GridSpec } from '../engine/solver'
import { DEFAULT_CLIENT, DEFAULT_SOLVE_SETTINGS } from '../engine/solver'
import { DEFAULT_TRACE_OPTIONS, type PropagationPath, type TraceOptions } from '../engine/tracer'
import type { MacParameters, RegulatoryDomain } from '../engine/linkBudget'
import { DEFAULT_MAC } from '../engine/linkBudget'
import {
  DEFAULT_OPTIMISER,
  type ChannelCandidate,
  type ExternalNetwork,
  type OptimiserOptions,
  type OptimiserResult,
} from '../engine/planning'

export type HeatmapLayer = 'rssi' | 'sinr' | 'mcs' | 'phyRate' | 'throughput' | 'bestAp'

export interface HeatmapData {
  cols: number
  rows: number
  spec: GridSpec
  rssiDbm: Float32Array
  sinrDb: Float32Array
  mcs: Int8Array
  phyRateMbps: Float32Array
  throughputMbps: Float32Array
  bestAp: Int16Array
  interferenceDbm: Float32Array
  /** Each interfering source's own map, kept for channel re-scoring. */
  sources: Array<{
    name: string
    centreMHz: number
    widthMHz: number
    external: boolean
    rssiDbm: Float32Array
  }>
  elapsedMs: number
}

export interface ProbeResult {
  point: Vec3
  apIndex: number
  rssiDbm: number
  sinrDb: number
  noiseDbm: number
  mcs: number
  phyRateMbps: number
  throughputMbps: number
  efficiency: number
  paths: PropagationPath[]
}

interface SimState {
  aps: AccessPointConfig[]
  client: ClientConfig
  domain: RegulatoryDomain
  trace: TraceOptions
  mac: MacParameters
  combining: 'coherent' | 'incoherent'
  resolutionM: number
  evaluationHeightM: number

  heatmap: HeatmapData | null
  layer: HeatmapLayer
  heatmapOpacity: number
  solving: boolean
  progress: { done: number; total: number } | null
  error: string | null

  probe: ProbeResult | null
  probeMode: boolean
  /** AP being dragged/placed, or null. */
  placingAp: boolean
  selectedApId: string | null

  externalNetworks: ExternalNetwork[]
  selectedExternalId: string | null
  /** Click-to-place mode: 'source' sets the router position, 'ref' the reading spot. */
  placingExternal: { id: string; what: 'source' | 'ref' } | null

  channelPlan: ChannelCandidate[] | null
  optimiser: OptimiserOptions
  optimiserResult: OptimiserResult | null
  optimising: boolean

  addExternal: (x: number, y: number) => void
  updateExternal: (id: string, patch: Partial<ExternalNetwork>) => void
  deleteExternal: (id: string) => void
  selectExternal: (id: string | null) => void
  setPlacingExternal: (v: { id: string; what: 'source' | 'ref' } | null) => void
  setChannelPlan: (p: ChannelCandidate[] | null) => void
  patchOptimiser: (patch: Partial<OptimiserOptions>) => void
  setOptimiserResult: (r: OptimiserResult | null) => void
  setOptimising: (v: boolean) => void

  addAp: (x: number, y: number) => void
  updateAp: (id: string, patch: Partial<AccessPointConfig>) => void
  deleteAp: (id: string) => void
  selectAp: (id: string | null) => void
  setPlacingAp: (v: boolean) => void

  patchClient: (patch: Partial<ClientConfig>) => void
  patchTrace: (patch: Partial<TraceOptions>) => void
  patchMac: (patch: Partial<MacParameters>) => void
  setDomain: (d: RegulatoryDomain) => void
  setCombining: (c: 'coherent' | 'incoherent') => void
  setResolution: (m: number) => void
  setEvaluationHeight: (m: number) => void

  setLayer: (l: HeatmapLayer) => void
  setHeatmapOpacity: (v: number) => void
  setHeatmap: (h: HeatmapData | null) => void
  setSolving: (v: boolean) => void
  setProgress: (p: { done: number; total: number } | null) => void
  setError: (e: string | null) => void
  setProbe: (p: ProbeResult | null) => void
  setProbeMode: (v: boolean) => void
}

let apCounter = 0

export function makeDefaultAp(x: number, y: number): AccessPointConfig {
  apCounter++
  return {
    id: `ap${apCounter}-${Date.now().toString(36)}`,
    name: apCounter === 1 ? 'Router' : `AP ${apCounter}`,
    x,
    y,
    heightM: 1.2,
    enabled: true,
    band: '5',
    channel: 36,
    widthMHz: 80,
    generation: 'he',
    guardIntervalUs: 0.8,
    spatialStreams: 2,
    conductedPowerDbm: 15,
    cableLossDb: 0,
    antenna: {
      kind: 'dipole',
      boresight: { x: 0, y: 0, z: 1 },
      reference: { x: 1, y: 0, z: 0 },
    },
    mounting: 'shelf-top',
    enclosureLossDb: 0,
  }
}

export const useSimStore = create<SimState>((set) => ({
  aps: [],
  client: DEFAULT_CLIENT,
  domain: DEFAULT_SOLVE_SETTINGS.domain,
  trace: DEFAULT_TRACE_OPTIONS,
  mac: DEFAULT_MAC,
  combining: DEFAULT_SOLVE_SETTINGS.combining,
  resolutionM: 0.35,
  evaluationHeightM: 1.1,

  heatmap: null,
  layer: 'rssi',
  heatmapOpacity: 0.78,
  solving: false,
  progress: null,
  error: null,
  probe: null,
  probeMode: false,
  placingAp: false,
  selectedApId: null,

  externalNetworks: [],
  selectedExternalId: null,
  placingExternal: null,
  channelPlan: null,
  optimiser: DEFAULT_OPTIMISER,
  optimiserResult: null,
  optimising: false,

  addExternal: (x, y) =>
    set((s) => {
      const id = `ext${s.externalNetworks.length + 1}-${Date.now().toString(36)}`
      const net: ExternalNetwork = {
        id,
        ssid: `Neighbour ${s.externalNetworks.length + 1}`,
        enabled: true,
        band: '5',
        channel: 36,
        widthMHz: 80,
        x,
        y,
        heightM: 1.2,
        calibration: null,
        assumedEirpDbm: 20,
      }
      return {
        externalNetworks: [...s.externalNetworks, net],
        selectedExternalId: id,
        placingExternal: null,
      }
    }),
  updateExternal: (id, patch) =>
    set((s) => ({
      externalNetworks: s.externalNetworks.map((n) => (n.id === id ? { ...n, ...patch } : n)),
    })),
  deleteExternal: (id) =>
    set((s) => ({
      externalNetworks: s.externalNetworks.filter((n) => n.id !== id),
      selectedExternalId: s.selectedExternalId === id ? null : s.selectedExternalId,
    })),
  selectExternal: (selectedExternalId) => set({ selectedExternalId }),
  setPlacingExternal: (placingExternal) =>
    set({ placingExternal, placingAp: false, probeMode: false }),
  setChannelPlan: (channelPlan) => set({ channelPlan }),
  patchOptimiser: (patch) => set((s) => ({ optimiser: { ...s.optimiser, ...patch } })),
  setOptimiserResult: (optimiserResult) => set({ optimiserResult }),
  setOptimising: (optimising) => set({ optimising }),

  addAp: (x, y) =>
    set((s) => {
      const ap = makeDefaultAp(x, y)
      return { aps: [...s.aps, ap], selectedApId: ap.id, placingAp: false }
    }),
  updateAp: (id, patch) =>
    set((s) => ({ aps: s.aps.map((a) => (a.id === id ? { ...a, ...patch } : a)) })),
  deleteAp: (id) =>
    set((s) => ({
      aps: s.aps.filter((a) => a.id !== id),
      selectedApId: s.selectedApId === id ? null : s.selectedApId,
    })),
  selectAp: (selectedApId) => set({ selectedApId }),
  setPlacingAp: (placingAp) => set({ placingAp, probeMode: false, placingExternal: null }),

  patchClient: (patch) => set((s) => ({ client: { ...s.client, ...patch } })),
  patchTrace: (patch) => set((s) => ({ trace: { ...s.trace, ...patch } })),
  patchMac: (patch) => set((s) => ({ mac: { ...s.mac, ...patch } })),
  setDomain: (domain) => set({ domain }),
  setCombining: (combining) => set({ combining }),
  setResolution: (resolutionM) => set({ resolutionM }),
  setEvaluationHeight: (evaluationHeightM) =>
    set((s) => ({ evaluationHeightM, client: { ...s.client, heightM: evaluationHeightM } })),

  setLayer: (layer) => set({ layer }),
  setHeatmapOpacity: (heatmapOpacity) => set({ heatmapOpacity }),
  setHeatmap: (heatmap) => set({ heatmap }),
  setSolving: (solving) => set({ solving }),
  setProgress: (progress) => set({ progress }),
  setError: (error) => set({ error }),
  setProbe: (probe) => set({ probe }),
  setProbeMode: (probeMode) => set({ probeMode, placingAp: false, placingExternal: null }),
}))
