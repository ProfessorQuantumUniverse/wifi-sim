/**
 * Conductive wire grids embedded in a construction: reinforcement mesh in a
 * concrete wall or slab, and the metallic mesh in some safety/RF glazing.
 *
 * A grid whose period is small compared with the wavelength acts as a shunt
 * inductive sheet. For an inductive strip grating of period g and strip width w
 * the normalised shunt reactance is (Marcuvitz, "Waveguide Handbook", 1951,
 * sec. 5.1; equivalently Casey, "Electromagnetic shielding behavior of wire-mesh
 * screens", IEEE Trans. EMC 30(3), 1988):
 *
 *     X / eta_0 = (g / lambda) * ln( csc( pi*w / (2g) ) )
 *
 * A round wire of radius `a` is equivalent to a strip of width w = 4a, so for
 * thin wires the expression reduces to
 *
 *     X / eta_0 = (g / lambda) * ln( g / (2*pi*a) ).
 *
 * IMPORTANT VALIDITY LIMIT. This is a quasi-static result and needs g << lambda.
 * Ordinary building reinforcement has a mesh pitch around 100-200 mm, while a
 * 2.4 GHz wavelength is 125 mm, so a real reinforced wall sits at g ~ lambda,
 * above the grating's first onset. There the sheet model is no longer valid and
 * measured shielding of reinforced concrete (roughly 1-20 dB, dominated by the
 * concrete itself and its moisture rather than by the mesh) must be used
 * instead. `evaluateWireGrid` reports this rather than returning a confident
 * number outside the model's range.
 */

import { C, type Complex } from './complex'
import { C_LIGHT } from './materials'

export interface WireGrid {
  /** Mesh pitch (centre-to-centre bar spacing), metres. */
  pitchM: number
  /** Bar radius, metres. For rebar this is half the nominal bar diameter. */
  wireRadiusM: number
}

export type GridValidity = 'valid' | 'marginal' | 'out-of-range'

export interface WireGridResult {
  /** Shunt admittance normalised to 1/eta_0, for insertion into the stack. */
  admittance: Complex
  /** Normalised shunt reactance X/eta_0. */
  normalisedReactance: number
  /** Shielding effectiveness of the bare sheet in free space, dB. */
  sheetShieldingDb: number
  validity: GridValidity
  /** Human-readable reason, always present when validity is not 'valid'. */
  validityNote: string
  pitchOverWavelength: number
}

export function evaluateWireGrid(grid: WireGrid, freqHz: number): WireGridResult {
  const lambda = C_LIGHT / freqHz
  const g = grid.pitchM
  const a = grid.wireRadiusM
  const ratio = g / lambda

  // Quasi-static inductive sheet.
  const logTerm = Math.log(g / (2 * Math.PI * a))
  const x = ratio * logTerm // X / eta_0
  // y = eta_0 / (jX) = -j / X
  const admittance: Complex = x === 0 ? C(0, 0) : C(0, -1 / x)

  // Transmission through a shunt admittance y between two matched free-space
  // lines: t = 2 / (2 + y)  ->  SE = 20*log10|1 + y/2|.
  const half = { re: admittance.re / 2, im: admittance.im / 2 }
  const sheetShieldingDb = 20 * Math.log10(Math.hypot(1 + half.re, half.im))

  let validity: GridValidity = 'valid'
  let note = ''
  if (a >= g / 2) {
    validity = 'out-of-range'
    note = 'Wire radius is not small compared with the pitch — the grid is effectively a solid sheet.'
  } else if (ratio > 0.5) {
    validity = 'out-of-range'
    note =
      `Mesh pitch ${(g * 1000).toFixed(0)} mm is comparable to or larger than the ` +
      `wavelength ${(lambda * 1000).toFixed(0)} mm (g/lambda = ${ratio.toFixed(2)}). ` +
      'The quasi-static sheet model does not apply; use a measured shielding value.'
  } else if (ratio > 0.25) {
    validity = 'marginal'
    note =
      `g/lambda = ${ratio.toFixed(2)} is at the edge of the quasi-static range ` +
      '(valid well below 0.25). Treat the result as indicative only.'
  } else if (a > g / 10) {
    validity = 'marginal'
    note = 'Wire radius exceeds a tenth of the pitch; the thin-wire reduction is approximate.'
  }

  return {
    admittance,
    normalisedReactance: x,
    sheetShieldingDb,
    validity,
    validityNote: note,
    pitchOverWavelength: ratio,
  }
}

/** Common German reinforcement mesh (Lagermatten) per DIN 488-4, for reference. */
export const REBAR_PRESETS: Array<{
  id: string
  name: string
  pitchM: number
  wireRadiusM: number
}> = [
  { id: 'q188a', name: 'Q188A — 150 mm pitch, 6.0 mm bar', pitchM: 0.15, wireRadiusM: 0.003 },
  { id: 'q257a', name: 'Q257A — 150 mm pitch, 7.0 mm bar', pitchM: 0.15, wireRadiusM: 0.0035 },
  { id: 'q335a', name: 'Q335A — 150 mm pitch, 8.0 mm bar', pitchM: 0.15, wireRadiusM: 0.004 },
  { id: 'q524a', name: 'Q524A — 150 mm pitch, 10.0 mm bar', pitchM: 0.15, wireRadiusM: 0.005 },
  { id: 'fine-100', name: 'Fine mesh — 100 mm pitch, 6.0 mm bar', pitchM: 0.1, wireRadiusM: 0.003 },
  { id: 'fine-50', name: 'Plaster mesh — 50 mm pitch, 1.0 mm wire', pitchM: 0.05, wireRadiusM: 0.0005 },
]
