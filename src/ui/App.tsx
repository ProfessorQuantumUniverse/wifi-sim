import { useCallback, useEffect, useRef, useState } from 'react'
import { metresPerPixel, useFloorplanStore } from '../state/store'
import { useSceneStore } from '../state/sceneStore'
import { useFloorplanWorker } from '../floorplan/useFloorplanWorker'
import { PlanCanvas } from './PlanCanvas'
import { ControlPanel } from './ControlPanel'
import { SceneCanvas } from './SceneCanvas'
import { ScenePanel } from './ScenePanel'
import { SimulatePanel } from './SimulatePanel'
import { ProbeReadout } from './ProbeReadout'
import { useEngineWorker } from '../engine/useEngineWorker'
import { useSimStore } from '../state/simStore'
import { useAutosave } from '../state/useAutosave'
import {
  clearAutosave,
  exportProjectFile,
  readProjectFile,
  restoreProject,
} from '../state/persistence'
import { downloadFile } from './report'

/** Above this the pipeline gets sluggish for no accuracy gain on a scan. */
const MAX_DIMENSION = 3000

type Workspace = 'floorplan' | 'model' | 'simulate'

export function App() {
  const { loadImage, run, runDebounced } = useFloorplanWorker()
  const image = useFloorplanStore((s) => s.image)
  const setImage = useFloorplanStore((s) => s.setImage)
  const params = useFloorplanStore((s) => s.params)
  const layers = useFloorplanStore((s) => s.layers)
  const toggleLayer = useFloorplanStore((s) => s.toggleLayer)
  const busy = useFloorplanStore((s) => s.busy)
  const error = useFloorplanStore((s) => s.error)
  const wallsStale = useFloorplanStore((s) => s.wallsStale)
  const setError = useFloorplanStore((s) => s.setError)
  const walls = useFloorplanStore((s) => s.walls)
  const calibration = useFloorplanStore((s) => s.calibration)

  const importTracedWalls = useSceneStore((s) => s.importTracedWalls)
  const sceneWallCount = useSceneStore((s) => s.scene.walls.length)
  const { solve, probe, runChannelPlan, runOptimiser } = useEngineWorker()
  const apCount = useSimStore((s) => s.aps.length)

  const [workspace, setWorkspace] = useState<Workspace>('floorplan')
  const fileInput = useRef<HTMLInputElement>(null)
  const projectInput = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const autosave = useAutosave(loadImage)

  const mpp = metresPerPixel(calibration)
  const canBuildModel = walls.length > 0 && mpp !== null

  const buildModel = useCallback(() => {
    if (!mpp || walls.length === 0) return
    // Origin at the traced geometry's top-left corner, so scene coordinates
    // start near zero instead of carrying a large pixel offset.
    let minX = Infinity
    let minY = Infinity
    for (const w of walls) {
      minX = Math.min(minX, w.a.x, w.b.x)
      minY = Math.min(minY, w.a.y, w.b.y)
    }
    importTracedWalls(walls, { originPx: { x: minX, y: minY }, metresPerPixel: mpp })
    setWorkspace('model')
  }, [walls, mpp, importTracedWalls])

  const openFile = useCallback(
    async (file: File) => {
      try {
        const source = await createImageBitmap(file)
        const scale = Math.min(1, MAX_DIMENSION / Math.max(source.width, source.height))
        const width = Math.round(source.width * scale)
        const height = Math.round(source.height * scale)

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d', { willReadFrequently: true })
        if (!ctx) throw new Error('Could not get a 2D context')
        ctx.drawImage(source, 0, 0, width, height)
        const rgba = ctx.getImageData(0, 0, width, height)

        const bitmap = scale < 1 ? await createImageBitmap(canvas) : source
        loadImage(rgba.data, width, height)
        setImage({ bitmap, width, height, name: file.name })
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [loadImage, setImage, setError],
  )

  // Re-run the mask stage whenever a parameter changes.
  useEffect(() => {
    if (!image) return
    runDebounced(params, false)
  }, [image, params, runDebounced])

  const layerToggle = (key: keyof typeof layers, label: string) => (
    <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-300">
      <input
        type="checkbox"
        checked={layers[key]}
        onChange={() => toggleLayer(key)}
        className="accent-sky-400"
      />
      {label}
    </label>
  )

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-200">
      <header className="flex shrink-0 items-center gap-4 border-b border-slate-800 bg-slate-900 px-4 py-2.5">
        <div>
          <h1 className="text-sm font-semibold tracking-tight text-slate-100">WiFi-Sim</h1>
          <p className="text-[10px] text-slate-500">Physically-based indoor Wi-Fi planning</p>
        </div>

        <nav className="flex rounded border border-slate-700 p-0.5">
          {(
            [
              ['floorplan', 'Floorplan'],
              ['model', `Model${sceneWallCount ? ` (${sceneWallCount})` : ''}`],
              ['simulate', `Simulate${apCount ? ` (${apCount})` : ''}`],
            ] as Array<[Workspace, string]>
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setWorkspace(id)}
              className={`rounded px-3 py-1 text-xs font-medium ${
                workspace === id ? 'bg-sky-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void openFile(file)
              e.target.value = ''
            }}
          />
          <button
            onClick={() => fileInput.current?.click()}
            className="rounded border border-sky-500 bg-sky-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-sky-500"
          >
            Load floorplan…
          </button>
          {image && workspace === 'floorplan' && (
            <span className="text-[11px] text-slate-500">
              {image.name} · {image.width} × {image.height} px
            </span>
          )}
          {/* The header's action is whatever the current tab hands off to next. */}
          {workspace === 'floorplan' && (
            <button
              onClick={buildModel}
              disabled={!canBuildModel}
              title={
                walls.length === 0
                  ? 'Trace the walls first (Vectorisation → “Trace walls”)'
                  : !mpp
                    ? 'Set the scale first (Scale → “Pick two points”)'
                    : 'Convert the traced walls into an editable building model'
              }
              className="rounded border border-emerald-600 bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Build model →
            </button>
          )}
          {workspace === 'model' && (
            <>
              <button
                onClick={buildModel}
                disabled={!canBuildModel}
                title="Re-import the traced walls, discarding manual edits to the geometry"
                className="rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                ↻ Re-import trace
              </button>
              <button
                onClick={() => setWorkspace('simulate')}
                disabled={sceneWallCount === 0}
                title={
                  sceneWallCount === 0
                    ? 'Build the model first'
                    : 'Place access points and compute coverage'
                }
                className="rounded border border-emerald-600 bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Simulate →
              </button>
            </>
          )}
          {workspace === 'simulate' && (
            <button
              onClick={() => setWorkspace('model')}
              className="rounded border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-300 hover:bg-slate-700"
            >
              ← Back to model
            </button>
          )}
        </div>

        <div className="ml-auto flex items-center gap-3">
          {/* Project save / load. Autosave runs regardless; these are for
              moving a project between machines or keeping a named copy. */}
          <input
            ref={projectInput}
            type="file"
            accept=".wifisim,.json,application/json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              void (async () => {
                try {
                  const parsed = await readProjectFile(file)
                  const result = await restoreProject(parsed)
                  if (!result.ok) {
                    setError(result.message)
                    return
                  }
                  if (result.imageData) {
                    loadImage(
                      result.imageData.rgba,
                      result.imageData.width,
                      result.imageData.height,
                    )
                  }
                  setWorkspace(parsed.model.scene.walls.length > 0 ? 'model' : 'floorplan')
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err))
                }
              })()
            }}
          />
          <div className="flex items-center gap-1.5">
            <span
              className="text-[10px] text-slate-500"
              title={
                autosave.lastSaved
                  ? `Autosaved to this browser at ${autosave.lastSaved.toLocaleTimeString()}`
                  : 'Your work is saved in this browser automatically'
              }
            >
              {autosave.state === 'restoring'
                ? 'restoring…'
                : autosave.state === 'saving'
                  ? 'saving…'
                  : autosave.lastSaved
                    ? `saved ${autosave.lastSaved.toLocaleTimeString()}`
                    : 'autosave on'}
            </span>
            <button
              onClick={() =>
                void exportProjectFile().then((blob) =>
                  downloadFile(
                    `wifi-sim-${new Date().toISOString().slice(0, 10)}.wifisim`,
                    blob,
                  ),
                )
              }
              title="Save the whole project (scan, tracing settings, model, materials, APs) to a file"
              className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-700"
            >
              ⤓ Save
            </button>
            <button
              onClick={() => projectInput.current?.click()}
              title="Load a previously saved .wifisim project"
              className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-700"
            >
              ⤒ Open
            </button>
            <button
              onClick={() => {
                if (!window.confirm('Discard the current project and start empty?')) return
                void clearAutosave().then(() => window.location.reload())
              }}
              title="Clear the autosave and start a new project"
              className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-400 hover:bg-slate-700"
            >
              New
            </button>
          </div>
          {workspace === 'floorplan' && (
            <>
              {layerToggle('source', 'Scan')}
              {layerToggle('mask', 'Mask')}
              {layerToggle('skeleton', 'Skeleton')}
              {layerToggle('walls', 'Walls')}
            </>
          )}
          {busy && <span className="text-[11px] text-sky-400">working…</span>}
          {wallsStale && !busy && (
            <span className="text-[11px] text-amber-400">walls outdated, needs re-tracing</span>
          )}
        </div>
      </header>

      {error && (
        <div className="flex shrink-0 items-center justify-between border-b border-rose-900 bg-rose-950/60 px-4 py-2 text-xs text-rose-300">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-rose-400 hover:text-rose-200">
            dismiss
          </button>
        </div>
      )}

      <main className="flex min-h-0 flex-1">
        <div
          className={`relative min-w-0 flex-1 ${dragOver ? 'ring-2 ring-inset ring-sky-500' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            const file = e.dataTransfer.files?.[0]
            if (file) void openFile(file)
          }}
        >
          {workspace === 'floorplan' ? <PlanCanvas /> : <SceneCanvas onProbe={probe} />}
          {workspace === 'simulate' && <ProbeReadout />}
        </div>
        <aside className="w-90 shrink-0 border-l border-slate-800">
          {workspace === 'floorplan' ? (
            <ControlPanel onTrace={() => run(params, true)} />
          ) : workspace === 'model' ? (
            <ScenePanel />
          ) : (
            <SimulatePanel
              onSolve={solve}
              onChannelPlan={runChannelPlan}
              onOptimise={runOptimiser}
            />
          )}
        </aside>
      </main>
    </div>
  )
}
