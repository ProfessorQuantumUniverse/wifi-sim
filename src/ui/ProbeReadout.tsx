import { useSimStore } from '../state/simStore'
import { MCS_TABLE } from '../engine/linkBudget'

/**
 * Floating breakdown for the probed point. Shows not just the numbers but the
 * paths that produced them, so a surprising result can be traced back to the
 * wall or reflection responsible.
 */
export function ProbeReadout() {
  const probe = useSimStore((s) => s.probe)
  const aps = useSimStore((s) => s.aps)
  const setProbe = useSimStore((s) => s.setProbe)
  if (!probe) return null

  const entry = probe.mcs >= 0 ? MCS_TABLE[probe.mcs] : null
  const ap = aps[probe.apIndex]

  return (
    <div className="absolute top-3 left-3 max-h-[calc(100%-1.5rem)] w-80 overflow-y-auto rounded-lg border border-slate-700 bg-slate-900/95 p-3 shadow-xl backdrop-blur">
      <div className="mb-2 flex items-start justify-between">
        <div>
          <h3 className="text-xs font-semibold text-slate-100">
            Probe · {probe.point.x.toFixed(2)}, {probe.point.y.toFixed(2)} m @{' '}
            {probe.point.z.toFixed(2)} m
          </h3>
          <p className="text-[10px] text-slate-500">
            Served by {ap?.name ?? '-'}
            {ap ? ` · ${ap.band} GHz ch ${ap.channel} · ${ap.widthMHz} MHz` : ''}
          </p>
        </div>
        <button onClick={() => setProbe(null)} className="text-slate-500 hover:text-slate-200">
          ×
        </button>
      </div>

      <dl className="mb-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <Row label="RSSI" value={`${probe.rssiDbm.toFixed(1)} dBm`} />
        <Row label="Noise" value={`${probe.noiseDbm.toFixed(1)} dBm`} />
        <Row label="SINR" value={`${probe.sinrDb.toFixed(1)} dB`} />
        <Row
          label="MCS"
          value={entry ? `${probe.mcs} · ${entry.modulation}` : 'no link'}
        />
        <Row label="PHY rate" value={`${probe.phyRateMbps.toFixed(0)} Mb/s`} />
        <Row
          label="Throughput"
          value={`${probe.throughputMbps.toFixed(0)} Mb/s`}
        />
        <Row label="MAC efficiency" value={`${(probe.efficiency * 100).toFixed(0)} %`} />
        <Row label="Paths" value={String(probe.paths.length)} />
      </dl>

      <p className="mb-1 text-[10px] font-medium text-slate-400">
        Dominant paths (drawn on the plan)
      </p>
      <ul className="space-y-1">
        {probe.paths.slice(0, 8).map((p, i) => (
          <li key={i} className="rounded bg-slate-950/70 px-2 py-1 text-[10px]">
            <div className="flex justify-between font-mono text-slate-300">
              <span>
                {p.reflections}R · {p.transmissions}T · {p.diffractions}D
              </span>
              <span>
                {(10 * Math.log10(p.gain)).toFixed(1)} dB · {p.lengthM.toFixed(2)} m
              </span>
            </div>
            {p.interactions.length > 0 && (
              <div className="mt-0.5 text-slate-500">
                {p.interactions
                  .map(
                    (it) =>
                      `${it.kind[0].toUpperCase()}:${it.role}@${it.incidenceDeg.toFixed(0)}°`,
                  )
                  .join(' → ')}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-mono text-slate-200">{value}</dd>
    </>
  )
}
