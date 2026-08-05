import { useEffect, useRef, useState } from 'react'
import { useFloorplanStore } from './store'
import { useSceneStore } from './sceneStore'
import { useSimStore } from './simStore'
import { loadAutosave, restoreProject, scheduleAutosave, type ProjectFile } from './persistence'

export type AutosaveState = 'idle' | 'restoring' | 'ready' | 'saving'

/**
 * Restores the last session on mount, then keeps saving as things change.
 *
 * Only the inputs are watched. The heatmap is excluded on purpose: it changes
 * wholesale on every solve, is large, and is fully derivable from what is
 * saved. Persisting it would make every autosave a multi-megabyte write.
 */
export function useAutosave(onImageRestored: (rgba: Uint8ClampedArray, w: number, h: number) => void) {
  const [state, setState] = useState<AutosaveState>('restoring')
  const [lastSaved, setLastSaved] = useState<Date | null>(null)
  const restored = useRef(false)
  const imageCallback = useRef(onImageRestored)
  imageCallback.current = onImageRestored

  useEffect(() => {
    if (restored.current) return
    restored.current = true
    void (async () => {
      try {
        const saved = await loadAutosave()
        if (saved) {
          const result = await restoreProject(saved)
          if (result.ok && result.imageData) {
            imageCallback.current(
              result.imageData.rgba,
              result.imageData.width,
              result.imageData.height,
            )
          }
        }
      } catch {
        // A corrupt autosave should not block startup. Start clean instead.
      } finally {
        setState('ready')
      }
    })()
  }, [])

  useEffect(() => {
    if (state !== 'ready') return

    const trigger = () => {
      setState('saving')
      scheduleAutosave()
      window.setTimeout(() => {
        setState('ready')
        setLastSaved(new Date())
      }, 1800)
    }

    // Only the persisted slices count. Zustand swaps object references on
    // change, so a reference comparison is enough to ignore the transient
    // fields (heatmap, progress, solving flags) that fire during a solve.
    const unsubs = [
      useFloorplanStore.subscribe((s, prev) => {
        if (
          s.params === prev.params &&
          s.walls === prev.walls &&
          s.calibration === prev.calibration &&
          s.image === prev.image
        )
          return
        trigger()
      }),
      useSceneStore.subscribe((s, prev) => {
        if (
          s.scene === prev.scene &&
          s.customMaterials === prev.customMaterials &&
          s.transform === prev.transform
        )
          return
        trigger()
      }),
      useSimStore.subscribe((s, prev) => {
        if (
          s.aps === prev.aps &&
          s.client === prev.client &&
          s.externalNetworks === prev.externalNetworks &&
          s.trace === prev.trace &&
          s.mac === prev.mac &&
          s.optimiser === prev.optimiser &&
          s.domain === prev.domain &&
          s.combining === prev.combining &&
          s.resolutionM === prev.resolutionM &&
          s.evaluationHeightM === prev.evaluationHeightM
        )
          return
        trigger()
      }),
    ]
    return () => unsubs.forEach((u) => u())
  }, [state])

  return { state, lastSaved }
}

export type { ProjectFile }
