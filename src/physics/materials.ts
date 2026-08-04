/**
 * Building-material electromagnetics.
 *
 * Primary source: Recommendation ITU-R P.2040-3/-4, "Effects of building
 * materials and structures on radiowave propagation above about 100 MHz",
 * section 3 and Table 3. The real relative permittivity and the conductivity of
 * a material follow power laws in frequency:
 *
 *     eps_r' = a * f^b          [-]
 *     sigma  = c * f^d          [S/m]        with f in GHz
 *
 * and the complex relative permittivity used everywhere downstream is
 *
 *     eps_r = eps_r' - j * sigma / (2*pi*f*eps_0)
 *
 * Every entry carries its validity range. Using a material outside its range is
 * an extrapolation, and the app says so rather than quietly returning a number:
 * brick, for instance, is only characterised to 10 GHz, and P.2040 gives no
 * 6 GHz figure for it.
 */

import { C, cSqrt, type Complex } from './complex'
import type { Provenance } from '../core/types'

/** Vacuum permittivity, CODATA 2022, exact by definition of the ampere. */
export const EPS_0 = 8.8541878188e-12 // F/m
/** Speed of light in vacuum, exact. */
export const C_LIGHT = 299792458 // m/s
/** Impedance of free space, derived from mu_0 and eps_0. */
export const ETA_0 = 376.730313412 // ohm

export interface MaterialDefinition {
  id: string
  name: string
  /** eps_r' = a * f^b, f in GHz. */
  a: number
  b: number
  /** sigma = c * f^d [S/m], f in GHz. */
  c: number
  d: number
  /** Inclusive validity range in GHz, from the source table. */
  fMinGHz: number
  fMaxGHz: number
  provenance: Provenance
  /**
   * RMS surface roughness in metres, used by the diffuse-scattering model.
   * Left undefined where no sourced value exists; the scattering model then
   * treats the surface as smooth and reports that it did.
   */
  rmsRoughnessM?: number
  notes?: string
}

const P2040: Provenance = {
  kind: 'standard',
  citation: 'ITU-R P.2040-3/-4, Table 3',
}

/**
 * Table 3 of ITU-R P.2040. Reproduced verbatim; do not "improve" these numbers.
 * Note b = 0 for every entry except the ground types, i.e. the real part of the
 * permittivity is frequency-independent over the stated range.
 */
export const ITU_MATERIALS: MaterialDefinition[] = [
  {
    id: 'vacuum',
    name: 'Vacuum / air',
    a: 1,
    b: 0,
    c: 0,
    d: 0,
    fMinGHz: 0.001,
    fMaxGHz: 100,
    provenance: P2040,
  },
  {
    id: 'concrete',
    name: 'Concrete',
    a: 5.24,
    b: 0,
    c: 0.0462,
    d: 0.7822,
    fMinGHz: 1,
    fMaxGHz: 100,
    provenance: P2040,
  },
  {
    id: 'brick',
    name: 'Brick',
    a: 3.91,
    b: 0,
    c: 0.0238,
    d: 0.16,
    fMinGHz: 1,
    fMaxGHz: 10,
    provenance: P2040,
    notes: 'Characterised only to 10 GHz — 6 GHz Wi-Fi is inside the range, 60 GHz is not.',
  },
  {
    id: 'plasterboard',
    name: 'Plasterboard (gypsum board)',
    a: 2.73,
    b: 0,
    c: 0.0085,
    d: 0.9395,
    fMinGHz: 1,
    fMaxGHz: 100,
    provenance: P2040,
  },
  {
    id: 'wood',
    name: 'Wood',
    a: 1.99,
    b: 0,
    c: 0.0047,
    d: 1.0718,
    fMinGHz: 0.001,
    fMaxGHz: 100,
    provenance: P2040,
  },
  {
    id: 'glass',
    name: 'Glass',
    a: 6.31,
    b: 0,
    c: 0.0036,
    d: 1.3394,
    fMinGHz: 0.1,
    fMaxGHz: 100,
    provenance: P2040,
  },
  {
    id: 'ceiling-board',
    name: 'Ceiling board',
    a: 1.48,
    b: 0,
    c: 0.0011,
    d: 1.075,
    fMinGHz: 1,
    fMaxGHz: 100,
    provenance: P2040,
  },
  {
    id: 'chipboard',
    name: 'Chipboard',
    a: 2.58,
    b: 0,
    c: 0.0217,
    d: 0.78,
    fMinGHz: 1,
    fMaxGHz: 100,
    provenance: P2040,
  },
  {
    id: 'plywood',
    name: 'Plywood',
    a: 2.71,
    b: 0,
    c: 0.33,
    d: 0,
    fMinGHz: 1,
    fMaxGHz: 40,
    provenance: P2040,
  },
  {
    id: 'marble',
    name: 'Marble',
    a: 7.074,
    b: 0,
    c: 0.0055,
    d: 0.9262,
    fMinGHz: 1,
    fMaxGHz: 60,
    provenance: P2040,
  },
  {
    id: 'floorboard',
    name: 'Floorboard',
    a: 3.66,
    b: 0,
    c: 0.0044,
    d: 1.3515,
    fMinGHz: 50,
    fMaxGHz: 100,
    provenance: P2040,
    notes:
      'Only characterised from 50 GHz upward. At Wi-Fi frequencies this is a large extrapolation — prefer "Wood" or a measured value.',
  },
  {
    id: 'metal',
    name: 'Metal',
    a: 1,
    b: 0,
    c: 1e7,
    d: 0,
    fMinGHz: 1,
    fMaxGHz: 100,
    provenance: P2040,
    notes: 'Effectively a perfect reflector at Wi-Fi frequencies.',
  },
  {
    id: 'very-dry-ground',
    name: 'Very dry ground',
    a: 3,
    b: 0,
    c: 0.00015,
    d: 2.52,
    fMinGHz: 1,
    fMaxGHz: 10,
    provenance: P2040,
  },
  {
    id: 'medium-dry-ground',
    name: 'Medium dry ground',
    a: 15,
    b: -0.1,
    c: 0.035,
    d: 1.63,
    fMinGHz: 1,
    fMaxGHz: 10,
    provenance: P2040,
  },
  {
    id: 'wet-ground',
    name: 'Wet ground',
    a: 30,
    b: -0.4,
    c: 0.15,
    d: 1.3,
    fMinGHz: 1,
    fMaxGHz: 10,
    provenance: P2040,
  },
]

/**
 * A material the user added. `provenance` is mandatory and the UI will not let
 * it be empty: the whole point is that no number in a result can be traced back
 * to a guess.
 */
export interface CustomMaterial extends MaterialDefinition {
  custom: true
}

export type AnyMaterial = MaterialDefinition | CustomMaterial

export interface MaterialProperties {
  /** Real part of the relative permittivity. */
  epsR: number
  /** Conductivity, S/m. */
  sigma: number
  /** Complex relative permittivity eps' - j*sigma/(omega*eps_0). */
  epsComplex: Complex
  /** Complex refractive index sqrt(eps_r). */
  n: Complex
  /** Loss tangent sigma / (omega * eps_0 * eps'). */
  lossTangent: number
  /** True when the requested frequency lies outside the source's stated range. */
  extrapolated: boolean
}

/** Evaluate a material at a frequency. `freqHz` in Hz. */
export function materialAt(m: MaterialDefinition, freqHz: number): MaterialProperties {
  const fGHz = freqHz / 1e9
  const epsR = m.a * Math.pow(fGHz, m.b)
  const sigma = m.c * Math.pow(fGHz, m.d)
  const omega = 2 * Math.PI * freqHz
  const imag = sigma / (omega * EPS_0)
  const epsComplex = C(epsR, -imag)
  return {
    epsR,
    sigma,
    epsComplex,
    n: cSqrt(epsComplex),
    lossTangent: epsR > 0 ? imag / epsR : Infinity,
    extrapolated: fGHz < m.fMinGHz || fGHz > m.fMaxGHz,
  }
}

/**
 * Attenuation of a plane wave inside the material, dB per metre, at normal
 * incidence. This is the bulk absorption only; the interface reflections are
 * handled by the transfer matrix. Follows P.2040 eq. (12)-(13).
 */
export function attenuationDbPerMetre(m: MaterialDefinition, freqHz: number): number {
  const p = materialAt(m, freqHz)
  // alpha = (2*pi*f/c) * Im(sqrt(eps_r)), nepers/m -> dB/m via 20*log10(e).
  const alphaNpPerM = ((2 * Math.PI * freqHz) / C_LIGHT) * Math.abs(p.n.im)
  return alphaNpPerM * 8.685889638
}

export function findMaterial(
  id: string,
  custom: CustomMaterial[] = [],
): MaterialDefinition | undefined {
  return ITU_MATERIALS.find((m) => m.id === id) ?? custom.find((m) => m.id === id)
}
