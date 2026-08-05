import { useSimStore, type HeatmapLayer } from '../state/simStore'
import { useSceneStore } from '../state/sceneStore'
import { accessPointPower } from '../engine/solver'
import {
  channelsFor,
  channelCentreMHz,
  maxMcsFor,
  MCS_TABLE,
  noiseFloorDbm,
  requiredSnrDb,
  type Band,
  type ChannelWidthMHz,
  type Generation,
} from '../engine/linkBudget'
import { peakGainDbi, type AntennaSpec, type PatternKind } from '../physics/antenna'
import { orientAntenna } from '../physics/antenna'
import { MOUNTING_PRESETS, mountingPreset } from '../engine/mounting'
import { Button, NumberField, Section, SelectField, Slider, Toggle } from './controls'
import { SCALES, layerUnit } from './heatmapColours'
import { Explainer, WorkflowSteps } from './Workflow'
import { useWorkflowSteps } from './useWorkflowSteps'
import { DeviceSpecImport } from './DeviceSpecImport'
import { NeighbourSection, ChannelPlanSection, OptimiserSection, ReportSection } from './PlanningSections'

const LAYERS: Array<{ value: HeatmapLayer; label: string }> = [
  { value: 'rssi', label: 'Signal strength (RSSI)' },
  { value: 'sinr', label: 'SINR' },
  { value: 'mcs', label: 'Modulation (MCS)' },
  { value: 'phyRate', label: 'PHY rate' },
  { value: 'throughput', label: 'Estimated throughput' },
  { value: 'bestAp', label: 'Best-serving AP' },
]

export function SimulatePanel({
  onSolve,
  onChannelPlan,
  onOptimise,
}: {
  onSolve: () => void
  onChannelPlan: () => void
  onOptimise: () => void
}) {
  const s = useSimStore()
  const wallCount = useSceneStore((st) => st.scene.walls.length)
  const selected = s.aps.find((a) => a.id === s.selectedApId) ?? null
  const power = selected ? accessPointPower(selected, s.domain) : null
  const steps = useWorkflowSteps()

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-slate-900">
      <WorkflowSteps steps={steps} />

      <Section title="Run" subtitle="Place a router, then compute">
        {wallCount === 0 && (
          <Explainer>
            There is no building model yet. Go to the <b>Floorplan</b> tab, trace the walls and set
            the scale, then press <b>Build model →</b>.
          </Explainer>
        )}
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant={s.placingAp ? 'primary' : 'default'}
            onClick={() => s.setPlacingAp(!s.placingAp)}
          >
            {s.placingAp ? 'Click the plan…' : '+ Place AP'}
          </Button>
          <Button
            variant={s.probeMode ? 'primary' : 'default'}
            onClick={() => s.setProbeMode(!s.probeMode)}
            disabled={s.aps.length === 0}
          >
            {s.probeMode ? 'Click to probe…' : 'Probe point'}
          </Button>
        </div>
        <Button variant="primary" onClick={onSolve} disabled={s.solving || s.aps.length === 0 || wallCount === 0}>
          {s.solving ? 'Solving…' : 'Compute coverage'}
        </Button>
        {s.progress && s.solving && (
          <div className="space-y-1">
            <div className="h-1.5 overflow-hidden rounded bg-slate-800">
              <div
                className="h-full bg-sky-500 transition-[width]"
                style={{ width: `${(100 * s.progress.done) / Math.max(1, s.progress.total)}%` }}
              />
            </div>
            <p className="text-[10px] text-slate-500">
              {s.progress.done} / {s.progress.total} cells
            </p>
          </div>
        )}
        {s.error && (
          <p className="rounded bg-rose-950/60 px-2 py-1.5 text-[10px] whitespace-pre-wrap text-rose-300">
            {s.error}
          </p>
        )}
        {s.heatmap && (
          <p className="text-[11px] text-slate-500">
            {s.heatmap.cols} × {s.heatmap.rows} cells in {(s.heatmap.elapsedMs / 1000).toFixed(1)} s
          </p>
        )}
        <Slider
          label="Grid resolution"
          value={s.resolutionM}
          min={0.1}
          max={1}
          step={0.05}
          unit="m"
          onChange={s.setResolution}
          help="Halving this quadruples the solve time. 0.3–0.5 m is plenty for placement decisions."
        />
        <Slider
          label="Evaluation height"
          value={s.evaluationHeightM}
          min={0}
          max={3}
          step={0.05}
          unit="m"
          onChange={s.setEvaluationHeight}
          help="Height above the floor the map is computed at: 1.1 m desk, 1.5 m held phone, 0.1 m robot vacuum."
        />
      </Section>

      <Section title="Display">
        <SelectField label="Layer" value={s.layer} options={LAYERS} onChange={s.setLayer} />
        <Slider
          label="Opacity"
          value={s.heatmapOpacity}
          min={0}
          max={1}
          step={0.02}
          onChange={s.setHeatmapOpacity}
        />
        {s.layer !== 'bestAp' && (
          <ul className="space-y-0.5">
            {[...SCALES[s.layer]].reverse().map((stop) => (
              <li key={stop.label} className="flex items-center gap-2 text-[10px] text-slate-400">
                <span
                  className="inline-block h-3 w-5 rounded-sm"
                  style={{ background: `rgb(${stop.colour.join(',')})` }}
                />
                {stop.label}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={`Access points (${s.aps.length})`}>
        {s.aps.length === 0 && (
          <p className="text-[11px] text-slate-500">
            Place a router first. Drag it on the plan to move it.
          </p>
        )}
        <ul className="space-y-1">
          {s.aps.map((ap) => (
            <li key={ap.id} className="flex items-center gap-1.5">
              <button
                onClick={() => s.selectAp(ap.id)}
                className={`flex-1 truncate rounded px-2 py-1 text-left text-[11px] ${
                  ap.id === s.selectedApId
                    ? 'bg-sky-600 text-white'
                    : 'border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
                }`}
              >
                {ap.name} · {ap.band} GHz ch {ap.channel} · {ap.widthMHz} MHz
              </button>
              <input
                type="checkbox"
                checked={ap.enabled}
                onChange={(e) => s.updateAp(ap.id, { enabled: e.target.checked })}
                title="Enabled"
                className="accent-sky-400"
              />
            </li>
          ))}
        </ul>
      </Section>

      {selected && power && (
        <Section title={`${selected.name}, radio`}>
          <DeviceSpecImport
            kind="ap"
            domain={s.domain}
            onApplyRadio={(patch) => s.updateAp(selected.id, patch)}
          />
          <label className="block">
            <span className="text-xs font-medium text-slate-300">Name</span>
            <input
              value={selected.name}
              onChange={(e) => s.updateAp(selected.id, { name: e.target.value })}
              className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
            />
          </label>
          <SelectField
            label="Wi-Fi generation"
            value={selected.generation}
            options={[
              { value: 'ht' as Generation, label: 'Wi-Fi 4: 802.11n (HT)' },
              { value: 'vht' as Generation, label: 'Wi-Fi 5: 802.11ac (VHT)' },
              { value: 'he' as Generation, label: 'Wi-Fi 6/6E: 802.11ax (HE)' },
              { value: 'eht' as Generation, label: 'Wi-Fi 7: 802.11be (EHT)' },
            ]}
            onChange={(v) => s.updateAp(selected.id, { generation: v })}
            help={`Caps the modulation at MCS ${maxMcsFor(selected.generation)}.`}
          />
          <SelectField
            label="Band"
            value={selected.band}
            options={[
              { value: '2.4' as Band, label: '2.4 GHz' },
              { value: '5' as Band, label: '5 GHz' },
              { value: '6' as Band, label: '6 GHz' },
            ]}
            onChange={(v) =>
              s.updateAp(selected.id, {
                band: v,
                channel: channelsFor(v)[0],
                widthMHz: v === '2.4' ? 20 : selected.widthMHz,
              })
            }
          />
          <SelectField
            label="Channel"
            value={String(selected.channel)}
            options={channelsFor(selected.band).map((c) => ({
              value: String(c),
              label: `${c}: ${channelCentreMHz(selected.band, c)} MHz`,
            }))}
            onChange={(v) => s.updateAp(selected.id, { channel: Number(v) })}
          />
          <SelectField
            label="Channel width"
            value={String(selected.widthMHz)}
            options={(selected.band === '2.4' ? [20, 40] : [20, 40, 80, 160, 320])
              .filter((w) => w !== 320 || selected.generation === 'eht')
              .map((w) => ({ value: String(w), label: `${w} MHz` }))}
            onChange={(v) => s.updateAp(selected.id, { widthMHz: Number(v) as ChannelWidthMHz })}
            help="Wider channels raise the rate but also the noise floor by 3 dB per doubling, so range shrinks."
          />
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Spatial streams"
              value={selected.spatialStreams}
              min={1}
              max={8}
              step={1}
              onChange={(v) => s.updateAp(selected.id, { spatialStreams: Math.round(v) })}
            />
            <SelectField
              label="Guard interval"
              value={String(selected.guardIntervalUs)}
              options={
                selected.generation === 'ht' || selected.generation === 'vht'
                  ? [
                      { value: '0.4', label: '0.4 µs (short)' },
                      { value: '0.8', label: '0.8 µs (long)' },
                    ]
                  : [
                      { value: '0.8', label: '0.8 µs' },
                      { value: '1.6', label: '1.6 µs' },
                      { value: '3.2', label: '3.2 µs' },
                    ]
              }
              onChange={(v) => s.updateAp(selected.id, { guardIntervalUs: Number(v) })}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Conducted power"
              value={selected.conductedPowerDbm}
              min={-10}
              max={30}
              step={0.5}
              unit="dBm"
              onChange={(v) => s.updateAp(selected.id, { conductedPowerDbm: v })}
              help="At the antenna connector, before the antenna gain."
            />
            <NumberField
              label="Feeder loss"
              value={selected.cableLossDb}
              min={0}
              max={20}
              step={0.1}
              unit="dB"
              onChange={(v) => s.updateAp(selected.id, { cableLossDb: v })}
            />
          </div>
          <SelectField
            label="How is it installed?"
            value={selected.mounting}
            options={MOUNTING_PRESETS.map((m) => ({ value: m.id, label: m.name }))}
            onChange={(v) => {
              const preset = mountingPreset(v)
              const o = orientAntenna(
                (Math.atan2(selected.antenna.boresight.y, selected.antenna.boresight.x) * 180) /
                  Math.PI,
                preset.tiltDeg,
              )
              s.updateAp(selected.id, {
                mounting: preset.id,
                heightM: preset.heightM,
                enclosureLossDb: preset.enclosureLossDb,
                antenna: { ...selected.antenna, boresight: o.boresight, reference: o.reference },
              })
            }}
            help={mountingPreset(selected.mounting).hint}
          />
          <div className="grid grid-cols-2 gap-2">
            <NumberField
              label="Mounting height"
              value={selected.heightM}
              min={0}
              max={5}
              step={0.05}
              unit="m"
              onChange={(v) => s.updateAp(selected.id, { heightM: v })}
            />
            <NumberField
              label="Enclosure loss"
              value={selected.enclosureLossDb}
              min={0}
              max={40}
              step={0.5}
              unit="dB"
              onChange={(v) => s.updateAp(selected.id, { enclosureLossDb: v })}
              help={`One-way loss of whatever is directly in front of the antenna. Basis: ${mountingPreset(selected.mounting).enclosureBasis}.`}
            />
          </div>

          <div
            className={`space-y-1 rounded px-2 py-1.5 text-[10px] leading-snug ${
              power.compliance.compliant
                ? 'bg-slate-800 text-slate-400'
                : 'bg-rose-950/60 text-rose-300'
            }`}
          >
            <div>
              EIRP <span className="font-mono">{power.eirpDbm.toFixed(1)} dBm</span> (
              {Math.pow(10, power.eirpDbm / 10).toFixed(0)} mW) ={' '}
              {power.effectiveConductedDbm.toFixed(1)} dBm + {power.gainDbi.toFixed(1)} dBi.{' '}
              {power.compliance.limit
                ? `Limit ${power.compliance.maxEirpDbm.toFixed(1)} dBm: ${power.compliance.limit.citation}.`
                : ''}
              {!power.compliance.compliant &&
                ` Exceeds by ${power.compliance.exceedanceDb.toFixed(1)} dB.`}
              {power.compliance.messages.map((m) => ` ${m}`)}
            </div>
            {selected.enclosureLossDb > 0 && (
              <div>
                Radiating {power.radiatedConductedDbm.toFixed(1)} dBm after{' '}
                {selected.enclosureLossDb.toFixed(1)} dB of enclosure loss. The limit applies at the
                antenna, the enclosure comes after it.
              </div>
            )}
            {!power.compliance.compliant && (
              <Button
                onClick={() =>
                  s.updateAp(selected.id, {
                    conductedPowerDbm:
                      selected.conductedPowerDbm - power.compliance.exceedanceDb,
                  })
                }
              >
                Reduce to the {power.compliance.maxEirpDbm.toFixed(1)} dBm limit
              </Button>
            )}
          </div>
          <AntennaEditor
            spec={selected.antenna}
            onChange={(antenna) => s.updateAp(selected.id, { antenna })}
          />
          <Button variant="ghost" onClick={() => s.deleteAp(selected.id)}>
            Delete AP
          </Button>
        </Section>
      )}

      <Section title="Client device" subtitle="What you are measuring coverage for">
        <Explainer>
          Coverage is not a property of the router alone. A 2-chain phone held in your hand sees a
          very different map from a 3-chain laptop on a desk. These four numbers are what actually
          change the answer.
        </Explainer>
        <DeviceSpecImport kind="client" onApplyClient={(patch) => s.patchClient(patch)} />
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Receive chains"
            value={s.client.antennaCount}
            min={1}
            max={8}
            step={1}
            onChange={(v) => s.patchClient({ antennaCount: Math.round(v) })}
            help="Phones are usually 2, laptops 2–3. Caps the streams together with the AP."
          />
          <NumberField
            label="Noise figure"
            value={s.client.noiseFigureDb}
            min={0}
            max={15}
            step={0.5}
            unit="dB"
            onChange={(v) => s.patchClient({ noiseFigureDb: v })}
            help="6–8 dB is typical for a Wi-Fi front end."
          />
          <NumberField
            label="Body loss"
            value={s.client.bodyLossDb}
            min={0}
            max={15}
            step={0.5}
            unit="dB"
            onChange={(v) => s.patchClient({ bodyLossDb: v })}
            help="Hand and body absorption. 0 for a fixed device, 3–6 dB for a held phone."
          />
          <NumberField
            label="Chipset margin"
            value={s.client.implementationMarginDb}
            min={-5}
            max={10}
            step={0.5}
            unit="dB"
            onChange={(v) => s.patchClient({ implementationMarginDb: v })}
            help="How many dB better than a just-compliant receiver this chipset is. 0 dB is a device that only meets the IEEE minimum sensitivity; 5 dB gives back the whole implementation allowance the standard builds into that figure. Raising it lowers the SNR every rate needs."
          />
        </div>
        <p className="rounded bg-slate-800 px-2 py-1.5 text-[10px] text-slate-400">
          Noise floor at 20 MHz:{' '}
          <span className="font-mono text-slate-200">
            {noiseFloorDbm(20, s.client.noiseFigureDb).toFixed(1)} dBm
          </span>{' '}
          · MCS0 needs {requiredSnrDb(0, 5, s.client.implementationMarginDb).toFixed(1)} dB SNR, MCS
          {MCS_TABLE.length - 1} needs{' '}
          {requiredSnrDb(MCS_TABLE.length - 1, 5, s.client.implementationMarginDb).toFixed(1)} dB
        </p>
        <AntennaEditor
          spec={s.client.antenna}
          onChange={(antenna) => s.patchClient({ antenna })}
          label="Client antenna"
        />
      </Section>

      <NeighbourSection />
      <ChannelPlanSection onChannelPlan={onChannelPlan} />
      <OptimiserSection onOptimise={onOptimise} />
      <ReportSection />

      <Section title="Engine" subtitle="Accuracy against solve time" defaultOpen={false}>
        <Explainer>
          These change how the physics is evaluated, not what is being modelled. The defaults are
          the ones the engine was validated with (free space to 0.002 dB, two-ray to 0.06 dB).
        </Explainer>
        <SelectField
          label="Regulatory domain"
          value={s.domain}
          options={[
            { value: 'etsi', label: 'ETSI / EU' },
            { value: 'fcc', label: 'FCC / US' },
          ]}
          onChange={s.setDomain}
        />
        <SelectField
          label="Reflection order"
          value={String(s.trace.maxReflectionOrder)}
          options={[
            { value: '0', label: '0, direct paths only' },
            { value: '1', label: '1, single reflections' },
            { value: '2', label: '2, double reflections (recommended)' },
          ]}
          onChange={(v) =>
            s.patchTrace({ maxReflectionOrder: Number(v) as 0 | 1 | 2 })
          }
        />
        <Slider
          label="Second-order reflector cap"
          value={s.trace.secondOrderReflectorCap}
          min={5}
          max={120}
          step={5}
          onChange={(v) => s.patchTrace({ secondOrderReflectorCap: v })}
          help="Double reflections are enumerated over the N largest surfaces (floor, ceiling, long walls), which carry essentially all of the second-order energy. Cost grows as N²."
        />
        <Toggle
          label="Edge diffraction (UTD)"
          checked={s.trace.enableDiffraction}
          onChange={(v) => s.patchTrace({ enableDiffraction: v })}
          help="Fills the shadow behind corners and through door reveals. Without it a ray model shows an unphysical cliff at the shadow boundary."
        />
        <Slider
          label="Path dynamic range"
          value={s.trace.dynamicRangeDb}
          min={15}
          max={80}
          step={5}
          unit="dB"
          onChange={(v) => s.patchTrace({ dynamicRangeDb: v })}
          help="Paths weaker than this below the strongest one are discarded: they cannot move the sum."
        />
        <NumberField
          label="Max wall transmissions"
          value={s.trace.maxTransmissions}
          min={0}
          max={20}
          step={1}
          onChange={(v) => s.patchTrace({ maxTransmissions: Math.round(v) })}
        />
        <SelectField
          label="Multipath combining"
          value={s.combining}
          options={[
            { value: 'incoherent', label: 'Local average (incoherent)' },
            { value: 'coherent', label: 'Coherent sum (shows fading)' },
          ]}
          onChange={(v) => s.setCombining(v as 'coherent' | 'incoherent')}
          help="The coherent sum is the true instantaneous field, with its half-wavelength standing-wave pattern. The local average is what a moving client experiences and is the better basis for placement decisions."
        />
      </Section>
    </div>
  )
}

function AntennaEditor({
  spec,
  onChange,
  label = 'Antenna',
}: {
  spec: AntennaSpec
  onChange: (s: AntennaSpec) => void
  label?: string
}) {
  // Recover the azimuth/tilt the orientation helper would produce.
  const tiltDeg = (Math.asin(Math.max(-1, Math.min(1, spec.boresight.z))) * 180) / Math.PI
  const azimuthDeg = (Math.atan2(spec.boresight.y, spec.boresight.x) * 180) / Math.PI

  const reorient = (az: number, tilt: number) => {
    const o = orientAntenna(az, tilt)
    onChange({ ...spec, boresight: o.boresight, reference: o.reference })
  }

  return (
    <div className="space-y-2 rounded border border-slate-700 bg-slate-950/50 p-2">
      <SelectField
        label={label}
        value={spec.kind}
        options={[
          { value: 'dipole' as PatternKind, label: 'Half-wave dipole (2.15 dBi)' },
          { value: 'collinear' as PatternKind, label: 'Collinear omni array' },
          { value: 'sector' as PatternKind, label: 'Patch / sector' },
          { value: 'isotropic' as PatternKind, label: 'Isotropic (0 dBi, reference)' },
        ]}
        onChange={(kind) => onChange({ ...spec, kind })}
      />
      {spec.kind === 'collinear' && (
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Elements"
            value={spec.elements ?? 2}
            min={2}
            max={12}
            step={1}
            onChange={(v) => onChange({ ...spec, elements: Math.round(v) })}
          />
          <NumberField
            label="Spacing"
            value={spec.spacingLambda ?? 0.8}
            min={0.3}
            max={1.5}
            step={0.05}
            unit="λ"
            onChange={(v) => onChange({ ...spec, spacingLambda: v })}
          />
        </div>
      )}
      {spec.kind === 'sector' && (
        <div className="grid grid-cols-2 gap-2">
          <NumberField
            label="Peak gain"
            value={spec.peakGainDbi ?? 8}
            min={0}
            max={25}
            step={0.5}
            unit="dBi"
            onChange={(v) => onChange({ ...spec, peakGainDbi: v })}
          />
          <NumberField
            label="Front-to-back"
            value={spec.frontToBackDb ?? 30}
            min={10}
            max={40}
            step={1}
            unit="dB"
            onChange={(v) => onChange({ ...spec, frontToBackDb: v })}
          />
          <NumberField
            label="H beamwidth"
            value={spec.hBeamwidthDeg ?? 65}
            min={10}
            max={180}
            step={5}
            unit="°"
            onChange={(v) => onChange({ ...spec, hBeamwidthDeg: v })}
          />
          <NumberField
            label="V beamwidth"
            value={spec.vBeamwidthDeg ?? 65}
            min={10}
            max={180}
            step={5}
            unit="°"
            onChange={(v) => onChange({ ...spec, vBeamwidthDeg: v })}
          />
        </div>
      )}
      <OrientationEditor spec={spec} azimuthDeg={azimuthDeg} tiltDeg={tiltDeg} onReorient={reorient} />

      <p className="text-[10px] text-slate-500">
        Peak gain <span className="font-mono text-slate-300">{peakGainDbi(spec).toFixed(2)} dBi</span>
        {(spec.kind === 'dipole' || spec.kind === 'collinear') &&
          '. It follows from the pattern itself, not a free setting.'}
      </p>
    </div>
  )
}

/**
 * Orientation with a picture. The two angles are hard to hold in your head
 * otherwise: what the sliders control is the antenna's *axis* for an omni (the
 * direction of least radiation) but its *beam* for a sector (the direction of
 * most). The side view makes that difference visible, and the plan arrow on the
 * map shows the azimuth in the same frame as the floorplan.
 */
function OrientationEditor({
  spec,
  azimuthDeg,
  tiltDeg,
  onReorient,
}: {
  spec: AntennaSpec
  azimuthDeg: number
  tiltDeg: number
  onReorient: (az: number, tilt: number) => void
}) {
  const isOmni = spec.kind === 'dipole' || spec.kind === 'collinear'
  const tiltRad = (tiltDeg * Math.PI) / 180

  // Side-view sketch, 90 px wide: the antenna axis and the resulting lobe.
  const cx = 45
  const cy = 34
  const len = 22
  const ax = cx + len * Math.cos(-tiltRad)
  const ay = cy + len * Math.sin(-tiltRad)
  const bx = cx - len * Math.cos(-tiltRad)
  const by = cy - len * Math.sin(-tiltRad)
  // The lobe of an omni is perpendicular to the axis; a sector's is along it.
  const lobeAngle = isOmni ? -tiltRad + Math.PI / 2 : -tiltRad

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <svg viewBox="0 0 90 68" className="h-16 w-24 shrink-0 rounded bg-slate-950">
          <line x1="4" y1="60" x2="86" y2="60" stroke="#475569" strokeWidth="1.5" />
          <text x="6" y="67" fontSize="6" fill="#64748b">
            floor
          </text>
          {isOmni ? (
            <>
              {[1, -1].map((s) => (
                <ellipse
                  key={s}
                  cx={cx + s * 16 * Math.cos(lobeAngle)}
                  cy={cy + s * 16 * Math.sin(lobeAngle)}
                  rx="15"
                  ry="9"
                  fill="rgba(56,189,248,0.22)"
                  transform={`rotate(${(lobeAngle * 180) / Math.PI} ${cx + s * 16 * Math.cos(lobeAngle)} ${cy + s * 16 * Math.sin(lobeAngle)})`}
                />
              ))}
            </>
          ) : (
            <path
              d={`M ${cx} ${cy} L ${cx + 34 * Math.cos(lobeAngle - 0.5)} ${cy + 34 * Math.sin(lobeAngle - 0.5)} A 34 34 0 0 1 ${cx + 34 * Math.cos(lobeAngle + 0.5)} ${cy + 34 * Math.sin(lobeAngle + 0.5)} Z`}
              fill="rgba(56,189,248,0.28)"
            />
          )}
          <line x1={ax} y1={ay} x2={bx} y2={by} stroke="#facc15" strokeWidth="2.5" />
          <circle cx={cx} cy={cy} r="2.5" fill="#facc15" />
        </svg>
        <p className="text-[10px] leading-snug text-slate-400">
          {isOmni ? (
            <>
              The yellow bar is the <b>antenna rod</b>. It radiates in a ring{' '}
              <b>sideways</b> from itself and almost nothing off its ends, so an upright whip
              (90°) covers the floor well and the ceiling badly. Lay it flat and you lose the room
              but gain the storey above.
            </>
          ) : (
            <>
              The blue wedge is the <b>beam</b>. It points where the sliders aim it; tilt down to
              cover a room below, up to reach a mezzanine.
            </>
          )}
        </p>
      </div>

      <Slider
        label={isOmni ? 'Rod direction, rotation on the plan' : 'Beam direction on the plan'}
        value={Math.round(azimuthDeg)}
        min={-180}
        max={180}
        unit="°"
        onChange={(v) => onReorient(v, tiltDeg)}
        help={
          isOmni
            ? 'Only matters once the rod is tilted away from upright. A vertical whip is the same in every direction. 0° = towards the right edge of the plan, 90° = downward on screen.'
            : '0° = towards the right edge of the plan, 90° = downward on screen. The yellow arrow on the map shows it.'
        }
      />
      <Slider
        label={isOmni ? 'Rod tilt: 90° is upright' : 'Beam tilt: 0° is horizontal'}
        value={Math.round(tiltDeg)}
        min={-90}
        max={90}
        unit="°"
        onChange={(v) => onReorient(azimuthDeg, v)}
        help={
          isOmni
            ? '90° upright (normal router on a shelf), −90° hanging down (ceiling mount), 0° lying flat. Tilting also rotates the polarisation, which costs signal to a differently-oriented client. The engine accounts for that.'
            : '0° straight out, negative points downward.'
        }
      />
    </div>
  )
}

export function layerUnitLabel(l: HeatmapLayer): string {
  return layerUnit(l)
}
