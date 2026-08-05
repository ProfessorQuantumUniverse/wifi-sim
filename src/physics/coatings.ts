/**
 * Low-emissivity coating presets.
 *
 * Low-E glazing is specified by emissivity, which for a metallic film is set by
 * its sheet resistance. Those two are the same property expressed differently,
 * and the sheet resistance is what determines the RF behaviour. Values below are
 * the ranges these coating families are manufactured to; check your own glazing's
 * data sheet and override the number if you have it.
 *
 * Predicted attenuation is not fitted: a resistive sheet of R ohms per square
 * transmits t = 2 / (2 + eta_0/R), so 5 ohm/sq gives about 28 dB. That lands in
 * the 25-30 dB range reported for standard Low-E coatings between 850 MHz and
 * 3 GHz (Ranplan, "Low-E glass and 5G/4G wireless coverage"; Ding, "5G Signal
 * Penetrating Low-E Coating Technology", SVC 2021), which is the cross-check
 * that the sheet model is behaving.
 */

export interface CoatingPreset {
  id: string
  name: string
  sheetResistanceOhmPerSq: number
  note: string
}

export const COATING_PRESETS: CoatingPreset[] = [
  {
    id: 'none',
    name: 'None, uncoated float glass',
    sheetResistanceOhmPerSq: 0,
    note: 'Plain glass. Only correct for old single glazing or genuinely uncoated units.',
  },
  {
    id: 'hard-coat',
    name: 'Hard-coat (pyrolytic) Low-E: ~20 Ω/sq',
    sheetResistanceOhmPerSq: 20,
    note: 'Tin-oxide, emissivity around 0.15-0.20. The most RF-transparent Low-E family.',
  },
  {
    id: 'soft-coat-single',
    name: 'Soft-coat single-silver Low-E: ~5 Ω/sq',
    sheetResistanceOhmPerSq: 5,
    note: 'Sputtered silver, emissivity around 0.04. The common European insulating-glass coating.',
  },
  {
    id: 'soft-coat-double',
    name: 'Soft-coat double-silver / solar control: ~3 Ω/sq',
    sheetResistanceOhmPerSq: 3,
    note: 'Two silver layers, emissivity around 0.03. Strongest attenuation of the usual products.',
  },
  {
    id: 'triple-silver',
    name: 'Triple-silver solar control: ~1.5 Ω/sq',
    sheetResistanceOhmPerSq: 1.5,
    note: 'High-performance solar control. Effectively an RF screen.',
  },
]

/** Attenuation of a bare resistive sheet in free space, in dB. For the UI hint. */
export function sheetAttenuationDb(sheetResistanceOhmPerSq: number): number {
  if (sheetResistanceOhmPerSq <= 0) return 0
  const y = 376.730313412 / sheetResistanceOhmPerSq
  return 20 * Math.log10(1 + y / 2)
}
