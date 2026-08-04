import { useState } from 'react'
import { Button } from './controls'
import { Explainer } from './Workflow'
import {
  accessPointPrompt,
  clientPrompt,
  clientToPatch,
  parseAccessPointJson,
  parseClientJson,
  radioToApPatch,
  type ApplyOutcome,
  type ImportedRadio,
} from './devicePrompt'
import type { AccessPointConfig, ClientConfig } from '../engine/solver'

/**
 * Ask an AI to look the device up, paste the answer back.
 *
 * The generated brief insists on a source and a confidence label per number and
 * forbids filling gaps with typical values, so what comes back is either
 * sourced or explicitly missing. Missing fields are listed after import instead
 * of being silently defaulted.
 */
export function DeviceSpecImport({
  kind,
  domain = 'etsi',
  onApplyRadio,
  onApplyClient,
}: {
  kind: 'ap' | 'client'
  /** Passed into the brief so the assistant looks up the right regional variant. */
  domain?: 'etsi' | 'fcc'
  onApplyRadio?: (patch: Partial<AccessPointConfig>) => void
  onApplyClient?: (patch: Partial<ClientConfig>) => void
}) {
  const [open, setOpen] = useState(false)
  const [model, setModel] = useState('')
  const [pasted, setPasted] = useState('')
  const [copied, setCopied] = useState(false)
  const [status, setStatus] = useState<{
    kind: 'ok' | 'error'
    message: string
    missing: string[]
  } | null>(null)
  const [radios, setRadios] = useState<ImportedRadio[]>([])
  const [lastApplied, setLastApplied] = useState<{ index: number; outcome: ApplyOutcome } | null>(
    null,
  )

  const prompt = kind === 'ap' ? accessPointPrompt(model, domain) : clientPrompt(model)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setStatus({
        kind: 'error',
        message: 'Clipboard blocked by the browser — select the text below and copy it manually.',
        missing: [],
      })
    }
  }

  const apply = () => {
    if (kind === 'ap') {
      const result = parseAccessPointJson(pasted, domain)
      if (!result.value) {
        setStatus({ kind: 'error', message: result.error ?? 'Could not read that.', missing: [] })
        return
      }
      setRadios(result.value.radios)
      setStatus({
        kind: 'ok',
        message: `${result.value.model}: ${result.value.radios.length} radio(s) found. Pick which band to apply.`,
        missing: result.missing,
      })
    } else {
      const result = parseClientJson(pasted)
      if (!result.value) {
        setStatus({ kind: 'error', message: result.error ?? 'Could not read that.', missing: [] })
        return
      }
      onApplyClient?.(clientToPatch(result.value))
      setStatus({
        kind: 'ok',
        message: `${result.value.model} applied (confidence: ${result.value.confidence}).`,
        missing: result.missing,
      })
    }
  }

  if (!open) {
    return (
      <Button onClick={() => setOpen(true)}>
        🔎 Look up {kind === 'ap' ? 'a router / AP' : 'a client device'} with AI
      </Button>
    )
  }

  return (
    <div className="space-y-2 rounded border border-slate-700 bg-slate-950/60 p-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-200">
          Look up {kind === 'ap' ? 'a router / AP' : 'a client device'}
        </span>
        <button onClick={() => setOpen(false)} className="text-slate-500 hover:text-slate-200">
          ×
        </button>
      </div>

      <Explainer>
        Writes a research brief that asks for a source and a confidence rating per value, and — for
        access points — states the regulatory domain so you get the right regional variant. After
        importing you get an explicit list of what was taken from the reply and what was{' '}
        <b>not</b>, so nothing arrives silently.
      </Explainer>

      <label className="block">
        <span className="text-xs font-medium text-slate-300">1 · Device model</span>
        <input
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder={kind === 'ap' ? 'e.g. AVM FRITZ!Box 7590 AX' : 'e.g. iPhone 15 Pro'}
          className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100"
        />
      </label>

      <div className="flex items-center gap-1.5">
        <Button variant="primary" onClick={copy}>
          {copied ? '✓ Copied' : '2 · Copy the AI prompt'}
        </Button>
        <span className="text-[10px] text-slate-500">Paste it into any AI assistant.</span>
      </div>
      <details>
        <summary className="cursor-pointer text-[10px] text-slate-500 hover:text-slate-300">
          show the prompt
        </summary>
        <textarea
          readOnly
          value={prompt}
          rows={8}
          className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-[10px] text-slate-400"
        />
      </details>

      <label className="block">
        <span className="text-xs font-medium text-slate-300">3 · Paste the JSON it returns</span>
        <textarea
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          rows={5}
          placeholder="{ ... }"
          className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-[10px] text-slate-100"
        />
      </label>
      <Button variant="primary" onClick={apply} disabled={pasted.trim().length === 0}>
        4 · Read it
      </Button>

      {status && (
        <div
          className={`rounded px-2 py-1.5 text-[10px] leading-snug ${
            status.kind === 'ok' ? 'bg-slate-800 text-slate-300' : 'bg-rose-950/60 text-rose-300'
          }`}
        >
          {status.message}
          {status.missing.length > 0 && (
            <div className="mt-1 text-amber-400">
              Not sourced, left at the current value — set these yourself:{' '}
              {status.missing.join('; ')}.
            </div>
          )}
        </div>
      )}

      {radios.length > 0 && (
        <ul className="space-y-1">
          {radios.map((radio, i) => (
            <li key={i} className="space-y-1">
              <button
                onClick={() => {
                  const outcome = radioToApPatch(radio)
                  onApplyRadio?.(outcome.patch)
                  setLastApplied({ index: i, outcome })
                }}
                className="w-full rounded border border-slate-700 bg-slate-800 px-2 py-1 text-left text-[10px] text-slate-300 hover:bg-slate-700"
              >
                <b>Apply {radio.band} GHz</b> · {radio.generation.toUpperCase()} ·{' '}
                {radio.maxChannelWidthMHz} MHz · {radio.spatialStreams ?? '?'} streams ·{' '}
                {radio.conductedPowerDbm !== null
                  ? `${radio.conductedPowerDbm} dBm conducted`
                  : radio.eirpDbm !== null
                    ? `${radio.eirpDbm} dBm EIRP`
                    : 'power unknown'}
                {radio.antenna ? ` · ${radio.antenna.kind}` : ''}
                <span className="block text-slate-500">
                  {radio.confidence} — {radio.source || 'no source given'}
                </span>
              </button>

              {radio.warnings.length > 0 && (
                <ul className="space-y-0.5">
                  {radio.warnings.map((w, k) => (
                    <li
                      key={k}
                      className="rounded bg-amber-950/50 px-2 py-1 text-[10px] leading-snug text-amber-300"
                    >
                      ⚠ {w}
                    </li>
                  ))}
                </ul>
              )}

              {lastApplied?.index === i && (
                <div className="space-y-1 rounded border border-slate-700 bg-slate-950/70 px-2 py-1.5 text-[10px] leading-snug">
                  <div className="text-emerald-400">
                    <b>Taken from the reply:</b> {lastApplied.outcome.applied.join(', ')}.
                  </div>
                  {lastApplied.outcome.skipped.length > 0 && (
                    <div className="text-amber-400">
                      <b>Not in the reply — still your own values, check them:</b>{' '}
                      {lastApplied.outcome.skipped.join(', ')}.
                    </div>
                  )}
                  {lastApplied.outcome.notes.map((n, k) => (
                    <div key={k} className="text-slate-400">
                      {n}
                    </div>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
