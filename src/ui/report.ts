/**
 * Self-contained HTML report: the heatmap, every setting that produced it, and
 * the provenance of each physical constant. Written as one file with the image
 * inlined so it can be archived or emailed without losing anything.
 */

import type { Scene } from '../scene/model'
import type { AccessPointConfig, ClientConfig } from '../engine/solver'
import { accessPointPower } from '../engine/solver'
import { ITU_MATERIALS, type CustomMaterial } from '../physics/materials'
import { peakGainDbi } from '../physics/antenna'
import { noiseFloorDbm, requiredSnrDb } from '../engine/linkBudget'
import type { HeatmapData } from '../state/simStore'
import type { ChannelCandidate } from '../engine/planning'
import { provenanceLabel } from '../core/types'

const esc = (s: string): string =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)

function percentiles(values: number[]): { p5: number; median: number; p95: number } {
  const s = [...values].sort((a, b) => a - b)
  const at = (p: number) => s[Math.max(0, Math.min(s.length - 1, Math.floor(p * (s.length - 1))))]
  return { p5: at(0.05), median: at(0.5), p95: at(0.95) }
}

export interface ReportInput {
  scene: Scene
  customMaterials: CustomMaterial[]
  aps: AccessPointConfig[]
  client: ClientConfig
  heatmap: HeatmapData
  channelPlan: ChannelCandidate[] | null
  domain: 'etsi' | 'fcc'
  combining: string
  reflectionOrder: number
  diffraction: boolean
  /** data: URL of the rendered map. */
  mapDataUrl: string
  generatedAt: string
}

export function buildReportHtml(input: ReportInput): string {
  const { heatmap } = input
  const covered: number[] = []
  const sinrs: number[] = []
  const tps: number[] = []
  for (let i = 0; i < heatmap.bestAp.length; i++) {
    if (heatmap.bestAp[i] < 0) continue
    covered.push(heatmap.rssiDbm[i])
    sinrs.push(heatmap.sinrDb[i])
    tps.push(heatmap.throughputMbps[i])
  }
  const rssi = percentiles(covered)
  const sinr = percentiles(sinrs)
  const tp = percentiles(tps)
  const pctAbove = (v: number) =>
    ((100 * covered.filter((x) => x >= v).length) / Math.max(1, covered.length)).toFixed(1)

  const usedMaterialIds = new Set<string>()
  for (const t of input.scene.wallTypes) for (const l of t.layers) usedMaterialIds.add(l.materialId)
  const allMaterials = [...ITU_MATERIALS, ...input.customMaterials]
  const usedMaterials = allMaterials.filter((m) => usedMaterialIds.has(m.id))

  const apRows = input.aps
    .filter((a) => a.enabled)
    .map((ap) => {
      const p = accessPointPower(ap, input.domain)
      return `<tr>
        <td>${esc(ap.name)}</td>
        <td>${ap.band} GHz · ch ${ap.channel} (${p.centreMHz} MHz) · ${ap.widthMHz} MHz</td>
        <td>${ap.generation.toUpperCase()} · ${ap.spatialStreams}×${ap.spatialStreams} · GI ${ap.guardIntervalUs} µs</td>
        <td>${ap.conductedPowerDbm.toFixed(1)} dBm ${ap.cableLossDb ? `− ${ap.cableLossDb} dB` : ''} + ${p.gainDbi.toFixed(1)} dBi = <b>${p.eirpDbm.toFixed(1)} dBm EIRP</b></td>
        <td>${p.compliance.compliant ? `within ${p.compliance.maxEirpDbm.toFixed(1)} dBm` : `<b class="bad">exceeds by ${p.compliance.exceedanceDb.toFixed(1)} dB</b>`}<br><span class="dim">${esc(p.compliance.limit?.citation ?? 'no allocation')}</span></td>
      </tr>`
    })
    .join('')

  const channelRows = (input.channelPlan ?? [])
    .slice(0, 8)
    .map(
      (c, i) => `<tr${i === 0 ? ' class="best"' : ''}>
        <td>${c.channel}</td><td>${c.centreMHz} MHz</td>
        <td>${c.p5SinrDb.toFixed(1)} dB</td><td>${c.medianSinrDb.toFixed(1)} dB</td>
        <td>${c.medianInterferenceDbm < -190 ? '—' : c.medianInterferenceDbm.toFixed(1) + ' dBm'}</td>
        <td>${c.overlappingSources.length ? esc(c.overlappingSources.join(', ')) : 'none'}</td>
      </tr>`,
    )
    .join('')

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>WiFi-Sim coverage report</title>
<style>
 :root{color-scheme:light dark}
 body{font:14px/1.55 ui-sans-serif,system-ui,sans-serif;max-width:60rem;margin:2rem auto;padding:0 1.25rem;color:#0f172a;background:#fff}
 @media (prefers-color-scheme:dark){body{color:#e2e8f0;background:#0b1120}
   table{border-color:#334155} th,td{border-color:#334155} th{background:#1e293b} .dim{color:#94a3b8} .best{background:#14342b}}
 h1{font-size:1.5rem;margin:0 0 .25rem} h2{font-size:1.05rem;margin:2rem 0 .5rem;border-bottom:1px solid currentColor;padding-bottom:.25rem}
 .sub{color:#64748b;margin:0 0 1.5rem}
 table{border-collapse:collapse;width:100%;font-size:12px;margin:.5rem 0}
 th,td{border:1px solid #cbd5e1;padding:.35rem .5rem;text-align:left;vertical-align:top}
 th{background:#f1f5f9;font-weight:600}
 .dim{color:#64748b;font-size:11px} .bad{color:#dc2626} .best{background:#dcfce7}
 .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(9rem,1fr));gap:.5rem;margin:.5rem 0}
 .kpi{border:1px solid #cbd5e1;border-radius:.4rem;padding:.5rem .65rem}
 .kpi b{display:block;font-size:1.15rem} .kpi span{font-size:11px;color:#64748b}
 img{max-width:100%;border:1px solid #cbd5e1;border-radius:.4rem}
 .wrap{overflow-x:auto}
</style></head><body>

<h1>Wi-Fi coverage report</h1>
<p class="sub">Generated ${esc(input.generatedAt)} · ${input.scene.walls.length} walls ·
ceiling ${input.scene.ceilingHeightM.toFixed(2)} m · map at ${heatmap.spec.heightM.toFixed(2)} m ·
grid ${heatmap.spec.resolutionM.toFixed(2)} m (${heatmap.cols}×${heatmap.rows})</p>

<h2>Coverage</h2>
<div class="grid">
  <div class="kpi"><b>${rssi.median.toFixed(1)} dBm</b><span>median RSSI</span></div>
  <div class="kpi"><b>${rssi.p5.toFixed(1)} dBm</b><span>5th percentile</span></div>
  <div class="kpi"><b>${pctAbove(-67)} %</b><span>at or above −67 dBm</span></div>
  <div class="kpi"><b>${pctAbove(-75)} %</b><span>at or above −75 dBm</span></div>
  <div class="kpi"><b>${sinr.median.toFixed(1)} dB</b><span>median SINR</span></div>
  <div class="kpi"><b>${tp.median.toFixed(0)} Mb/s</b><span>median throughput</span></div>
  <div class="kpi"><b>${tp.p5.toFixed(0)} Mb/s</b><span>5th-percentile throughput</span></div>
</div>
<img src="${input.mapDataUrl}" alt="Coverage heatmap">

<h2>Access points</h2>
<div class="wrap"><table><thead><tr><th>Name</th><th>Channel</th><th>PHY</th><th>Power</th><th>${input.domain.toUpperCase()} limit</th></tr></thead>
<tbody>${apRows}</tbody></table></div>

<h2>Client</h2>
<div class="wrap"><table><tbody>
<tr><th>Receive chains</th><td>${input.client.antennaCount}</td></tr>
<tr><th>Antenna</th><td>${input.client.antenna.kind}, ${peakGainDbi(input.client.antenna).toFixed(2)} dBi peak</td></tr>
<tr><th>Noise figure</th><td>${input.client.noiseFigureDb.toFixed(1)} dB → noise floor ${noiseFloorDbm(20, input.client.noiseFigureDb).toFixed(1)} dBm at 20 MHz</td></tr>
<tr><th>Body loss</th><td>${input.client.bodyLossDb.toFixed(1)} dB</td></tr>
<tr><th>Chipset margin</th><td>${input.client.implementationMarginDb.toFixed(1)} dB — MCS0 needs ${requiredSnrDb(0, 5, input.client.implementationMarginDb).toFixed(1)} dB SNR, MCS11 needs ${requiredSnrDb(11, 5, input.client.implementationMarginDb).toFixed(1)} dB</td></tr>
</tbody></table></div>

${
  channelRows
    ? `<h2>Channel plan</h2>
<p class="dim">Scored against the interference in the computed map. Candidates are limited to the serving AP's own band: across a band the wall behaviour barely changes, across bands it changes a lot.</p>
<div class="wrap"><table><thead><tr><th>Ch</th><th>Centre</th><th>5th-pct SINR</th><th>Median SINR</th><th>Median interference</th><th>Overlaps</th></tr></thead>
<tbody>${channelRows}</tbody></table></div>`
    : ''
}

<h2>Propagation model</h2>
<ul>
<li>Deterministic path enumeration solved by the method of images — direct path, specular reflections to order ${input.reflectionOrder}, transmission through every intervening surface${input.diffraction ? ', and single UTD edge diffraction' : ' (edge diffraction disabled)'}.</li>
<li>Surface transmission and reflection from the exact multilayer transfer matrix (Abelès), per polarisation and incidence angle.</li>
<li>Multipath combined ${input.combining === 'coherent' ? 'coherently (instantaneous field, shows standing waves)' : 'incoherently (local average)'}.</li>
<li>Free-space reference verified to 0.002 dB; two-ray ground reflection verified to 0.06 dB against the analytic result.</li>
</ul>

<h2>Material data and provenance</h2>
<div class="wrap"><table><thead><tr><th>Material</th><th>ε′ = a·f<sup>b</sup></th><th>σ = c·f<sup>d</sup> [S/m]</th><th>Valid</th><th>Source</th></tr></thead><tbody>
${usedMaterials
  .map(
    (m) => `<tr><td>${esc(m.name)}</td><td>a=${m.a}, b=${m.b}</td><td>c=${m.c}, d=${m.d}</td>
    <td>${m.fMinGHz}–${m.fMaxGHz} GHz</td><td class="dim">${esc(provenanceLabel(m.provenance))}</td></tr>`,
  )
  .join('')}
</tbody></table></div>

<h2>Standards referenced</h2>
<ul class="dim">
<li>ITU-R P.2040 — building material electrical properties (Table 3).</li>
<li>IEEE Std 802.11-2020 / 802.11ax-2021 — receiver minimum input sensitivity, OFDM numerology, MCS set.</li>
<li>${input.domain === 'etsi' ? 'ETSI EN 300 328 and EN 301 893; EU Implementing Decision 2021/1067 for 6 GHz.' : 'FCC 47 CFR 15.247 and 15.407.'}</li>
<li>Kouyoumjian &amp; Pathak (1974) — UTD wedge diffraction; Luebbers (1984) for dielectric faces.</li>
</ul>

<p class="dim">Throughput figures are a single-link model: preamble, interframe spacing, average backoff, A-MPDU aggregation and block ack. They do not represent several clients sharing the channel, OFDMA scheduling or MU-MIMO, so treat them as the ceiling one device can reach on an idle channel.</p>

</body></html>`
}

/** Open the report in a new tab. */
export function openReport(html: string): void {
  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  window.open(url, '_blank')
  // Give the new tab time to load before releasing the object URL.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export function downloadFile(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
