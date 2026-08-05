import { metresPerPixel, useFloorplanStore, type Tool } from '../state/store'
import { REC601, REC709, type ThresholdMode } from '../floorplan/imageOps'
import { Button, NumberField, Section, SelectField, Slider, Toggle } from './controls'
import { Explainer, WorkflowSteps } from './Workflow'
import { useWorkflowSteps } from './useWorkflowSteps'

export function ControlPanel({ onTrace }: { onTrace: () => void }) {
  const image = useFloorplanStore((s) => s.image)
  const params = useFloorplanStore((s) => s.params)
  const patch = useFloorplanStore((s) => s.patchParams)
  const patchVec = useFloorplanStore((s) => s.patchVectorize)
  const resetParams = useFloorplanStore((s) => s.resetParams)
  const tool = useFloorplanStore((s) => s.tool)
  const setTool = useFloorplanStore((s) => s.setTool)
  const clearExcludeRects = useFloorplanStore((s) => s.clearExcludeRects)
  const calibration = useFloorplanStore((s) => s.calibration)
  const setCalibration = useFloorplanStore((s) => s.setCalibration)
  const stats = useFloorplanStore((s) => s.stats)
  const walls = useFloorplanStore((s) => s.walls)
  const busy = useFloorplanStore((s) => s.busy)

  const mpp = metresPerPixel(calibration)
  const disabled = !image

  const toolButton = (value: Tool, label: string, hint: string) => (
    <button
      key={value}
      title={hint}
      onClick={() => setTool(tool === value ? 'pan' : value)}
      className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${
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

      <Section title="Region" subtitle="Restrict what the tracer looks at">
        <div className="flex flex-wrap gap-1.5">
          {toolButton('pan', 'Pan', 'Drag to pan the view')}
          {toolButton('roi', 'Set ROI', 'Drag a rectangle; everything outside is ignored')}
          {toolButton('exclude', 'Exclude', 'Drag over title blocks or detail drawings to blank them')}
        </div>
        <div className="flex items-center justify-between text-[11px] text-slate-500">
          <span>
            ROI: {params.roi ? `${Math.round(params.roi.w)} × ${Math.round(params.roi.h)} px` : 'full image'}
            {' · '}
            {params.excludeRects.length} excluded
          </span>
          <div className="flex gap-1">
            <Button variant="ghost" onClick={() => patch({ roi: null })} disabled={!params.roi}>
              Clear ROI
            </Button>
            <Button
              variant="ghost"
              onClick={clearExcludeRects}
              disabled={params.excludeRects.length === 0}
            >
              Clear excl.
            </Button>
          </div>
        </div>
      </Section>

      <Section title="Preprocessing" subtitle="Even out the scan before thresholding">
        <SelectField
          label="Grayscale mix"
          value={params.grayWeights === REC709 ? 'rec709' : 'rec601'}
          options={[
            { value: 'rec601', label: 'BT.601 luma (0.299 / 0.587 / 0.114)' },
            { value: 'rec709', label: 'BT.709 luma (0.2126 / 0.7152 / 0.0722)' },
          ]}
          onChange={(v) => patch({ grayWeights: v === 'rec709' ? REC709 : REC601 })}
          help="BT.601 usually separates blueprint ink better; BT.709 matches modern displays."
        />
        <Slider
          label="Brightness"
          value={params.brightness}
          min={-100}
          max={100}
          onChange={(v) => patch({ brightness: v })}
        />
        <Slider
          label="Contrast"
          value={params.contrast}
          min={-100}
          max={100}
          onChange={(v) => patch({ contrast: v })}
        />
        <Slider
          label="Gamma"
          value={params.gamma}
          min={0.2}
          max={3}
          step={0.05}
          onChange={(v) => patch({ gamma: v })}
        />
        <Slider
          label="Denoise blur"
          value={params.blurRadius}
          min={0}
          max={6}
          unit="px"
          onChange={(v) => patch({ blurRadius: v })}
          help="Box blur ×3 ≈ Gaussian. Suppresses scanner grain that would survive thresholding as speckle."
        />
      </Section>

      <Section title="Binarisation" subtitle="Ink vs paper">
        <SelectField
          label="Threshold method"
          value={params.thresholdMode}
          options={[
            { value: 'otsu' as ThresholdMode, label: 'Otsu (automatic global)' },
            { value: 'manual' as ThresholdMode, label: 'Manual level' },
            { value: 'adaptive' as ThresholdMode, label: 'Adaptive local mean' },
          ]}
          onChange={(v) => patch({ thresholdMode: v })}
          help="Adaptive handles uneven exposure across a large scan; Otsu is best on a clean, evenly lit plan."
        />
        {params.thresholdMode === 'manual' && (
          <Slider
            label="Level"
            value={params.manualLevel}
            min={0}
            max={255}
            onChange={(v) => patch({ manualLevel: v })}
          />
        )}
        {params.thresholdMode === 'adaptive' && (
          <>
            <Slider
              label="Window radius"
              value={params.adaptiveRadius}
              min={3}
              max={100}
              unit="px"
              onChange={(v) => patch({ adaptiveRadius: v })}
              help="Must be clearly larger than the thickest wall stroke, or walls get hollowed out."
            />
            <Slider
              label="Offset C"
              value={params.adaptiveOffset}
              min={0}
              max={60}
              onChange={(v) => patch({ adaptiveOffset: v })}
            />
          </>
        )}
        <Toggle
          label="Invert input"
          checked={params.invertInput}
          onChange={(v) => patch({ invertInput: v })}
          help="For plans drawn light-on-dark."
        />
        {stats && stats.effectiveThreshold >= 0 && (
          <p className="text-[11px] text-slate-500">
            Effective threshold: <span className="font-mono">{stats.effectiveThreshold}</span>
          </p>
        )}
      </Section>

      <Section title="Stroke filtering" subtitle="Keep the walls, drop everything else">
        <Slider
          label="Min stroke half-width (opening)"
          value={params.openRadius}
          min={0}
          max={20}
          unit="px"
          onChange={(v) => patch({ openRadius: v })}
          help="Disk opening: removes every stroke thinner than twice this. The main control for deleting dimension lines, hatching and text while keeping thick wall strokes."
        />
        <Slider
          label="Gap bridging (closing)"
          value={params.closeRadius}
          min={0}
          max={20}
          unit="px"
          onChange={(v) => patch({ closeRadius: v })}
          help="Fills notches and scan dropouts narrower than twice this, so a wall does not fall apart into fragments."
        />
        <Slider
          label="Max stroke half-width"
          value={params.maxThicknessRadius}
          min={0}
          max={60}
          unit="px"
          onChange={(v) => patch({ maxThicknessRadius: v })}
          help="0 = off. Removes strokes thicker than twice this: filled-in areas and solid symbols. Can punch holes at wall junctions, so raise the gap bridging alongside it."
        />
        <Slider
          label="Min component area"
          value={params.minComponentArea}
          min={0}
          max={4000}
          step={10}
          unit="px²"
          onChange={(v) => patch({ minComponentArea: v })}
          help="Drops small isolated blobs left over from text and symbols."
        />
      </Section>

      <Section title="Vectorisation" subtitle="Step 2, centrelines → wall segments">
        <Explainer>
          The sliders above only produce the red mask. Nothing becomes a wall until you press{' '}
          <b>Trace walls</b> at the bottom of this section, and it needs pressing again after any
          slider change (the header says “walls outdated” when that happens).
        </Explainer>
        <Slider
          label="Simplify tolerance"
          value={params.vectorize.simplifyEpsilonPx}
          min={0.5}
          max={20}
          step={0.5}
          unit="px"
          onChange={(v) => patchVec({ simplifyEpsilonPx: v })}
          help="Douglas-Peucker. Higher = fewer, straighter segments."
        />
        <Slider
          label="Spur removal"
          value={params.vectorize.spurLengthPx}
          min={0}
          max={80}
          unit="px"
          onChange={(v) => patchVec({ spurLengthPx: v })}
          help="Deletes dead-end branches shorter than this: the stubs thinning leaves at wall ends."
        />
        <Slider
          label="Vertex welding"
          value={params.vectorize.snapTolerancePx}
          min={0}
          max={40}
          unit="px"
          onChange={(v) => patchVec({ snapTolerancePx: v })}
          help="Endpoints closer than this become one shared corner."
        />
        <Slider
          label="Orthogonal snap"
          value={params.vectorize.orthoToleranceDeg}
          min={0}
          max={25}
          unit="°"
          onChange={(v) => patchVec({ orthoToleranceDeg: v })}
          help="0 = off. Pulls near-axis walls exactly onto the axis. Turn off for plans with genuinely angled walls."
        />
        <Slider
          label="Collinear merge"
          value={params.vectorize.collinearToleranceDeg}
          min={0}
          max={30}
          unit="°"
          onChange={(v) => patchVec({ collinearToleranceDeg: v })}
          help="Joins two segments that meet almost straight into one wall."
        />
        <Slider
          label="Min wall length"
          value={params.vectorize.minWallLengthPx}
          min={0}
          max={100}
          unit="px"
          onChange={(v) => patchVec({ minWallLengthPx: v })}
        />
        <Button variant="primary" onClick={onTrace} disabled={disabled || busy}>
          {busy ? 'Working…' : 'Trace walls'}
        </Button>
      </Section>

      <Section title="Scale" subtitle="Step 3, required before the model can be built">
        <Explainer>
          Pick a dimension already printed on your plan (this scan has plenty, e.g. “2.86”) or a wall
          you have measured. Click <b>Pick two points</b>, click each end of it on the drawing, then
          type its real length below.
        </Explainer>
        <div className="flex flex-wrap gap-1.5">
          {toolButton('calibrate', 'Pick two points', 'Click a start and an end point on a known dimension')}
          <Button
            variant="ghost"
            onClick={() => setCalibration({ a: null, b: null })}
            disabled={!calibration.a}
          >
            Reset
          </Button>
        </div>
        <NumberField
          label="Real distance between the two points"
          value={calibration.realMetres}
          min={0.01}
          step={0.01}
          unit="m"
          onChange={(v) => setCalibration({ realMetres: v })}
          help="Use a dimension printed on the plan, or a wall you have measured."
        />
        {mpp ? (
          <p className="rounded bg-slate-800 px-2 py-1.5 text-[11px] text-slate-300">
            Scale: <span className="font-mono">{(mpp * 1000).toFixed(2)} mm/px</span> ·{' '}
            <span className="font-mono">{(1 / mpp).toFixed(1)} px/m</span>
          </p>
        ) : (
          <p className="rounded bg-amber-950/60 px-2 py-1.5 text-[11px] text-amber-300">
            Not calibrated. Pick two points on a known dimension.
          </p>
        )}
      </Section>

      <Section title="Result" subtitle="What the tracer produced" defaultOpen={true}>
        {stats ? (
          <dl className="space-y-1 text-[11px]">
            <Row label="Mask coverage" value={`${stats.coveragePercent.toFixed(2)} %`} />
            <Row label="Mask pixels" value={stats.foregroundPixels.toLocaleString()} />
            <Row label="Walls" value={String(stats.wallCount)} />
            <Row
              label="Total wall length"
              value={
                mpp
                  ? `${walls
                      .reduce(
                        (acc, w) => acc + Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) * mpp,
                        0,
                      )
                      .toFixed(1)} m`
                  : 'not calibrated'
              }
            />
            <Row
              label="Thickness range"
              value={
                walls.length === 0
                  ? '-'
                  : mpp
                    ? `${(Math.min(...walls.map((w) => w.thicknessPx)) * mpp * 1000).toFixed(0)}–${(
                        Math.max(...walls.map((w) => w.thicknessPx)) * mpp * 1000
                      ).toFixed(0)} mm`
                    : `${Math.min(...walls.map((w) => w.thicknessPx)).toFixed(0)}–${Math.max(
                        ...walls.map((w) => w.thicknessPx),
                      ).toFixed(0)} px`
              }
            />
            <Row label="Mask stage" value={`${stats.maskMs.toFixed(0)} ms`} />
            <Row label="Vector stage" value={`${stats.vectorMs.toFixed(0)} ms`} />
          </dl>
        ) : (
          <p className="text-[11px] text-slate-500">No result yet.</p>
        )}
        <Button variant="ghost" onClick={resetParams} disabled={disabled}>
          Reset all sliders
        </Button>
      </Section>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-mono text-slate-300">{value}</dd>
    </div>
  )
}
