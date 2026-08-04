/// <reference lib="webworker" />

/**
 * Runs the grid solve off the UI thread and streams progress back.
 */

import { solveGrid, type AccessPointConfig, type ClientConfig, type GridSpec, type SolveSettings } from './solver'
import { channelCentreMHz } from './linkBudget'
import type { Scene } from '../scene/model'
import type { CustomMaterial } from '../physics/materials'

export interface SolveRequest {
  type: 'solve'
  id: number
  scene: Scene
  customMaterials: CustomMaterial[]
  aps: AccessPointConfig[]
  client: ClientConfig
  spec: GridSpec
  settings: SolveSettings
}

export interface SolveProgressMessage {
  type: 'progress'
  id: number
  done: number
  total: number
}

export interface SolveDone {
  type: 'done'
  id: number
  cols: number
  rows: number
  spec: GridSpec
  rssiDbm: ArrayBuffer
  sinrDb: ArrayBuffer
  mcs: ArrayBuffer
  phyRateMbps: ArrayBuffer
  throughputMbps: ArrayBuffer
  bestAp: ArrayBuffer
  interferenceDbm: ArrayBuffer
  /**
   * Every interfering source's own coverage map, kept so channel planning can
   * re-score candidate channels without re-tracing the whole grid.
   */
  sources: Array<{
    name: string
    centreMHz: number
    widthMHz: number
    external: boolean
    rssiDbm: ArrayBuffer
  }>
  elapsedMs: number
}

export interface SolveFailed {
  type: 'failed'
  id: number
  message: string
}

self.onmessage = (event: MessageEvent<SolveRequest>) => {
  const msg = event.data
  if (msg.type !== 'solve') return

  try {
    const started = performance.now()
    let lastPost = 0
    const result = solveGrid(
      msg.scene,
      msg.customMaterials,
      msg.aps,
      msg.client,
      msg.spec,
      msg.settings,
      (done, total) => {
        // Throttle: posting every batch would swamp the main thread.
        const now = performance.now()
        if (now - lastPost < 120) return
        lastPost = now
        const progress: SolveProgressMessage = { type: 'progress', id: msg.id, done, total }
        self.postMessage(progress)
      },
    )

    const enabledAps = msg.aps.filter((a) => a.enabled)
    const enabledExternal = (msg.settings.externalSources ?? []).filter((e) => e.ap.enabled)

    const sources: SolveDone['sources'] = [
      ...enabledAps.map((ap, i) => ({
        name: ap.name,
        centreMHz: channelCentreMHz(ap.band, ap.channel),
        widthMHz: ap.widthMHz as number,
        external: false,
        rssiDbm: result.perApRssiDbm[i].buffer as ArrayBuffer,
      })),
      ...enabledExternal.map((e, i) => ({
        name: e.ap.name,
        centreMHz: channelCentreMHz(e.ap.band, e.ap.channel),
        widthMHz: e.ap.widthMHz as number,
        external: true,
        rssiDbm: result.perExternalRssiDbm[i].buffer as ArrayBuffer,
      })),
    ]

    const done: SolveDone = {
      type: 'done',
      id: msg.id,
      cols: result.cols,
      rows: result.rows,
      spec: result.spec,
      rssiDbm: result.rssiDbm.buffer as ArrayBuffer,
      sinrDb: result.sinrDb.buffer as ArrayBuffer,
      mcs: result.mcs.buffer as ArrayBuffer,
      phyRateMbps: result.phyRateMbps.buffer as ArrayBuffer,
      throughputMbps: result.throughputMbps.buffer as ArrayBuffer,
      bestAp: result.bestAp.buffer as ArrayBuffer,
      interferenceDbm: result.interferenceDbm.buffer as ArrayBuffer,
      sources,
      elapsedMs: performance.now() - started,
    }
    self.postMessage(done, [
      done.rssiDbm,
      done.sinrDb,
      done.mcs,
      done.phyRateMbps,
      done.throughputMbps,
      done.bestAp,
      done.interferenceDbm,
      ...sources.map((s) => s.rssiDbm),
    ])
  } catch (e) {
    const failed: SolveFailed = {
      type: 'failed',
      id: msg.id,
      message: e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e),
    }
    self.postMessage(failed)
  }
}

export {}
