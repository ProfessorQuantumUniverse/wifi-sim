import { useState } from 'react'
import { useSimStore } from '../state/simStore'
import { useSceneStore } from '../state/sceneStore'
import { calibrateNeighbour } from '../engine/planning'
import { channelsFor, channelCentreMHz, type Band, type ChannelWidthMHz } from '../engine/linkBudget'
import { renderHeatmap } from './heatmapColours'
import { buildReportHtml, downloadFile, openReport } from './report'
import { Button, NumberField, Section, SelectField, Slider } from './controls'
import { Explainer } from './Workflow'

// ---------------------------------------------------------------------------

export function NeighbourSection() {
  const s = useSimStore()
  const scene = useSceneStore((st) => st.scene)
  const customMaterials = useSceneStore((st) => st.customMaterials)
  const selected = s.externalNetworks.find((n) => n.id === s.selectedExternalId) ?? null

  const calibration =
    selected && selected.calibration
      ? calibrateNeighbour(scene, customMaterials, selected, s.client, s.trace)
      : null

  return (
    <Section title={`Neighbouring networks (${s.externalNetworks.length})`} defaultOpen={false}>
      <Explainer>
        A neighbour's transmit power is never published, so this does not assume one. Put its router
        roughly where it sits (often just outside a wall), then stand somewhere in your flat, note
        what RSSI your phone reports for that SSID, and enter both. The engine traces that geometry
        and back-solves the power that reproduces your reading, after which the neighbour's
        interference everywhere else follows the same physics as your own APs.
      </Explainer>

      <Button onClick={() => s.setPlacingExternal({ id: 'new', what: 'source' })}>
        + Add neighbour (click the plan)
      </Button>

      <ul className="space-y-1">
        {s.externalNetworks.map((net) => (
          <li key={net.id} className="flex items-center gap-1.5">
            <button
              onClick={() => s.selectExternal(net.id)}
              className={`flex-1 truncate rounded px-2 py-1 text-left text-[11px] ${
                net.id === s.selectedExternalId
                  ? 'bg-fuchsia-700 text-white'
                  : 'border border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {net.ssid} · {net.band} GHz ch {net.channel}
              {net.calibration ? ` · ${net.calibration.measuredDbm} dBm ref` : ' · uncalibrated'}
            </button>
            <input
              type="checkbox"
              checked={net.enabled}
              onChange={(e) => s.updateExternal(net.id, { enabled: e.target.checked })}
              className="accent-fuchsia-400"
            />
          </li>
        ))}
      </ul>

      {selected && (
        <div className="space-y-2 rounded border border-slate-700 bg-slate-950/60 p-2">
          <label className="block">
            <span className="text-xs font-medium text-slate-300">SSID</span>
            <input
              value={selected.ssid}
              onChange={(e) => s.updateExternal(selected.id, { ssid: e.target.value })}
              className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
            />
          </label>
          <SelectField
            label="Band"
            value={selected.band}
            options={[
              { value: '2.4' as Band, label: '2.4 GHz' },
              { value: '5' as Band, label: '5 GHz' },
              { value: '6' as Band, label: '6 GHz' },
            ]}
            onChange={(v) =>
              s.updateExternal(selected.id, { band: v, channel: channelsFor(v)[0] })
            }
          />
          <div className="grid grid-cols-2 gap-2">
            <SelectField
              label="Channel"
              value={String(selected.channel)}
              options={channelsFor(selected.band).map((c) => ({
                value: String(c),
                label: `${c}: ${channelCentreMHz(selected.band, c)} MHz`,
              }))}
              onChange={(v) => s.updateExternal(selected.id, { channel: Number(v) })}
            />
            <SelectField
              label="Width"
              value={String(selected.widthMHz)}
              options={[20, 40, 80, 160].map((w) => ({ value: String(w), label: `${w} MHz` }))}
              onChange={(v) =>
                s.updateExternal(selected.id, { widthMHz: Number(v) as ChannelWidthMHz })
              }
            />
          </div>

          <div className="flex flex-wrap gap-1.5">
            <Button
              variant={
                s.placingExternal?.id === selected.id && s.placingExternal.what === 'source'
                  ? 'primary'
                  : 'default'
              }
              onClick={() => s.setPlacingExternal({ id: selected.id, what: 'source' })}
            >
              Set router position
            </Button>
            <Button
              variant={
                s.placingExternal?.id === selected.id && s.placingExternal.what === 'ref'
                  ? 'primary'
                  : 'default'
              }
              onClick={() => s.setPlacingExternal({ id: selected.id, what: 'ref' })}
            >
              Set measurement spot
            </Button>
          </div>
          <p className="text-[10px] text-slate-500">
            Router at {selected.x.toFixed(2)}, {selected.y.toFixed(2)} m ·{' '}
            {selected.calibration
              ? `reading spot ${selected.calibration.refX.toFixed(2)}, ${selected.calibration.refY.toFixed(2)} m`
              : 'no reading spot set'}
          </p>

          {selected.calibration ? (
            <>
              <NumberField
                label="RSSI you measured there"
                value={selected.calibration.measuredDbm}
                min={-100}
                max={-10}
                step={1}
                unit="dBm"
                onChange={(v) =>
                  s.updateExternal(selected.id, {
                    calibration: { ...selected.calibration!, measuredDbm: v },
                  })
                }
              />
              {calibration && (
                <p
                  className={`rounded px-2 py-1.5 text-[10px] leading-snug ${
                    calibration.ok ? 'bg-slate-800 text-slate-400' : 'bg-amber-950/60 text-amber-300'
                  }`}
                >
                  {calibration.message}
                </p>
              )}
              <Button
                variant="ghost"
                onClick={() => s.updateExternal(selected.id, { calibration: null })}
              >
                Use an assumed EIRP instead
              </Button>
            </>
          ) : (
            <NumberField
              label="Assumed EIRP (no measurement)"
              value={selected.assumedEirpDbm}
              min={0}
              max={36}
              step={0.5}
              unit="dBm"
              onChange={(v) => s.updateExternal(selected.id, { assumedEirpDbm: v })}
              help="A guess. Set a measurement spot instead. It is far more reliable than assuming a neighbour's power."
            />
          )}
          <Button variant="ghost" onClick={() => s.deleteExternal(selected.id)}>
            Delete neighbour
          </Button>
        </div>
      )}
    </Section>
  )
}

// ---------------------------------------------------------------------------

export function ChannelPlanSection({ onChannelPlan }: { onChannelPlan: () => void }) {
  const s = useSimStore()
  const serving = s.aps.find((a) => a.id === s.selectedApId) ?? s.aps.find((a) => a.enabled)

  return (
    <Section title="Channel plan" defaultOpen={false}>
      <Explainer>
        Ranks every channel in the selected AP's band by the SINR it would give, using the
        interference already in the computed map. The 5th percentile is the number to look at: it
        is what your worst corner gets. Candidates stay inside one band on purpose: across a band
        the walls behave the same, across bands they do not.
      </Explainer>
      <Button onClick={onChannelPlan} disabled={!s.heatmap || !serving}>
        Rank channels{serving ? ` for ${serving.name}` : ''}
      </Button>
      {!s.heatmap && (
        <p className="text-[10px] text-slate-500">Compute coverage first.</p>
      )}
      {s.channelPlan && serving && (
        <div className="overflow-x-auto">
          <table className="w-full text-[10px]">
            <thead>
              <tr className="text-slate-500">
                <th className="text-left">Ch</th>
                <th className="text-right">5% SINR</th>
                <th className="text-right">med.</th>
                <th className="text-left">Overlaps</th>
              </tr>
            </thead>
            <tbody>
              {s.channelPlan.slice(0, 10).map((c, i) => (
                <tr
                  key={c.channel}
                  className={
                    c.channel === serving.channel
                      ? 'bg-sky-900/50 text-sky-200'
                      : i === 0
                        ? 'bg-emerald-900/40 text-emerald-200'
                        : 'text-slate-400'
                  }
                >
                  <td className="font-mono">
                    {c.channel}
                    {c.channel === serving.channel ? ' •' : ''}
                  </td>
                  <td className="text-right font-mono">{c.p5SinrDb.toFixed(1)}</td>
                  <td className="text-right font-mono">{c.medianSinrDb.toFixed(1)}</td>
                  <td className="truncate">
                    {c.overlappingSources.length ? c.overlappingSources.join(', ') : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-[10px] text-slate-500">
            • = current channel. Green = best. Apply with the Channel selector above.
          </p>
        </div>
      )}
    </Section>
  )
}

// ---------------------------------------------------------------------------

export function OptimiserSection({ onOptimise }: { onOptimise: () => void }) {
  const s = useSimStore()

  return (
    <Section title="Placement optimiser" defaultOpen={false}>
      <Explainer>
        Searches the plan for the router position that covers the most floor area at or above your
        target, scoring every candidate with the same ray-traced physics as the main solve, not a
        distance rule of thumb. It uses the currently selected AP's radio settings as the template.
      </Explainer>
      <NumberField
        label="Coverage target"
        value={s.optimiser.targetRssiDbm}
        min={-90}
        max={-40}
        step={1}
        unit="dBm"
        onChange={(v) => s.patchOptimiser({ targetRssiDbm: v })}
        help="−67 dBm is the usual figure for reliable data and voice; −75 dBm for browsing only."
      />
      <div className="grid grid-cols-2 gap-2">
        <NumberField
          label="APs to place"
          value={s.optimiser.apCount}
          min={1}
          max={4}
          step={1}
          onChange={(v) => s.patchOptimiser({ apCount: Math.round(v) })}
        />
        <NumberField
          label="Mounting height"
          value={s.optimiser.mountingHeightM}
          min={0}
          max={3}
          step={0.05}
          unit="m"
          onChange={(v) => s.patchOptimiser({ mountingHeightM: v })}
        />
      </div>
      <Slider
        label="Candidate spacing"
        value={s.optimiser.candidateSpacingM}
        min={0.5}
        max={4}
        step={0.25}
        unit="m"
        onChange={(v) => s.patchOptimiser({ candidateSpacingM: v })}
        help="How finely positions are tried. Cost scales as candidates × evaluation points, so halving both quadruples the time."
      />
      <Slider
        label="Evaluation spacing"
        value={s.optimiser.evaluationSpacingM}
        min={0.5}
        max={3}
        step={0.25}
        unit="m"
        onChange={(v) => s.patchOptimiser({ evaluationSpacingM: v })}
      />
      <Button variant="primary" onClick={onOptimise} disabled={s.optimising || s.aps.length === 0}>
        {s.optimising ? 'Searching…' : 'Find the best position'}
      </Button>
      {s.optimising && s.progress && (
        <div className="h-1.5 overflow-hidden rounded bg-slate-800">
          <div
            className="h-full bg-sky-500"
            style={{ width: `${(100 * s.progress.done) / Math.max(1, s.progress.total)}%` }}
          />
        </div>
      )}
      {s.optimiserResult && (
        <div className="space-y-1">
          {s.optimiserResult.suggestions.map((sug, i) => (
            <button
              key={i}
              onClick={() => {
                const target = s.aps.find((a) => a.id === s.selectedApId) ?? s.aps[0]
                if (target) s.updateAp(target.id, { x: sug.x, y: sug.y })
              }}
              className="w-full rounded border border-emerald-700 bg-emerald-900/40 px-2 py-1 text-left text-[10px] text-emerald-200 hover:bg-emerald-800/50"
            >
              <b>#{i + 1}</b> at {sug.x.toFixed(2)}, {sug.y.toFixed(2)} m, covers{' '}
              {(sug.coverage * 100).toFixed(0)} % at target, 5th pct {sug.p5RssiDbm.toFixed(1)} dBm
              <span className="block text-emerald-400/70">click to move the selected AP here</span>
            </button>
          ))}
          <p className="text-[10px] text-slate-500">
            {s.optimiserResult.candidatesEvaluated} candidates ×{' '}
            {s.optimiserResult.evaluationCells} points in{' '}
            {(s.optimiserResult.elapsedMs / 1000).toFixed(1)} s. {s.optimiserResult.note}
          </p>
        </div>
      )}
    </Section>
  )
}

// ---------------------------------------------------------------------------

export function ReportSection() {
  const s = useSimStore()
  const scene = useSceneStore((st) => st.scene)
  const customMaterials = useSceneStore((st) => st.customMaterials)
  const [busy, setBusy] = useState(false)

  /** Rasterise the current layer at 40 px/m for embedding in the report. */
  const renderMap = async (): Promise<string> => {
    const h = s.heatmap!
    const PPM = 40
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(h.cols * h.spec.resolutionM * PPM)
    canvas.height = Math.round(h.rows * h.spec.resolutionM * PPM)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#0b1120'
    ctx.fillRect(0, 0, canvas.width, canvas.height)

    const bitmap = await createImageBitmap(renderHeatmap(h, s.layer, 1))
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

    // Walls and APs on top, in the same coordinate frame as the grid.
    ctx.save()
    ctx.scale(PPM, PPM)
    ctx.translate(-h.spec.minX + h.spec.resolutionM / 2, -h.spec.minY + h.spec.resolutionM / 2)
    ctx.strokeStyle = 'rgba(226,232,240,0.9)'
    ctx.lineCap = 'butt'
    for (const wall of scene.walls) {
      const type = scene.wallTypes.find((t) => t.id === wall.typeId)
      ctx.lineWidth = type ? type.layers.reduce((a, l) => a + l.thicknessM, 0) : 0.1
      ctx.beginPath()
      ctx.moveTo(wall.a.x, wall.a.y)
      ctx.lineTo(wall.b.x, wall.b.y)
      ctx.stroke()
    }
    ctx.fillStyle = '#38bdf8'
    ctx.strokeStyle = '#fff'
    ctx.lineWidth = 3 / PPM
    for (const ap of s.aps.filter((a) => a.enabled)) {
      ctx.beginPath()
      ctx.arc(ap.x, ap.y, 10 / PPM, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
    }
    ctx.restore()
    return canvas.toDataURL('image/png')
  }

  const build = async (): Promise<string> => {
    const mapDataUrl = await renderMap()
    return buildReportHtml({
      scene,
      customMaterials,
      aps: s.aps,
      client: s.client,
      heatmap: s.heatmap!,
      channelPlan: s.channelPlan,
      domain: s.domain,
      combining: s.combining,
      reflectionOrder: s.trace.maxReflectionOrder,
      diffraction: s.trace.enableDiffraction,
      mapDataUrl,
      generatedAt: new Date().toLocaleString(),
    })
  }

  const run = async (mode: 'open' | 'download') => {
    if (!s.heatmap) return
    setBusy(true)
    try {
      const html = await build()
      if (mode === 'open') openReport(html)
      else downloadFile('wifi-coverage-report.html', new Blob([html], { type: 'text/html' }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section title="Report" defaultOpen={false}>
      <Explainer>
        One self-contained HTML file: the map, every radio and client setting that produced it, the
        channel ranking, and the source of every material constant used. Nothing external is loaded,
        so it stays readable years from now.
      </Explainer>
      <div className="flex flex-wrap gap-1.5">
        <Button variant="primary" onClick={() => void run('open')} disabled={!s.heatmap || busy}>
          {busy ? 'Rendering…' : 'Open report'}
        </Button>
        <Button onClick={() => void run('download')} disabled={!s.heatmap || busy}>
          Download .html
        </Button>
        <Button
          onClick={() => {
            if (!s.heatmap) return
            void renderMap().then((url) =>
              fetch(url)
                .then((r) => r.blob())
                .then((b) => downloadFile(`wifi-${s.layer}.png`, b)),
            )
          }}
          disabled={!s.heatmap}
        >
          Map as PNG
        </Button>
      </div>
      {!s.heatmap && <p className="text-[10px] text-slate-500">Compute coverage first.</p>}
    </Section>
  )
}
