/**
 * Generates a research brief you can paste into any AI assistant, and parses
 * the JSON it hands back.
 *
 * The brief asks for a source and a confidence rating per figure, and states
 * which regulatory domain the device is being modelled in so the right regional
 * variant gets looked up. It deliberately does NOT insist that everything
 * unpublished comes back as null — that produced replies that were almost
 * entirely null and therefore useless. A well-established figure for the device
 * class, labelled as such, is far more informative.
 *
 * The importer compensates by being sceptical instead: it reconciles conducted
 * power against EIRP and the domain's legal ceiling, maps whatever antenna
 * wording the assistant used onto the four supported patterns, and reports
 * field by field what it took and what it left alone.
 */

import type { AccessPointConfig, ClientConfig } from '../engine/solver'
import type { AntennaSpec } from '../physics/antenna'
import { orientAntenna } from '../physics/antenna'
import type { Band, ChannelWidthMHz, Generation } from '../engine/linkBudget'

export function accessPointPrompt(model: string, domain: 'etsi' | 'fcc' = 'etsi'): string {
  const name = model.trim() || '<put the exact model name here>'
  const region = domain === 'etsi' ? 'the EU / ETSI' : 'the US / FCC'
  return `I need the radio and antenna specifications of this Wi-Fi access point / router, for a physically-based coverage simulation. I am modelling it in ${region} regulatory domain.

  DEVICE: ${name}

Research it and return ONE JSON object, nothing else, in this shape:

{
  "model": "manufacturer and exact model as you verified it",
  "radios": [
    {
      "band": "2.4" | "5" | "6",
      "generation": "ht" | "vht" | "he" | "eht",
      "maxChannelWidthMHz": 20 | 40 | 80 | 160 | 320,
      "spatialStreams": <integer, transmit chains on this band>,
      "conductedPowerDbm": <power at the antenna connector, dBm — this EXCLUDES antenna gain>,
      "eirpDbm": <total radiated power, dBm — this INCLUDES antenna gain>,
      "antennaGainDbi": <peak gain of one antenna, dBi>,
      "antenna": {
        "kind": "dipole" | "collinear" | "sector" | "isotropic",
        "elements": <if collinear/stacked: how many elements, else null>,
        "hBeamwidthDeg": <if directional, else null>,
        "vBeamwidthDeg": <if directional, else null>,
        "internal": <true if the antennas are inside the housing>,
        "description": "free text: what the antennas physically are and how they are arranged"
      },
      "confidence": "datasheet" | "regulatory-filing" | "review-measurement" | "typical-for-class",
      "source": "where these numbers came from: URL, FCC ID, CE/ETSI test report, datasheet page"
    }
  ],
  "notes": "anything important: beamforming, per-band differences, regional power variants, antenna arrangement"
}

How to handle each field:

TRANSMIT POWER — this is the field people get wrong most often, so please be careful:
- "conductedPowerDbm" and "eirpDbm" differ by the antenna gain: eirp = conducted + antennaGainDbi.
- Fill in whichever you actually found, and set the other to null. Do NOT put the same number in both, and do not put an EIRP figure in the conducted field.
- Most consumer routers only publish EIRP, and often only in a regulatory filing. That is fine — fill "eirpDbm" and leave "conductedPowerDbm" null.
- ${
    domain === 'etsi'
      ? 'In the EU the legal ceiling is 20 dBm EIRP on 2.4 GHz, 23 dBm EIRP on 5.15-5.35 GHz and on 6 GHz indoor, and 30 dBm EIRP on 5.47-5.725 GHz. A device sold in the EU cannot exceed these, so if your figure is above the ceiling for that band you have almost certainly found a US figure or a conducted/EIRP mix-up — say so in "notes".'
      : 'In the US the ceiling is 36 dBm EIRP on 2.4 GHz and 30 dBm EIRP on most 5 GHz sub-bands.'
  }

ANTENNA KIND — pick the closest of the four, and put the real description in "description":
- "dipole" — a single whip, a PIFA, or any simple internal element. This is the right answer for most home routers.
- "collinear" — a taller external antenna that stacks several elements to squeeze the pattern towards the horizon (typical of "high gain" 5-9 dBi whips). Set "elements".
- "sector" — a genuinely directional panel or patch. Set the beamwidths.
- "isotropic" — only if you truly have no information.

EVERYTHING ELSE:
- Give your best sourced answer. If a number is not published but is well established for this class of device, use it and set "confidence": "typical-for-class" — say in "source" what you based it on. That is far more useful to me than null.
- Use null only when you genuinely have nothing to go on, not merely when the manufacturer does not publish it.
- One entry in "radios" per band the device supports.
- Prefer the ${domain === 'etsi' ? 'EU' : 'US'} variant, and note it if you used another region's data.
- Consumer antenna gain claims are often marketing-inflated. If the only figure is a marketing claim, say so in "source" and use "typical-for-class".`
}

export function clientPrompt(model: string): string {
  const name = model.trim() || '<put the exact device name here>'
  return `I need the Wi-Fi receiver characteristics of this client device, for a physically-based coverage simulation:

  DEVICE: ${name}

Please research it and return ONE JSON object, nothing else, in exactly this shape:

{
  "model": "manufacturer and exact model as you verified it",
  "generation": "ht" | "vht" | "he" | "eht",
  "maxChannelWidthMHz": 20 | 40 | 80 | 160 | 320,
  "antennaCount": <receive chains, integer, or null>,
  "peakGainDbi": <antenna gain, dBi, or null>,
  "noiseFigureDb": <receiver noise figure, dB, or null>,
  "sensitivityDbm": { "mcs0_20MHz": <number or null>, "mcs7_20MHz": <number or null> },
  "bodyLossDb": <typical hand/body absorption for how this device is held, or null>,
  "confidence": "datasheet" | "regulatory-filing" | "chipset-datasheet" | "review-measurement" | "estimated",
  "source": "where these came from: URL, chipset part number and its datasheet, FCC ID, teardown",
  "notes": "anything important, e.g. which Wi-Fi chipset it uses"
}

Rules that matter to me:
- Use null for anything you cannot source. Do not substitute a typical value.
- Phone and laptop makers rarely publish this. Identifying the Wi-Fi chipset (from a teardown or a regulatory filing) and quoting ITS datasheet is usually the best available route — if you do that, say so in "source" and use confidence "chipset-datasheet".
- Body loss is device-dependent (a phone held to the head, a laptop on a desk). Say which posture your number assumes in "notes".`
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

/**
 * Assistants rarely use the exact four keywords, so map what they do say.
 * Anything unmatched is reported rather than silently coerced — an unrecognised
 * kind quietly becoming "dipole" is why a collinear antenna could look as
 * though it had been ignored.
 *
 * Order matters. Collinear is checked first so "dipole array" lands there
 * rather than on the plain dipole rule, and "directional" carries word
 * boundaries so that "omnidirectional" is not read as a directional antenna.
 */
const KIND_SYNONYMS: Array<{ match: RegExp; kind: AntennaSpec['kind'] }> = [
  { match: /collinear|co-linear|colinear|stacked|array|high[- ]?gain|franklin/i, kind: 'collinear' },
  // "omni" must be tested before the directional rule: both "omnidirectional"
  // and "omni-directional" contain "directional", and the hyphenated form even
  // puts a word boundary in front of it.
  { match: /\bomni/i, kind: 'dipole' },
  { match: /\bsector\b|\bpatch\b|\bpanel\b|\bdirectional\b|\byagi\b|\bhorn\b|\bbeam\b/i, kind: 'sector' },
  { match: /dipole|whip|monopole|pifa|\bifa\b|internal|printed|blade|puck/i, kind: 'dipole' },
  { match: /isotropic|unknown|reference/i, kind: 'isotropic' },
]

export function normaliseAntennaKind(
  raw: unknown,
  description?: unknown,
): { kind: AntennaSpec['kind']; matched: boolean; raw: string } {
  const text = `${String(raw ?? '')} ${String(description ?? '')}`.trim()
  const exact = String(raw ?? '').toLowerCase().trim()
  if (['dipole', 'collinear', 'sector', 'isotropic'].includes(exact)) {
    return { kind: exact as AntennaSpec['kind'], matched: true, raw: exact }
  }
  for (const { match, kind } of KIND_SYNONYMS) {
    if (match.test(text)) return { kind, matched: true, raw: String(raw ?? '') }
  }
  return { kind: 'dipole', matched: false, raw: String(raw ?? '(none given)') }
}

export interface ImportedRadio {
  band: Band
  generation: Generation
  maxChannelWidthMHz: ChannelWidthMHz
  spatialStreams: number | null
  conductedPowerDbm: number | null
  eirpDbm: number | null
  antennaGainDbi: number | null
  antenna: {
    kind: AntennaSpec['kind']
    kindMatched: boolean
    rawKind: string
    elements: number | null
    hBeamwidthDeg: number | null
    vBeamwidthDeg: number | null
    internal?: boolean
    description?: string
  } | null
  confidence: string
  source: string
  /** Per-field notes surfaced in the UI: what was missing, coerced or suspect. */
  warnings: string[]
}

export interface ImportedAccessPoint {
  model: string
  radios: ImportedRadio[]
  notes?: string
}

export interface ImportOutcome<T> {
  value: T | null
  /** Fields the assistant returned as null, so the UI can ask about them. */
  missing: string[]
  error: string | null
}

/** Strips ``` fences and any prose around the JSON object. */
function extractJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '')
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('No JSON object found in the pasted text.')
  return JSON.parse(trimmed.slice(start, end + 1))
}

const asNumber = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  // Assistants often return "23 dBm" or "5.5" as a string.
  if (typeof v === 'string') {
    const parsed = Number.parseFloat(v.replace(',', '.'))
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

/**
 * EIRP ceiling per band and domain, used to catch a reply that has put an EIRP
 * figure in the conducted field. Checking against the domain actually in use
 * matters: 23 dBm conducted plus a 2.2 dBi antenna is a perfectly ordinary US
 * 2.4 GHz radio, and an impossible European one.
 */
const REGULATORY_CEILING_DBM: Record<'etsi' | 'fcc', Record<string, number>> = {
  etsi: { '2.4': 20, '5': 30, '6': 23 },
  fcc: { '2.4': 36, '5': 36, '6': 30 },
}

export function parseAccessPointJson(
  text: string,
  domain: 'etsi' | 'fcc' = 'etsi',
): ImportOutcome<ImportedAccessPoint> {
  try {
    const raw = extractJson(text) as Record<string, unknown>
    const radiosRaw = Array.isArray(raw.radios) ? raw.radios : []
    if (radiosRaw.length === 0) throw new Error('The JSON contains no "radios" entries.')

    const missing: string[] = []
    const radios: ImportedRadio[] = radiosRaw.map((r, i) => {
      const radio = r as Record<string, unknown>
      const antennaRaw = radio.antenna as Record<string, unknown> | null | undefined
      const band = (['2.4', '5', '6'].includes(String(radio.band))
        ? String(radio.band)
        : '5') as Band
      const label = `radio ${i + 1} (${band} GHz)`
      const warnings: string[] = []

      let conducted = asNumber(radio.conductedPowerDbm)
      let eirp = asNumber(radio.eirpDbm)
      // Gain may be given at the top level or nested under the antenna.
      const gain =
        asNumber(radio.antennaGainDbi) ?? (antennaRaw ? asNumber(antennaRaw.peakGainDbi) : null)

      if (conducted === null && eirp === null) missing.push(`${label}: transmit power`)
      const streams = asNumber(radio.spatialStreams)
      if (streams === null) missing.push(`${label}: spatial streams`)
      if (gain === null) missing.push(`${label}: antenna gain`)

      // The classic failure: the assistant reports the same number as both, or
      // puts an EIRP figure in the conducted field. Either way the derived EIRP
      // ends up gain-dB too high and then trips the regulatory check.
      if (conducted !== null && eirp !== null && gain !== null) {
        const implied = conducted + gain
        if (Math.abs(implied - eirp) > 1.5) {
          warnings.push(
            `Inconsistent power: ${conducted} dBm conducted + ${gain} dBi = ${implied.toFixed(1)} dBm, but EIRP was given as ${eirp} dBm. Using the EIRP figure and deriving conducted from it.`,
          )
          conducted = null
        }
      } else if (conducted !== null && eirp === null && gain !== null) {
        const ceiling = REGULATORY_CEILING_DBM[domain][band]
        if (conducted + gain > ceiling + 3) {
          warnings.push(
            `${conducted} dBm conducted + ${gain} dBi = ${(conducted + gain).toFixed(1)} dBm EIRP, above the ${ceiling} dBm ${domain.toUpperCase()} ceiling for ${band} GHz. That figure was most likely already an EIRP (or a US-market value), so it is being treated as an EIRP.`,
          )
          eirp = conducted
          conducted = null
        }
      }

      const kindInfo = antennaRaw
        ? normaliseAntennaKind(antennaRaw.kind, antennaRaw.description)
        : null
      if (kindInfo && !kindInfo.matched) {
        warnings.push(
          `Antenna type "${kindInfo.raw}" was not recognised; falling back to a half-wave dipole. Set it yourself if that is wrong.`,
        )
      }
      if (kindInfo?.kind === 'collinear' && asNumber(antennaRaw?.elements) === null) {
        warnings.push(
          'Collinear antenna with no element count given — assuming 2 elements. Adjust it if you know better.',
        )
      }

      return {
        band,
        generation: (['ht', 'vht', 'he', 'eht'].includes(String(radio.generation))
          ? String(radio.generation)
          : 'he') as Generation,
        maxChannelWidthMHz: (asNumber(radio.maxChannelWidthMHz) ?? 80) as ChannelWidthMHz,
        spatialStreams: streams,
        conductedPowerDbm: conducted,
        eirpDbm: eirp,
        antennaGainDbi: gain,
        antenna: antennaRaw
          ? {
              kind: kindInfo!.kind,
              kindMatched: kindInfo!.matched,
              rawKind: kindInfo!.raw,
              elements: asNumber(antennaRaw.elements),
              hBeamwidthDeg: asNumber(antennaRaw.hBeamwidthDeg),
              vBeamwidthDeg: asNumber(antennaRaw.vBeamwidthDeg),
              internal: Boolean(antennaRaw.internal),
              description: String(antennaRaw.description ?? ''),
            }
          : null,
        confidence: String(radio.confidence ?? 'unstated'),
        source: String(radio.source ?? ''),
        warnings,
      }
    })

    return {
      value: { model: String(raw.model ?? 'Imported device'), radios, notes: String(raw.notes ?? '') },
      missing,
      error: null,
    }
  } catch (e) {
    return { value: null, missing: [], error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Turn one imported radio into an AP patch.
 *
 * Where only EIRP is known, the conducted power is derived as EIRP minus the
 * antenna gain — an identity, not an assumption, provided both figures describe
 * the same radio. Nulls are simply left out so the existing value stays and the
 * UI can flag it.
 */
export interface ApplyOutcome {
  patch: Partial<AccessPointConfig>
  /** Field-by-field record of what was taken from the reply and what was not. */
  applied: string[]
  skipped: string[]
  notes: string[]
}

/**
 * Turn one imported radio into an AP patch, and say exactly which fields moved.
 *
 * Where only EIRP is known, the conducted power is derived as EIRP minus the
 * antenna gain — an identity, not an assumption. Fields the reply did not carry
 * are simply left out so the existing value stands, and they are listed in
 * `skipped` so the UI can name them.
 */
export function radioToApPatch(radio: ImportedRadio): ApplyOutcome {
  const patch: Partial<AccessPointConfig> = {
    band: radio.band,
    generation: radio.generation,
    widthMHz: radio.maxChannelWidthMHz,
  }
  const applied = ['band', 'Wi-Fi generation', 'channel width']
  const skipped: string[] = []
  const notes = [...radio.warnings]

  if (radio.spatialStreams !== null) {
    patch.spatialStreams = Math.round(radio.spatialStreams)
    applied.push('spatial streams')
  } else {
    skipped.push('spatial streams')
  }

  const gain = radio.antennaGainDbi
  if (radio.conductedPowerDbm !== null) {
    patch.conductedPowerDbm = radio.conductedPowerDbm
    applied.push('conducted power')
  } else if (radio.eirpDbm !== null && gain !== null) {
    patch.conductedPowerDbm = radio.eirpDbm - gain
    applied.push('conducted power')
    notes.push(
      `Conducted power derived from EIRP: ${radio.eirpDbm} dBm − ${gain} dBi = ${(radio.eirpDbm - gain).toFixed(1)} dBm.`,
    )
  } else if (radio.eirpDbm !== null) {
    skipped.push('transmit power (EIRP known but antenna gain is not, so it cannot be split)')
  } else {
    skipped.push('transmit power')
  }

  if (radio.antenna) {
    // Keep the antenna upright by default; mounting presets adjust it later.
    const orientation = orientAntenna(0, 90)
    const spec: AntennaSpec = {
      kind: radio.antenna.kind,
      boresight: orientation.boresight,
      reference: orientation.reference,
    }
    applied.push(`antenna type (${radio.antenna.kind})`)

    if (radio.antenna.kind === 'collinear') {
      // Always set the element count — leaving it undefined silently fell back
      // to 2 and made the import look like it had been ignored.
      spec.elements = radio.antenna.elements !== null ? Math.round(radio.antenna.elements) : 2
      spec.spacingLambda = 0.8
      applied.push(`collinear elements (${spec.elements})`)
      if (radio.antenna.elements === null) skipped.push('collinear element count (assumed 2)')
    }
    if (radio.antenna.kind === 'sector') {
      if (gain !== null) {
        spec.peakGainDbi = gain
        applied.push('sector peak gain')
      } else {
        skipped.push('sector peak gain')
      }
      if (radio.antenna.hBeamwidthDeg !== null) {
        spec.hBeamwidthDeg = radio.antenna.hBeamwidthDeg
        applied.push('horizontal beamwidth')
      } else {
        skipped.push('horizontal beamwidth')
      }
      if (radio.antenna.vBeamwidthDeg !== null) {
        spec.vBeamwidthDeg = radio.antenna.vBeamwidthDeg
        applied.push('vertical beamwidth')
      } else {
        skipped.push('vertical beamwidth')
      }
    }
    if ((radio.antenna.kind === 'dipole' || radio.antenna.kind === 'collinear') && gain !== null) {
      // The dipole and collinear patterns are physical: their gain follows from
      // the element count, it is not a free parameter. A quoted gain that
      // disagrees is worth surfacing rather than silently discarding.
      notes.push(
        `Reported antenna gain ${gain} dBi is not applied directly — for a ${radio.antenna.kind} the gain follows from the pattern itself. The panel shows the resulting figure; if it disagrees with ${gain} dBi, adjust the element count.`,
      )
    }
    patch.antenna = spec
  } else {
    skipped.push('antenna type')
  }

  return { patch, applied, skipped, notes }
}

export interface ImportedClient {
  model: string
  generation: Generation
  antennaCount: number | null
  noiseFigureDb: number | null
  bodyLossDb: number | null
  peakGainDbi: number | null
  confidence: string
  source: string
  notes?: string
}

export function parseClientJson(text: string): ImportOutcome<ImportedClient> {
  try {
    const raw = extractJson(text) as Record<string, unknown>
    const missing: string[] = []
    const antennaCount = asNumber(raw.antennaCount)
    if (antennaCount === null) missing.push('receive chains')
    const noiseFigure = asNumber(raw.noiseFigureDb)
    if (noiseFigure === null) missing.push('noise figure')
    const bodyLoss = asNumber(raw.bodyLossDb)
    if (bodyLoss === null) missing.push('body loss')

    return {
      value: {
        model: String(raw.model ?? 'Imported device'),
        generation: (['ht', 'vht', 'he', 'eht'].includes(String(raw.generation))
          ? String(raw.generation)
          : 'he') as Generation,
        antennaCount,
        noiseFigureDb: noiseFigure,
        bodyLossDb: bodyLoss,
        peakGainDbi: asNumber(raw.peakGainDbi),
        confidence: String(raw.confidence ?? 'estimated'),
        source: String(raw.source ?? ''),
        notes: String(raw.notes ?? ''),
      },
      missing,
      error: null,
    }
  } catch (e) {
    return { value: null, missing: [], error: e instanceof Error ? e.message : String(e) }
  }
}

export function clientToPatch(imported: ImportedClient): Partial<ClientConfig> {
  const patch: Partial<ClientConfig> = {}
  if (imported.antennaCount !== null) patch.antennaCount = Math.round(imported.antennaCount)
  if (imported.noiseFigureDb !== null) patch.noiseFigureDb = imported.noiseFigureDb
  if (imported.bodyLossDb !== null) patch.bodyLossDb = imported.bodyLossDb
  return patch
}
