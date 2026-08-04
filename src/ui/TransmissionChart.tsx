import { useMemo } from 'react'
import { unpolarisedTransmissionLossDb, solveStack, type StackLayer } from '../physics/layerStack'
import { ITU_MATERIALS, materialAt, type MaterialDefinition } from '../physics/materials'
import { evaluateWireGrid } from '../physics/wireGrid'
import type { CustomMaterial } from '../physics/materials'

/** Wi-Fi allocations relevant in Europe, GHz. Shaded behind the frequency plot. */
const BANDS: Array<{ lo: number; hi: number; label: string }> = [
  { lo: 2.4, hi: 2.4835, label: '2.4' },
  { lo: 5.15, hi: 5.35, label: 'U-NII-1/2A' },
  { lo: 5.47, hi: 5.725, label: 'U-NII-2C' },
  { lo: 5.925, hi: 6.425, label: '6 GHz (EU)' },
]

const F_MIN = 0.8
const F_MAX = 7.2
const SAMPLES = 240

function buildMaterialMap(custom: CustomMaterial[]): Map<string, MaterialDefinition> {
  const m = new Map<string, MaterialDefinition>()
  for (const x of ITU_MATERIALS) m.set(x.id, x)
  for (const x of custom) m.set(x.id, x)
  return m
}

export function TransmissionChart({
  layers,
  customMaterials,
  freqHz,
}: {
  layers: StackLayer[]
  customMaterials: CustomMaterial[]
  freqHz: number
}) {
  const materials = useMemo(() => buildMaterialMap(customMaterials), [customMaterials])

  const freqCurve = useMemo(() => {
    const pts: Array<[number, number]> = []
    for (let i = 0; i < SAMPLES; i++) {
      const f = F_MIN + ((F_MAX - F_MIN) * i) / (SAMPLES - 1)
      const loss = unpolarisedTransmissionLossDb(layers, materials, f * 1e9, 0)
      pts.push([f, Number.isFinite(loss) ? loss : 200])
    }
    return pts
  }, [layers, materials])

  const angleCurves = useMemo(() => {
    const te: Array<[number, number]> = []
    const tm: Array<[number, number]> = []
    for (let deg = 0; deg <= 88; deg += 2) {
      const rad = (deg * Math.PI) / 180
      const a = solveStack(layers, materials, freqHz, rad, 'TE').solution
      const b = solveStack(layers, materials, freqHz, rad, 'TM').solution
      te.push([deg, a.transmittance > 0 ? -10 * Math.log10(a.transmittance) : 200])
      tm.push([deg, b.transmittance > 0 ? -10 * Math.log10(b.transmittance) : 200])
    }
    return { te, tm }
  }, [layers, materials, freqHz])

  const maxLoss = Math.max(
    6,
    ...freqCurve.map((p) => Math.min(p[1], 120)),
    ...angleCurves.te.map((p) => Math.min(p[1], 120)),
    ...angleCurves.tm.map((p) => Math.min(p[1], 120)),
  )

  const W = 320
  const H = 130
  const PAD_L = 30
  const PAD_B = 18
  const PAD_T = 8

  const fx = (f: number) => PAD_L + ((f - F_MIN) / (F_MAX - F_MIN)) * (W - PAD_L - 4)
  const ax = (deg: number) => PAD_L + (deg / 90) * (W - PAD_L - 4)
  const fy = (loss: number) =>
    PAD_T + (1 - Math.min(loss, maxLoss) / maxLoss) * (H - PAD_T - PAD_B)

  const path = (pts: Array<[number, number]>, xmap: (v: number) => number) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${xmap(p[0]).toFixed(1)},${fy(p[1]).toFixed(1)}`).join(' ')

  const atFreq = unpolarisedTransmissionLossDb(layers, materials, freqHz, 0)
  const gridDiag = layers
    .filter((l) => l.grid)
    .map((l) => evaluateWireGrid(l.grid!, freqHz))
  const extrapolated = layers
    .map((l) => materials.get(l.materialId))
    .filter((m): m is MaterialDefinition => !!m)
    .filter((m) => materialAt(m, freqHz).extrapolated)

  const yTicks = [0, maxLoss / 2, maxLoss]

  return (
    <div className="space-y-2">
      <div className="rounded bg-slate-800 px-2 py-1.5 text-[11px]">
        <span className="text-slate-400">Transmission loss at {(freqHz / 1e9).toFixed(2)} GHz, normal incidence: </span>
        <span className="font-mono font-semibold text-slate-100">
          {Number.isFinite(atFreq) ? `${atFreq.toFixed(1)} dB` : '∞ (opaque)'}
        </span>
      </div>

      <figure>
        <figcaption className="mb-1 text-[10px] text-slate-500">
          Loss vs frequency (normal incidence, unpolarised)
        </figcaption>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded bg-slate-950">
          {BANDS.map((b) => (
            <rect
              key={b.label}
              x={fx(b.lo)}
              y={PAD_T}
              width={Math.max(1, fx(b.hi) - fx(b.lo))}
              height={H - PAD_T - PAD_B}
              fill="rgba(56,189,248,0.13)"
            />
          ))}
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={PAD_L} y1={fy(t)} x2={W - 4} y2={fy(t)} stroke="rgba(148,163,184,0.18)" />
              <text x={PAD_L - 3} y={fy(t) + 3} textAnchor="end" fontSize="7" fill="#64748b">
                {t.toFixed(0)}
              </text>
            </g>
          ))}
          {[1, 2, 3, 4, 5, 6, 7].map((f) => (
            <text key={f} x={fx(f)} y={H - 6} textAnchor="middle" fontSize="7" fill="#64748b">
              {f}
            </text>
          ))}
          <path d={path(freqCurve, fx)} fill="none" stroke="#38bdf8" strokeWidth="1.6" />
          <line
            x1={fx(freqHz / 1e9)}
            y1={PAD_T}
            x2={fx(freqHz / 1e9)}
            y2={H - PAD_B}
            stroke="#facc15"
            strokeWidth="1"
            strokeDasharray="2 2"
          />
          <text x={W - 6} y={H - 6} textAnchor="end" fontSize="7" fill="#64748b">
            GHz
          </text>
          <text x={4} y={PAD_T + 6} fontSize="7" fill="#64748b">
            dB
          </text>
        </svg>
      </figure>

      <figure>
        <figcaption className="mb-1 text-[10px] text-slate-500">
          Loss vs incidence angle at {(freqHz / 1e9).toFixed(2)} GHz —{' '}
          <span className="text-sky-400">TE</span> / <span className="text-rose-400">TM</span>
        </figcaption>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded bg-slate-950">
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={PAD_L} y1={fy(t)} x2={W - 4} y2={fy(t)} stroke="rgba(148,163,184,0.18)" />
              <text x={PAD_L - 3} y={fy(t) + 3} textAnchor="end" fontSize="7" fill="#64748b">
                {t.toFixed(0)}
              </text>
            </g>
          ))}
          {[0, 30, 60, 90].map((d) => (
            <text key={d} x={ax(d)} y={H - 6} textAnchor="middle" fontSize="7" fill="#64748b">
              {d}°
            </text>
          ))}
          <path d={path(angleCurves.te, ax)} fill="none" stroke="#38bdf8" strokeWidth="1.6" />
          <path d={path(angleCurves.tm, ax)} fill="none" stroke="#fb7185" strokeWidth="1.6" />
        </svg>
      </figure>

      {extrapolated.length > 0 && (
        <p className="rounded bg-amber-950/60 px-2 py-1.5 text-[10px] leading-snug text-amber-300">
          Extrapolated outside the sourced validity range:{' '}
          {extrapolated.map((m) => `${m.name} (${m.fMinGHz}–${m.fMaxGHz} GHz)`).join(', ')}. The
          curve is still computed, but treat it as an estimate.
        </p>
      )}

      {gridDiag.map((g, i) => (
        <p
          key={i}
          className={`rounded px-2 py-1.5 text-[10px] leading-snug ${
            g.validity === 'valid'
              ? 'bg-slate-800 text-slate-400'
              : g.validity === 'marginal'
                ? 'bg-amber-950/60 text-amber-300'
                : 'bg-rose-950/60 text-rose-300'
          }`}
        >
          Embedded mesh: g/λ = {g.pitchOverWavelength.toFixed(2)}, sheet shielding{' '}
          {g.sheetShieldingDb.toFixed(1)} dB. {g.validityNote || 'Quasi-static sheet model applies.'}
        </p>
      ))}
    </div>
  )
}
