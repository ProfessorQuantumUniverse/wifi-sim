import { useCallback, useEffect, useRef } from 'react'
import { useFloorplanStore } from '../state/store'
import type { FloorplanParams } from './pipeline'
import type { ProcessResult, WorkerError } from './floorplan.worker'

/**
 * Owns the pipeline worker. The mask stage is cheap enough to re-run on every
 * slider move (debounced); the vector stage is only triggered explicitly,
 * because thinning a multi-megapixel mask takes noticeably longer.
 */
export function useFloorplanWorker() {
  const workerRef = useRef<Worker | null>(null)
  const nextId = useRef(1)
  const pendingId = useRef(0)
  const debounceTimer = useRef<number | null>(null)

  const setResult = useFloorplanStore((s) => s.setResult)
  const setBusy = useFloorplanStore((s) => s.setBusy)
  const setError = useFloorplanStore((s) => s.setError)

  useEffect(() => {
    const worker = new Worker(new URL('./floorplan.worker.ts', import.meta.url), {
      type: 'module',
    })
    workerRef.current = worker

    worker.onmessage = async (event: MessageEvent<ProcessResult | WorkerError>) => {
      const msg = event.data
      if (msg.id !== pendingId.current) return // a newer request superseded this one

      if (msg.type === 'error') {
        setBusy(false)
        setError(msg.message)
        return
      }

      const maskData = new ImageData(
        new Uint8ClampedArray(msg.maskRgba),
        msg.width,
        msg.height,
      )
      const maskBitmap = await createImageBitmap(maskData)

      let skeletonBitmap: ImageBitmap | null = null
      if (msg.skeletonRgba) {
        const skelData = new ImageData(
          new Uint8ClampedArray(msg.skeletonRgba),
          msg.width,
          msg.height,
        )
        skeletonBitmap = await createImageBitmap(skelData)
      }

      setResult({
        maskBitmap,
        skeletonBitmap,
        walls: msg.walls,
        stats: msg.stats,
      })
      setBusy(false)
    }

    return () => {
      worker.terminate()
      workerRef.current = null
    }
  }, [setBusy, setError, setResult])

  const loadImage = useCallback((rgba: Uint8ClampedArray, width: number, height: number) => {
    const worker = workerRef.current
    if (!worker) return
    // Copy: the caller's buffer belongs to a canvas we still need.
    const copy = rgba.slice()
    worker.postMessage(
      { type: 'setImage', width, height, data: copy.buffer },
      [copy.buffer],
    )
  }, [])

  const run = useCallback(
    (params: FloorplanParams, withVectors: boolean) => {
      const worker = workerRef.current
      if (!worker) return
      const id = nextId.current++
      pendingId.current = id
      setBusy(true)
      worker.postMessage({ type: 'process', id, params, withVectors })
    },
    [setBusy],
  )

  const runDebounced = useCallback(
    (params: FloorplanParams, withVectors: boolean, delayMs = 150) => {
      if (debounceTimer.current !== null) window.clearTimeout(debounceTimer.current)
      debounceTimer.current = window.setTimeout(() => {
        debounceTimer.current = null
        run(params, withVectors)
      }, delayMs)
    },
    [run],
  )

  return { loadImage, run, runDebounced }
}
