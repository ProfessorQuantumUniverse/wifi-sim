/**
 * Project persistence.
 *
 * Autosave goes to IndexedDB rather than localStorage: a floorplan scan is
 * routinely 1-3 MB as a data URL, which blows localStorage's ~5 MB quota once
 * you add a second project. The same serialised shape is what the export/import
 * buttons write, so a `.wifisim` file and the autosave slot are interchangeable.
 */

import { useFloorplanStore, type Calibration } from './store'
import { useSceneStore } from './sceneStore'
import { useSimStore } from './simStore'
import type { FloorplanParams } from '../floorplan/pipeline'
import type { TracedWall } from '../floorplan/vectorize'
import type { Scene } from '../scene/model'
import type { CustomMaterial } from '../physics/materials'
import type { AccessPointConfig, ClientConfig } from '../engine/solver'
import type { ExternalNetwork, OptimiserOptions } from '../engine/planning'
import type { TraceOptions } from '../engine/tracer'
import type { MacParameters, RegulatoryDomain } from '../engine/linkBudget'
import type { PlanTransform } from './sceneStore'

export const PROJECT_FORMAT = 'wifi-sim-project'
export const PROJECT_VERSION = 1

export interface ProjectFile {
  format: typeof PROJECT_FORMAT
  version: number
  savedAt: string
  image: { name: string; width: number; height: number; dataUrl: string } | null
  floorplan: {
    params: FloorplanParams
    walls: TracedWall[]
    calibration: Calibration
  }
  model: {
    scene: Scene
    customMaterials: CustomMaterial[]
    transform: PlanTransform | null
  }
  simulation: {
    aps: AccessPointConfig[]
    client: ClientConfig
    externalNetworks: ExternalNetwork[]
    domain: RegulatoryDomain
    trace: TraceOptions
    mac: MacParameters
    combining: 'coherent' | 'incoherent'
    resolutionM: number
    evaluationHeightM: number
    optimiser: OptimiserOptions
  }
}

// ---------------------------------------------------------------------------
// IndexedDB
// ---------------------------------------------------------------------------

const DB_NAME = 'wifi-sim'
const STORE = 'projects'
const AUTOSAVE_KEY = 'autosave'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE)
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function idbPut(key: string, value: unknown): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openDb()
  const result = await new Promise<T | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const request = tx.objectStore(STORE).get(key)
    request.onsuccess = () => resolve((request.result as T) ?? null)
    request.onerror = () => reject(request.error)
  })
  db.close()
  return result
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
  db.close()
}

// ---------------------------------------------------------------------------
// Serialise / restore
// ---------------------------------------------------------------------------

/** Re-encode the loaded bitmap as PNG so it survives a round trip. */
async function bitmapToDataUrl(bitmap: ImageBitmap): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
  return canvas.toDataURL('image/png')
}

export async function serialiseProject(): Promise<ProjectFile> {
  const fp = useFloorplanStore.getState()
  const sc = useSceneStore.getState()
  const sim = useSimStore.getState()

  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    savedAt: new Date().toISOString(),
    image: fp.image
      ? {
          name: fp.image.name,
          width: fp.image.width,
          height: fp.image.height,
          dataUrl: await bitmapToDataUrl(fp.image.bitmap),
        }
      : null,
    floorplan: { params: fp.params, walls: fp.walls, calibration: fp.calibration },
    model: { scene: sc.scene, customMaterials: sc.customMaterials, transform: sc.transform },
    simulation: {
      aps: sim.aps,
      client: sim.client,
      externalNetworks: sim.externalNetworks,
      domain: sim.domain,
      trace: sim.trace,
      mac: sim.mac,
      combining: sim.combining,
      resolutionM: sim.resolutionM,
      evaluationHeightM: sim.evaluationHeightM,
      optimiser: sim.optimiser,
    },
  }
}

export interface RestoreResult {
  ok: boolean
  message: string
  /** Pixel data of the restored scan, for re-seeding the tracing worker. */
  imageData: { rgba: Uint8ClampedArray; width: number; height: number } | null
}

/**
 * Load a project into the stores. The heatmap is deliberately not persisted —
 * it is a derived product that can be several megabytes and would go stale the
 * moment any setting changed; the "Compute coverage" button regenerates it.
 */
export async function restoreProject(file: ProjectFile): Promise<RestoreResult> {
  if (file.format !== PROJECT_FORMAT) {
    return { ok: false, message: 'That file is not a WiFi-Sim project.', imageData: null }
  }
  if (file.version > PROJECT_VERSION) {
    return {
      ok: false,
      message: `This project was written by a newer version (v${file.version}); this build understands up to v${PROJECT_VERSION}.`,
      imageData: null,
    }
  }

  let imageData: RestoreResult['imageData'] = null

  if (file.image) {
    const img = new Image()
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('The stored floorplan image could not be decoded.'))
      img.src = file.image!.dataUrl
    })
    const bitmap = await createImageBitmap(img)
    const canvas = document.createElement('canvas')
    canvas.width = file.image.width
    canvas.height = file.image.height
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    ctx.drawImage(bitmap, 0, 0)
    imageData = {
      rgba: ctx.getImageData(0, 0, file.image.width, file.image.height).data,
      width: file.image.width,
      height: file.image.height,
    }
    // setImage resets params, so it must run before the stored ones are applied.
    useFloorplanStore.getState().setImage({
      bitmap,
      width: file.image.width,
      height: file.image.height,
      name: file.image.name,
    })
  }

  useFloorplanStore.setState({
    params: file.floorplan.params,
    walls: file.floorplan.walls,
    calibration: file.floorplan.calibration,
    wallsStale: false,
  })

  useSceneStore.setState({
    scene: file.model.scene,
    customMaterials: file.model.customMaterials,
    transform: file.model.transform,
    past: [],
    future: [],
    selection: { kind: 'none' },
  })

  useSimStore.setState({
    ...file.simulation,
    heatmap: null,
    probe: null,
    channelPlan: null,
    optimiserResult: null,
    selectedApId: file.simulation.aps[0]?.id ?? null,
    selectedExternalId: null,
  })

  return {
    ok: true,
    message: `Restored the project saved ${new Date(file.savedAt).toLocaleString()}.`,
    imageData,
  }
}

// ---------------------------------------------------------------------------
// Autosave
// ---------------------------------------------------------------------------

let saveTimer: number | null = null
let saving = false

/** Debounced autosave. Safe to call on every store change. */
export function scheduleAutosave(delayMs = 1500): void {
  if (saveTimer !== null) window.clearTimeout(saveTimer)
  saveTimer = window.setTimeout(() => {
    saveTimer = null
    void (async () => {
      if (saving) return
      saving = true
      try {
        await idbPut(AUTOSAVE_KEY, await serialiseProject())
      } catch {
        // A failed autosave must never interrupt the session; the explicit
        // export button remains available.
      } finally {
        saving = false
      }
    })()
  }, delayMs)
}

export function loadAutosave(): Promise<ProjectFile | null> {
  return idbGet<ProjectFile>(AUTOSAVE_KEY)
}

export function clearAutosave(): Promise<void> {
  return idbDelete(AUTOSAVE_KEY)
}

// ---------------------------------------------------------------------------
// File export / import
// ---------------------------------------------------------------------------

export async function exportProjectFile(): Promise<Blob> {
  return new Blob([JSON.stringify(await serialiseProject(), null, 1)], {
    type: 'application/json',
  })
}

export async function readProjectFile(file: File): Promise<ProjectFile> {
  return JSON.parse(await file.text()) as ProjectFile
}
