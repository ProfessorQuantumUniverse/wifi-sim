import { useEffect, useMemo, useState } from 'react'
import { useSceneStore, totalThickness } from '../state/sceneStore'
import { wallLength, type Opening, type OpeningKind } from '../scene/model'
import { ITU_MATERIALS, type CustomMaterial, type MaterialDefinition } from '../physics/materials'
import { REBAR_PRESETS } from '../physics/wireGrid'
import { COATING_PRESETS, sheetAttenuationDb } from '../physics/coatings'
import type { StackLayer } from '../physics/layerStack'
import { Button, NumberField, Section, SelectField, Slider } from './controls'
import { TransmissionChart } from './TransmissionChart'
import { Explainer, WorkflowSteps } from './Workflow'
import { useWorkflowSteps } from './useWorkflowSteps'

const FREQ_PRESETS = [
  { value: '2.412', label: '2.4 GHz, ch. 1 (2412 MHz)' },
  { value: '2.442', label: '2.4 GHz, ch. 7 (2442 MHz)' },
  { value: '5.220', label: '5 GHz, ch. 44 (5220 MHz)' },
  { value: '5.500', label: '5 GHz, ch. 100 (5500 MHz)' },
  { value: '5.745', label: '5 GHz, ch. 149 (5745 MHz)' },
  { value: '6.135', label: '6 GHz, ch. 37 (6135 MHz)' },
]

export function ScenePanel() {
  const scene = useSceneStore((s) => s.scene)
  const selection = useSceneStore((s) => s.selection)
  const tool = useSceneStore((s) => s.tool)
  const setTool = useSceneStore((s) => s.setTool)
  const pendingOpeningKind = useSceneStore((s) => s.pendingOpeningKind)
  const setPendingOpeningKind = useSceneStore((s) => s.setPendingOpeningKind)
  const setCeilingHeight = useSceneStore((s) => s.setCeilingHeight)
  const setFloorType = useSceneStore((s) => s.setFloorType)
  const setCeilingType = useSceneStore((s) => s.setCeilingType)
  const updateWall = useSceneStore((s) => s.updateWall)
  const deleteWall = useSceneStore((s) => s.deleteWall)
  const setWallTypeForAll = useSceneStore((s) => s.setWallTypeForAll)
  const addOpening = useSceneStore((s) => s.addOpening)
  const updateOpening = useSceneStore((s) => s.updateOpening)
  const deleteOpening = useSceneStore((s) => s.deleteOpening)
  const updateFurniture = useSceneStore((s) => s.updateFurniture)
  const deleteFurniture = useSceneStore((s) => s.deleteFurniture)
  const setTypeLayers = useSceneStore((s) => s.setTypeLayers)
  const customMaterials = useSceneStore((s) => s.customMaterials)
  const addCustomMaterial = useSceneStore((s) => s.addCustomMaterial)
  const inspectorFreqHz = useSceneStore((s) => s.inspectorFreqHz)
  const setInspectorFreq = useSceneStore((s) => s.setInspectorFreq)
  const undo = useSceneStore((s) => s.undo)
  const redo = useSceneStore((s) => s.redo)
  const past = useSceneStore((s) => s.past)
  const future = useSceneStore((s) => s.future)
  const canUndo = past.length > 0
  const canRedo = future.length > 0

  // Keyboard shortcuts, ignored while typing into a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  const selectedWall =
    selection.kind === 'wall'
      ? scene.walls.find((w) => w.id === selection.id)
      : selection.kind === 'opening'
        ? scene.walls.find((w) => w.id === selection.wallId)
        : undefined
  const selectedOpening =
    selection.kind === 'opening'
      ? selectedWall?.openings.find((o) => o.id === selection.openingId)
      : undefined
  const selectedFurniture =
    selection.kind === 'furniture'
      ? scene.furniture.find((f) => f.id === selection.id)
      : undefined

  // Which build-up the inspector shows: the selected opening's, else the
  // selected wall's, else the one chosen manually.
  const [inspectTypeId, setInspectTypeId] = useState<string | null>(null)
  const activeTypeId =
    selectedOpening?.typeId ?? selectedWall?.typeId ?? inspectTypeId ?? scene.wallTypes[1]?.id
  const activeType = scene.wallTypes.find((t) => t.id === activeTypeId)

  const typeOptions = useMemo(
    () => scene.wallTypes.map((t) => ({ value: t.id, label: t.name })),
    [scene.wallTypes],
  )

  const toolButton = (value: typeof tool, label: string) => (
    <button
      onClick={() => setTool(tool === value ? 'select' : value)}
      className={`rounded px-2 py-1 text-[11px] font-medium ${
        tool === value
          ? 'bg-sky-600 text-white'
          : 'border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
      }`}
    >
      {label}
    </button>
  )

  const steps = useWorkflowSteps()

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-slate-900">
      <WorkflowSteps steps={steps} />

      <Section title="Tools">
        <div className="flex items-center gap-1.5">
          <Button onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
            ← Undo{canUndo ? ` (${past.length})` : ''}
          </Button>
          <Button onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
            Redo →
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {toolButton('select', 'Select / move')}
          {toolButton('draw-wall', 'Draw wall')}
          {toolButton('add-opening', 'Add opening')}
          {toolButton('add-furniture', 'Add furniture')}
        </div>
        {tool === 'add-opening' && (
          <SelectField
            label="Opening kind to place"
            value={pendingOpeningKind}
            options={[
              { value: 'window' as OpeningKind, label: 'Window' },
              { value: 'door' as OpeningKind, label: 'Door' },
              { value: 'passage' as OpeningKind, label: 'Open passage' },
            ]}
            onChange={setPendingOpeningKind}
            help="Then click the wall where it belongs."
          />
        )}
        <p className="text-[11px] text-slate-500">
          {scene.walls.length} walls ·{' '}
          {scene.walls.reduce((a, w) => a + w.openings.length, 0)} openings ·{' '}
          {scene.furniture.length} furniture
        </p>
      </Section>

      <Section title="Storey">
        <NumberField
          label="Ceiling height"
          value={scene.ceilingHeightM}
          min={1.8}
          max={6}
          step={0.05}
          unit="m"
          onChange={setCeilingHeight}
          help="Clear internal height. Sets the wall tops and the ceiling plane the tracer reflects off."
        />
        <SelectField
          label="Floor build-up"
          value={scene.floorTypeId}
          options={typeOptions}
          onChange={setFloorType}
        />
        <SelectField
          label="Ceiling build-up"
          value={scene.ceilingTypeId}
          options={typeOptions}
          onChange={setCeilingType}
        />
        <SelectField
          label="Apply one build-up to all walls"
          value={''}
          options={[{ value: '', label: 'pick to apply' }, ...typeOptions]}
          onChange={(v) => v && setWallTypeForAll(v)}
          help="Bulk assignment after tracing; individual walls can then be corrected."
        />
      </Section>

      {selectedWall && selection.kind === 'wall' && (
        <Section title="Selected wall">
          <SelectField
            label="Build-up"
            value={selectedWall.typeId}
            options={typeOptions}
            onChange={(v) => updateWall(selectedWall.id, { typeId: v })}
          />
          <p className="text-[11px] text-slate-500">
            Length <span className="font-mono text-slate-300">{wallLength(selectedWall).toFixed(2)} m</span>
            {' · '}build-up{' '}
            <span className="font-mono text-slate-300">
              {(totalThickness(scene.wallTypes.find((t) => t.id === selectedWall.typeId)!) * 1000).toFixed(0)} mm
            </span>
            {selectedWall.measuredThicknessM !== undefined && (
              <>
                {' · '}measured on plan{' '}
                <span className="font-mono text-slate-300">
                  {(selectedWall.measuredThicknessM * 1000).toFixed(0)} mm
                </span>
              </>
            )}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Base above floor"
              value={selectedWall.baseM}
              min={0}
              step={0.05}
              unit="m"
              onChange={(v) => updateWall(selectedWall.id, { baseM: v })}
            />
            <NumberField
              label="Top above floor"
              value={selectedWall.topM}
              min={0}
              step={0.05}
              unit="m"
              onChange={(v) => updateWall(selectedWall.id, { topM: v })}
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button onClick={() => addOpening(selectedWall.id, 'window', wallLength(selectedWall) / 2)}>
              + Window
            </Button>
            <Button onClick={() => addOpening(selectedWall.id, 'door', wallLength(selectedWall) / 2)}>
              + Door
            </Button>
            <Button onClick={() => addOpening(selectedWall.id, 'passage', wallLength(selectedWall) / 2)}>
              + Passage
            </Button>
            <Button variant="ghost" onClick={() => deleteWall(selectedWall.id)}>
              Delete wall
            </Button>
          </div>
          {selectedWall.openings.length > 0 && (
            <ul className="space-y-1">
              {selectedWall.openings.map((o) => (
                <li key={o.id}>
                  <button
                    onClick={() =>
                      useSceneStore
                        .getState()
                        .setSelection({ kind: 'opening', wallId: selectedWall.id, openingId: o.id })
                    }
                    className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-left text-[11px] text-slate-300 hover:bg-slate-700"
                  >
                    {o.kind} · {o.widthM.toFixed(2)} m wide at {o.offsetM.toFixed(2)} m
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}

      {selectedOpening && selectedWall && (
        <Section title={`Selected ${selectedOpening.kind}`}>
          <OpeningEditor
            opening={selectedOpening}
            wallLengthM={wallLength(selectedWall)}
            ceilingHeightM={scene.ceilingHeightM}
            typeOptions={typeOptions}
            onChange={(patch) => updateOpening(selectedWall.id, selectedOpening.id, patch)}
            onDelete={() => deleteOpening(selectedWall.id, selectedOpening.id)}
          />
        </Section>
      )}

      {selectedFurniture && (
        <Section title="Selected furniture">
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Width"
              value={selectedFurniture.widthM}
              min={0.05}
              step={0.05}
              unit="m"
              onChange={(v) => updateFurniture(selectedFurniture.id, { widthM: v })}
            />
            <NumberField
              label="Depth"
              value={selectedFurniture.depthM}
              min={0.05}
              step={0.05}
              unit="m"
              onChange={(v) => updateFurniture(selectedFurniture.id, { depthM: v })}
            />
            <NumberField
              label="Base"
              value={selectedFurniture.baseM}
              min={0}
              step={0.05}
              unit="m"
              onChange={(v) => updateFurniture(selectedFurniture.id, { baseM: v })}
            />
            <NumberField
              label="Height"
              value={selectedFurniture.heightM}
              min={0.05}
              step={0.05}
              unit="m"
              onChange={(v) => updateFurniture(selectedFurniture.id, { heightM: v })}
            />
          </div>
          <Slider
            label="Rotation"
            value={(selectedFurniture.rotationRad * 180) / Math.PI}
            min={-180}
            max={180}
            onChange={(v) =>
              updateFurniture(selectedFurniture.id, { rotationRad: (v * Math.PI) / 180 })
            }
            unit="°"
          />
          <SelectField
            label="Material"
            value={selectedFurniture.typeId}
            options={typeOptions}
            onChange={(v) => updateFurniture(selectedFurniture.id, { typeId: v })}
          />
          <Button variant="ghost" onClick={() => deleteFurniture(selectedFurniture.id)}>
            Delete
          </Button>
        </Section>
      )}

      <Section title="Build-up inspector" subtitle="What each construction actually does to the signal">
        <Explainer>
          A “build-up” is the layer stack of one construction, for example 15 mm plaster / 175 mm brick /
          15 mm plaster. Every layer's permittivity and conductivity comes from{' '}
          <b>ITU-R P.2040 Table 3</b>; only the thicknesses are yours to set. The two charts below
          are the exact solution for that stack, so you can check a wall before trusting the map.
        </Explainer>
        <SelectField
          label="Build-up"
          value={activeTypeId ?? ''}
          options={typeOptions}
          onChange={(v) => setInspectTypeId(v)}
          help={
            selectedOpening || selectedWall
              ? 'Follows the current selection; change it here to inspect another.'
              : undefined
          }
        />
        <SelectField
          label="Frequency"
          value={(inspectorFreqHz / 1e9).toFixed(3)}
          options={FREQ_PRESETS}
          onChange={(v) => setInspectorFreq(Number(v) * 1e9)}
        />
        {activeType && (
          <>
            <LayerStackEditor
              layers={activeType.layers}
              customMaterials={customMaterials}
              onChange={(layers) => setTypeLayers(activeType.id, layers)}
            />
            <TransmissionChart
              layers={activeType.layers}
              customMaterials={customMaterials}
              freqHz={inspectorFreqHz}
            />
          </>
        )}
      </Section>

      <Section title="Custom material" subtitle="Anything not in ITU-R P.2040 needs a citation" defaultOpen={false}>
        <CustomMaterialForm onAdd={addCustomMaterial} existing={customMaterials} />
      </Section>
    </div>
  )
}

// ---------------------------------------------------------------------------

function OpeningEditor({
  opening,
  wallLengthM,
  ceilingHeightM,
  typeOptions,
  onChange,
  onDelete,
}: {
  opening: Opening
  wallLengthM: number
  ceilingHeightM: number
  typeOptions: Array<{ value: string; label: string }>
  onChange: (patch: Partial<Opening>) => void
  onDelete: () => void
}) {
  return (
    <>
      <Slider
        label="Position along wall"
        value={opening.offsetM}
        min={0}
        max={Math.max(0, wallLengthM - opening.widthM)}
        step={0.01}
        unit="m"
        onChange={(v) => onChange({ offsetM: v })}
      />
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="Width"
          value={opening.widthM}
          min={0.05}
          step={0.01}
          unit="m"
          onChange={(v) => onChange({ widthM: v })}
        />
        <NumberField
          label="Sill height"
          value={opening.sillM}
          min={0}
          max={ceilingHeightM}
          step={0.01}
          unit="m"
          onChange={(v) => onChange({ sillM: v })}
        />
        <NumberField
          label="Head height"
          value={opening.headM}
          min={0}
          max={ceilingHeightM}
          step={0.01}
          unit="m"
          onChange={(v) => onChange({ headM: v })}
        />
        <NumberField
          label="Frame width"
          value={opening.frameWidthM}
          min={0}
          step={0.005}
          unit="m"
          onChange={(v) => onChange({ frameWidthM: v })}
        />
      </div>
      <SelectField
        label="Infill build-up"
        value={opening.typeId}
        options={typeOptions}
        onChange={(v) => onChange({ typeId: v })}
      />
      <SelectField
        label="Frame / mullion build-up"
        value={opening.frameTypeId}
        options={typeOptions}
        onChange={(v) => onChange({ frameTypeId: v })}
        help="An aluminium frame or mullion is a metal surface and reflects strongly, so it is modelled separately from the glass, not averaged into it."
      />
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="Mullions"
          value={opening.mullionCount}
          min={0}
          max={8}
          step={1}
          onChange={(v) => onChange({ mullionCount: Math.round(v) })}
          help="Vertical posts between panes."
        />
        <NumberField
          label="Mullion width"
          value={opening.mullionWidthM}
          min={0.01}
          step={0.005}
          unit="m"
          onChange={(v) => onChange({ mullionWidthM: v })}
        />
      </div>
      <Button variant="ghost" onClick={onDelete}>
        Delete opening
      </Button>
    </>
  )
}

function LayerStackEditor({
  layers,
  customMaterials,
  onChange,
}: {
  layers: StackLayer[]
  customMaterials: CustomMaterial[]
  onChange: (layers: StackLayer[]) => void
}) {
  const materialOptions = [
    ...ITU_MATERIALS.map((m) => ({ value: m.id, label: `${m.name} · P.2040` })),
    ...customMaterials.map((m) => ({ value: m.id, label: `${m.name} · custom` })),
  ]

  const patch = (i: number, p: Partial<StackLayer>) =>
    onChange(layers.map((l, k) => (k === i ? { ...l, ...p } : l)))

  return (
    <div className="space-y-2">
      <p className="text-[10px] text-slate-500">
        Layers run from the outside face inward. Total{' '}
        <span className="font-mono text-slate-300">
          {(layers.reduce((a, l) => a + l.thicknessM, 0) * 1000).toFixed(0)} mm
        </span>
      </p>
      {layers.map((layer, i) => (
        <div key={i} className="space-y-1.5 rounded border border-slate-700 bg-slate-950/60 p-2">
          <div className="flex items-center gap-1.5">
            <select
              value={layer.materialId}
              onChange={(e) => patch(i, { materialId: e.target.value })}
              className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[11px] text-slate-100"
            >
              {materialOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              type="number"
              value={(layer.thicknessM * 1000).toFixed(1)}
              step={0.5}
              min={0}
              onChange={(e) => patch(i, { thicknessM: Number(e.target.value) / 1000 })}
              className="w-16 rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-right font-mono text-[11px] text-slate-100"
            />
            <span className="text-[10px] text-slate-500">mm</span>
            <button
              onClick={() => onChange(layers.filter((_, k) => k !== i))}
              className="px-1 text-slate-500 hover:text-rose-400"
              title="Remove layer"
            >
              ×
            </button>
          </div>
          <label className="flex items-center gap-1.5 text-[10px] text-slate-400">
            <input
              type="checkbox"
              checked={!!layer.grid}
              onChange={(e) =>
                patch(i, {
                  grid: e.target.checked ? { pitchM: 0.15, wireRadiusM: 0.003 } : undefined,
                })
              }
              className="accent-sky-400"
            />
            Embedded conductive mesh
          </label>
          {layer.grid && (
            <select
              value={
                REBAR_PRESETS.find(
                  (p) =>
                    Math.abs(p.pitchM - layer.grid!.pitchM) < 1e-9 &&
                    Math.abs(p.wireRadiusM - layer.grid!.wireRadiusM) < 1e-9,
                )?.id ?? ''
              }
              onChange={(e) => {
                const p = REBAR_PRESETS.find((x) => x.id === e.target.value)
                if (p) patch(i, { grid: { pitchM: p.pitchM, wireRadiusM: p.wireRadiusM } })
              }}
              className="w-full rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[11px] text-slate-100"
            >
              <option value="">custom</option>
              {REBAR_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}

          <label className="block">
            <span className="text-[10px] text-slate-400">Metallic coating on this layer</span>
            <select
              value={
                COATING_PRESETS.find(
                  (p) =>
                    Math.abs(p.sheetResistanceOhmPerSq - (layer.coating?.sheetResistanceOhmPerSq ?? 0)) <
                    1e-9,
                )?.id ?? 'none'
              }
              onChange={(e) => {
                const p = COATING_PRESETS.find((x) => x.id === e.target.value)
                if (!p) return
                patch(i, {
                  coating:
                    p.sheetResistanceOhmPerSq > 0
                      ? { sheetResistanceOhmPerSq: p.sheetResistanceOhmPerSq }
                      : undefined,
                })
              }}
              className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[11px] text-slate-100"
            >
              {COATING_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {layer.coating && (
              <span className="mt-0.5 block text-[10px] leading-snug text-amber-400">
                A bare sheet at {layer.coating.sheetResistanceOhmPerSq} Ω/sq attenuates{' '}
                {sheetAttenuationDb(layer.coating.sheetResistanceOhmPerSq).toFixed(0)} dB. This is
                the single biggest thing people leave out of window models.
              </span>
            )}
          </label>
        </div>
      ))}
      <Button
        onClick={() => onChange([...layers, { materialId: 'plasterboard', thicknessM: 0.0125 }])}
      >
        + Layer
      </Button>
    </div>
  )
}

function CustomMaterialForm({
  onAdd,
  existing,
}: {
  onAdd: (m: CustomMaterial) => void
  existing: CustomMaterial[]
}) {
  const [name, setName] = useState('')
  const [epsR, setEpsR] = useState(2.5)
  const [sigma, setSigma] = useState(0.01)
  const [fMin, setFMin] = useState(1)
  const [fMax, setFMax] = useState(10)
  const [citation, setCitation] = useState('')

  const canAdd = name.trim().length > 0 && citation.trim().length > 0

  const submit = () => {
    if (!canAdd) return
    const m: CustomMaterial = {
      custom: true,
      id: `custom-${name.trim().toLowerCase().replace(/\s+/g, '-')}`,
      name: name.trim(),
      // Frequency-independent entry: eps = a*f^0, sigma = c*f^0.
      a: epsR,
      b: 0,
      c: sigma,
      d: 0,
      fMinGHz: fMin,
      fMaxGHz: fMax,
      provenance: { kind: 'literature', citation: citation.trim() },
    }
    onAdd(m)
    setName('')
    setCitation('')
  }

  return (
    <div className="space-y-2">
      <p className="text-[10px] leading-snug text-slate-500">
        ITU-R P.2040 characterises a limited set of materials. PVC window profiles, screed, tile,
        carpet, mineral wool and Low-E coatings are not among them. Add them here with the source you
        took the values from. The citation is stored with the result and appears in the report.
      </p>
      <label className="block">
        <span className="text-xs font-medium text-slate-300">Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Cement screed"
          className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="Relative permittivity ε′" value={epsR} min={1} step={0.01} onChange={setEpsR} />
        <NumberField label="Conductivity σ" value={sigma} min={0} step={0.001} unit="S/m" onChange={setSigma} />
        <NumberField label="Valid from" value={fMin} min={0.001} step={0.1} unit="GHz" onChange={setFMin} />
        <NumberField label="Valid to" value={fMax} min={0.001} step={0.1} unit="GHz" onChange={setFMax} />
      </div>
      <label className="block">
        <span className="text-xs font-medium text-slate-300">Source (required)</span>
        <input
          value={citation}
          onChange={(e) => setCitation(e.target.value)}
          placeholder="Author, title, table/page, year"
          className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
        />
      </label>
      <Button variant="primary" onClick={submit} disabled={!canAdd}>
        Add material
      </Button>
      {existing.length > 0 && (
        <ul className="space-y-1 text-[10px] text-slate-500">
          {existing.map((m: MaterialDefinition) => (
            <li key={m.id}>
              <span className="text-slate-300">{m.name}</span>: ε′ {m.a}, σ {m.c} S/m
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
