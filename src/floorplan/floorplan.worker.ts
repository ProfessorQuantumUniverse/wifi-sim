/// <reference lib="webworker" />

/**
 * Runs the floorplan pipeline off the UI thread. The source image is uploaded
 * once and cached here, so dragging a slider only sends the parameter object.
 * Results come back as transferable RGBA overlays plus the wall list.
 */

import { runMaskStage, runVectorStage, type FloorplanParams } from './pipeline'
import type { TracedWall } from './vectorize'

export interface SetImageMessage {
  type: 'setImage'
  width: number
  height: number
  data: ArrayBuffer
}

export interface ProcessMessage {
  type: 'process'
  id: number
  params: FloorplanParams
  withVectors: boolean
}

export type WorkerRequest = SetImageMessage | ProcessMessage

export interface ProcessResult {
  type: 'result'
  id: number
  width: number
  height: number
  /** RGBA overlay of the wall mask (opaque where mask = 1). */
  maskRgba: ArrayBuffer
  /** RGBA overlay of the skeleton, only when vectors were requested. */
  skeletonRgba: ArrayBuffer | null
  walls: TracedWall[] | null
  stats: {
    effectiveThreshold: number
    foregroundPixels: number
    coveragePercent: number
    wallCount: number
    maskMs: number
    vectorMs: number
  }
}

export interface WorkerError {
  type: 'error'
  id: number
  message: string
}

const MASK_COLOUR = [244, 63, 94] as const // rose-500
const SKELETON_COLOUR = [56, 189, 248] as const // sky-400

let source: { data: Uint8ClampedArray; width: number; height: number } | null = null

function toOverlay(
  mask: Uint8Array,
  colour: readonly [number, number, number],
  alpha: number,
): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(mask.length * 4)
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    if (mask[i] !== 1) continue
    out[p] = colour[0]
    out[p + 1] = colour[1]
    out[p + 2] = colour[2]
    out[p + 3] = alpha
  }
  return out
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const msg = event.data

  if (msg.type === 'setImage') {
    source = {
      data: new Uint8ClampedArray(msg.data),
      width: msg.width,
      height: msg.height,
    }
    return
  }

  if (msg.type !== 'process') return

  if (!source) {
    const err: WorkerError = { type: 'error', id: msg.id, message: 'No image loaded' }
    self.postMessage(err)
    return
  }

  try {
    const t0 = performance.now()
    const maskResult = runMaskStage(source.data, source.width, source.height, msg.params)
    const t1 = performance.now()

    let skeletonRgba: Uint8ClampedArray<ArrayBuffer> | null = null
    let walls: TracedWall[] | null = null

    if (msg.withVectors) {
      const v = runVectorStage(maskResult, msg.params.vectorize)
      skeletonRgba = toOverlay(v.skeleton, SKELETON_COLOUR, 255)
      walls = v.walls
    }
    const t2 = performance.now()

    const maskRgba = toOverlay(maskResult.mask, MASK_COLOUR, 150)
    const transfer: Transferable[] = [maskRgba.buffer]
    if (skeletonRgba) transfer.push(skeletonRgba.buffer)

    const result: ProcessResult = {
      type: 'result',
      id: msg.id,
      width: maskResult.width,
      height: maskResult.height,
      maskRgba: maskRgba.buffer,
      skeletonRgba: skeletonRgba ? skeletonRgba.buffer : null,
      walls,
      stats: {
        effectiveThreshold: maskResult.effectiveThreshold,
        foregroundPixels: maskResult.foregroundPixels,
        coveragePercent:
          (100 * maskResult.foregroundPixels) / (maskResult.width * maskResult.height),
        wallCount: walls ? walls.length : 0,
        maskMs: t1 - t0,
        vectorMs: t2 - t1,
      },
    }

    self.postMessage(result, transfer)
  } catch (e) {
    const err: WorkerError = {
      type: 'error',
      id: msg.id,
      message: e instanceof Error ? e.message : String(e),
    }
    self.postMessage(err)
  }
}

export {}
