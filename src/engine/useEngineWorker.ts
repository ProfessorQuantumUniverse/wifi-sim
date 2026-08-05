import { useCallback, useEffect, useRef } from 'react'
import { useSimStore } from '../state/simStore'
import { useSceneStore } from '../state/sceneStore'
import { defaultGridFor, accessPointPower, buildTraceScene, receivedPowerDbm } from './solver'
import { significantReflectors } from './tracer'
import { channelCentreMHz, noiseFloorDbm, selectRate, throughput } from './linkBudget'
import { calibrateNeighbour, neighbourAsAp, optimisePlacement, planChannel } from './planning'
import type { SolveDone, SolveFailed, SolveProgressMessage, SolveRequest } from './engine.worker'

export function useEngineWorker() {
  const workerRef = useRef<Worker | null>(null)
  const nextId = useRef(1)
  const activeId = useRef(0)

  useEffect(() => {
    const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' })
    workerRef.current = worker

    worker.onmessage = (
      event: MessageEvent<SolveDone | SolveFailed | SolveProgressMessage>,
    ) => {
      const msg = event.data
      if (msg.id !== activeId.current) return
      const store = useSimStore.getState()

      if (msg.type === 'progress') {
        store.setProgress({ done: msg.done, total: msg.total })
        return
      }
      if (msg.type === 'failed') {
        store.setSolving(false)
        store.setProgress(null)
        store.setError(msg.message)
        return
      }

      store.setHeatmap({
        cols: msg.cols,
        rows: msg.rows,
        spec: msg.spec,
        rssiDbm: new Float32Array(msg.rssiDbm),
        sinrDb: new Float32Array(msg.sinrDb),
        mcs: new Int8Array(msg.mcs),
        phyRateMbps: new Float32Array(msg.phyRateMbps),
        throughputMbps: new Float32Array(msg.throughputMbps),
        bestAp: new Int16Array(msg.bestAp),
        interferenceDbm: new Float32Array(msg.interferenceDbm),
        sources: msg.sources.map((s) => ({ ...s, rssiDbm: new Float32Array(s.rssiDbm) })),
        elapsedMs: msg.elapsedMs,
      })
      store.setSolving(false)
      store.setProgress(null)
      store.setError(null)
    }

    return () => {
      worker.terminate()
      workerRef.current = null
    }
  }, [])

  const solve = useCallback(() => {
    const worker = workerRef.current
    if (!worker) return
    const sim = useSimStore.getState()
    const { scene, customMaterials } = useSceneStore.getState()

    const base = defaultGridFor(scene, sim.resolutionM, sim.evaluationHeightM)
    if (!base) {
      sim.setError('The model has no walls yet, so there is nothing to solve.')
      return
    }

    const id = nextId.current++
    activeId.current = id
    sim.setSolving(true)
    sim.setProgress({ done: 0, total: 0 })
    sim.setError(null)

    const request: SolveRequest = {
      type: 'solve',
      id,
      scene,
      customMaterials,
      aps: sim.aps,
      client: { ...sim.client, heightM: sim.evaluationHeightM },
      spec: base,
      settings: {
        domain: sim.domain,
        trace: sim.trace,
        mac: sim.mac,
        combining: sim.combining,
        // Calibrate each neighbour here, once, rather than inside the cell loop.
        externalSources: sim.externalNetworks
          .filter((n) => n.enabled)
          .map((net) => ({
            ap: neighbourAsAp(net),
            conductedDbm: calibrateNeighbour(scene, customMaterials, net, sim.client, sim.trace)
              .conductedDbm,
          })),
      },
    }
    worker.postMessage(request)
  }, [])

  /**
   * Single-point probe, run inline: one point costs a scene build plus one path
   * solve, which is fast enough that a round trip through the worker would add
   * more latency than it saves.
   */
  const probe = useCallback((x: number, y: number) => {
    const sim = useSimStore.getState()
    const { scene, customMaterials } = useSceneStore.getState()
    const active = sim.aps.filter((a) => a.enabled)
    if (active.length === 0) return

    const point = { x, y, z: sim.evaluationHeightM }
    const client = { ...sim.client, heightM: sim.evaluationHeightM }

    let best = -1
    let bestDbm = -Infinity
    let bestPaths: ReturnType<typeof receivedPowerDbm>['paths'] = []
    const perApMw: number[] = []
    const contexts = active.map((ap) => {
      const power = accessPointPower(ap, sim.domain)
      return { ap, power, traceScene: buildTraceScene(scene, customMaterials, power.freqHz) }
    })

    contexts.forEach((ctx, i) => {
      const r = receivedPowerDbm(
        ctx.traceScene,
        ctx.ap,
        ctx.power.radiatedConductedDbm,
        point,
        client,
        sim.trace,
        sim.combining,
        sim.trace.maxReflectionOrder >= 2
          ? significantReflectors(ctx.traceScene, sim.trace.secondOrderReflectorCap)
          : undefined,
      )
      perApMw[i] = Math.pow(10, r.dbm / 10)
      if (r.dbm > bestDbm) {
        bestDbm = r.dbm
        best = i
        bestPaths = r.paths
      }
    })

    if (best < 0 || bestPaths.length === 0) {
      sim.setProbe(null)
      return
    }

    const ctx = contexts[best]
    const noise = noiseFloorDbm(ctx.ap.widthMHz, client.noiseFigureDb)
    let interferenceMw = 0
    contexts.forEach((other, i) => {
      if (i === best) return
      const separation = Math.abs(other.power.centreMHz - ctx.power.centreMHz)
      const overlap = (other.ap.widthMHz + ctx.ap.widthMHz) / 2
      if (separation >= overlap) return
      interferenceMw += perApMw[i] * (1 - separation / overlap)
    })

    const sinr =
      10 *
      Math.log10(
        Math.pow(10, bestDbm / 10) / (Math.pow(10, noise / 10) + interferenceMw),
      )
    const streams = Math.min(ctx.ap.spatialStreams, client.antennaCount)
    const rate = selectRate(
      sinr,
      ctx.ap.generation,
      ctx.ap.widthMHz,
      streams,
      ctx.ap.guardIntervalUs,
      client.implementationMarginDb,
    )
    const tp = throughput(rate.phyRateBps, sim.mac)

    // Map back to the index in the full AP list, which is what the canvas draws.
    const apIndex = sim.aps.findIndex((a) => a.id === ctx.ap.id)

    sim.setProbe({
      point,
      apIndex,
      rssiDbm: bestDbm,
      sinrDb: sinr,
      noiseDbm: noise,
      mcs: rate.mcs,
      phyRateMbps: rate.phyRateBps / 1e6,
      throughputMbps: tp.throughputBps / 1e6,
      efficiency: tp.efficiency,
      paths: bestPaths,
    })
  }, [])

  /**
   * Re-score every channel in the serving AP's band against the interference
   * already computed. Cheap: no re-tracing, only the spectral overlap changes.
   */
  const runChannelPlan = useCallback(() => {
    const sim = useSimStore.getState()
    const heatmap = sim.heatmap
    const serving = sim.aps.find((a) => a.id === sim.selectedApId) ?? sim.aps.find((a) => a.enabled)
    if (!heatmap || !serving) {
      sim.setError('Compute coverage first. The channel plan scores the map that produced it.')
      return
    }

    const cellIndices: number[] = []
    for (let i = 0; i < heatmap.bestAp.length; i++) {
      if (heatmap.bestAp[i] >= 0) cellIndices.push(i)
    }
    const servingCentre = channelCentreMHz(serving.band, serving.channel)

    sim.setChannelPlan(
      planChannel({
        servingDbm: heatmap.rssiDbm,
        // Everything except the AP being planned counts as interference.
        interferers: heatmap.sources.filter(
          (s) => s.external || s.name !== serving.name || s.centreMHz !== servingCentre,
        ),
        band: serving.band,
        widthMHz: serving.widthMHz,
        noiseFigureDb: sim.client.noiseFigureDb,
        cellIndices,
      }),
    )
  }, [])

  const runOptimiser = useCallback(() => {
    const sim = useSimStore.getState()
    const { scene, customMaterials } = useSceneStore.getState()
    const template = sim.aps.find((a) => a.id === sim.selectedApId) ?? sim.aps[0]
    if (!template) {
      sim.setError('Add one AP first. The optimiser uses its radio settings as the template.')
      return
    }
    const spec = defaultGridFor(scene, sim.optimiser.evaluationSpacingM, sim.evaluationHeightM)
    if (!spec) {
      sim.setError('The model has no walls yet.')
      return
    }

    sim.setOptimising(true)
    sim.setError(null)
    // Yield once so the button's busy state paints before the search blocks.
    setTimeout(() => {
      try {
        const result = optimisePlacement(
          scene,
          customMaterials,
          template,
          { ...sim.client, heightM: sim.evaluationHeightM },
          spec,
          sim.trace,
          sim.optimiser,
          (doneCount, total) => useSimStore.getState().setProgress({ done: doneCount, total }),
        )
        useSimStore.getState().setOptimiserResult(result)
      } catch (e) {
        useSimStore.getState().setError(e instanceof Error ? e.message : String(e))
      } finally {
        useSimStore.getState().setOptimising(false)
        useSimStore.getState().setProgress(null)
      }
    }, 30)
  }, [])

  return { solve, probe, runChannelPlan, runOptimiser }
}
