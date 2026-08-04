/**
 * Plane-wave transmission and reflection through a multilayer slab, solved
 * exactly with the characteristic-matrix (Abeles) method.
 *
 * Reference formulation: H. A. Macleod, "Thin-Film Optical Filters", 4th ed.,
 * CRC Press 2010, ch. 2 — the same algebra ITU-R P.2040 Annex 1 sec. 3 uses for
 * its single-slab result, generalised to N layers.
 *
 * Each layer contributes
 *
 *     M_j = [  cos(delta_j)          (i/eta_j) sin(delta_j) ]
 *           [  i*eta_j sin(delta_j)   cos(delta_j)          ]
 *
 * with delta_j = (2*pi/lambda_0) * n_j * d_j * cos(theta_j), where n_j is the
 * complex refractive index and theta_j the complex refraction angle from Snell's
 * law. eta_j is the tilted optical admittance, normalised to 1/eta_0:
 *
 *     TE (s-pol):  eta = n*cos(theta)
 *     TM (p-pol):  eta = n/cos(theta)
 *
 * Because it is exact, this automatically reproduces the internal multiple
 * reflections, the half-wave thickness resonances that make one wall behave very
 * differently at 2.4 and 5 GHz, and Brewster-angle behaviour — none of which a
 * per-wall constant-dB table can represent.
 *
 * A conductive mesh inside the build-up is inserted as a zero-thickness shunt
 * admittance sheet, matrix [[1, 0], [y, 1]].
 */

import {
  cAbs2,
  cAdd,
  cCos,
  cDiv,
  cMul,
  cSin,
  cSqrt,
  cSub,
  C,
  type Complex,
} from './complex'
import { C_LIGHT, ETA_0, materialAt, type MaterialDefinition } from './materials'
import { evaluateWireGrid, type WireGrid, type WireGridResult } from './wireGrid'

export type Polarisation = 'TE' | 'TM'

/**
 * A thin conductive film on a layer's surface — the metallic Low-E coating on
 * modern insulating glazing, or a foil-faced insulation board.
 *
 * The film is far thinner than a skin depth is long at Wi-Fi frequencies, so it
 * is exactly a resistive sheet: normalised shunt admittance y = eta_0 / R_sheet,
 * with R_sheet the coating's sheet resistance in ohms per square. That figure is
 * a published product property (it is what "emissivity" is derived from), so
 * this is a sourced input rather than a fitted attenuation.
 *
 * This matters a lot. ITU-R P.2040's "glass" is uncoated float glass; a plain
 * 4-16-4 unit comes out at a couple of dB. A soft-coat Low-E unit measures
 * 25-30 dB and up, and that difference is the single biggest reason a naive
 * model looks far too optimistic near windows.
 */
export interface ConductiveCoating {
  /** Sheet resistance, ohms per square. */
  sheetResistanceOhmPerSq: number
}

export interface StackLayer {
  materialId: string
  thicknessM: number
  /** Conductive mesh embedded at the centre of this layer. */
  grid?: WireGrid
  /** Conductive film on the layer's front face (the side light enters). */
  coating?: ConductiveCoating
}

export interface StackSolution {
  /** Power transmittance, 0..1. */
  transmittance: number
  /** Power reflectance, 0..1. */
  reflectance: number
  /** Fraction absorbed in the slab; 1 - T - R. */
  absorptance: number
  /** Transmission loss, dB. Infinity when the slab is opaque. */
  transmissionLossDb: number
  /** Complex field coefficients, carrying the phase the ray tracer needs. */
  t: Complex
  r: Complex
}

export interface StackDiagnostics {
  /** True if any layer's material was evaluated outside its sourced range. */
  extrapolated: boolean
  extrapolatedMaterials: string[]
  gridResults: WireGridResult[]
  totalThicknessM: number
}

type Matrix2 = [Complex, Complex, Complex, Complex] // row-major m11, m12, m21, m22

/**
 * Cap on |Im(delta)|, the layer's phase thickness.
 *
 * cos(delta) and sin(delta) grow like exp(|Im delta|)/2, so a strongly
 * conducting or simply thick layer overflows to Infinity and poisons the whole
 * matrix with NaN — 5 mm of metal at 5.5 GHz already gives |Im delta| ~ 2300.
 * exp(40) corresponds to about 347 dB of one-way attenuation, far beyond any
 * physically meaningful opacity, so clamping there changes no usable result
 * while keeping the arithmetic finite.
 */
const MAX_PHASE_THICKNESS = 40

function clampPhaseThickness(delta: Complex): Complex {
  if (Math.abs(delta.im) <= MAX_PHASE_THICKNESS) return delta
  return { re: delta.re, im: Math.sign(delta.im) * MAX_PHASE_THICKNESS }
}

const IDENTITY: Matrix2 = [C(1), C(0), C(0), C(1)]

function matMul(a: Matrix2, b: Matrix2): Matrix2 {
  return [
    cAdd(cMul(a[0], b[0]), cMul(a[1], b[2])),
    cAdd(cMul(a[0], b[1]), cMul(a[1], b[3])),
    cAdd(cMul(a[2], b[0]), cMul(a[3], b[2])),
    cAdd(cMul(a[2], b[1]), cMul(a[3], b[3])),
  ]
}

/** Tilted admittance, normalised so that free space at normal incidence is 1. */
function tiltedAdmittance(n: Complex, cosTheta: Complex, pol: Polarisation): Complex {
  return pol === 'TE' ? cMul(n, cosTheta) : cDiv(n, cosTheta)
}

/**
 * Solve the stack. `incidenceRad` is measured from the surface normal, in the
 * incident medium, which is taken to be air on both sides (walls and slabs in a
 * building are bounded by rooms).
 */
export function solveStack(
  layers: StackLayer[],
  materials: Map<string, MaterialDefinition>,
  freqHz: number,
  incidenceRad: number,
  pol: Polarisation,
): { solution: StackSolution; diagnostics: StackDiagnostics } {
  const lambda0 = C_LIGHT / freqHz
  const k0 = (2 * Math.PI) / lambda0
  const sinTheta0 = Math.sin(incidenceRad)
  const cosTheta0 = Math.cos(incidenceRad)

  // Air on both sides: n = 1.
  const eta0 = pol === 'TE' ? C(cosTheta0) : C(1 / cosTheta0)
  const etaSub = eta0

  let m: Matrix2 = IDENTITY
  const extrapolatedMaterials: string[] = []
  const gridResults: WireGridResult[] = []
  let totalThicknessM = 0

  for (const layer of layers) {
    const material = materials.get(layer.materialId)
    if (!material) continue
    totalThicknessM += layer.thicknessM

    // A coating sits on the layer's front face, before the bulk.
    if (layer.coating && layer.coating.sheetResistanceOhmPerSq > 0) {
      const y = ETA_0 / layer.coating.sheetResistanceOhmPerSq
      m = matMul(m, [C(1), C(0), C(y), C(1)])
    }

    const props = materialAt(material, freqHz)
    if (props.extrapolated && !extrapolatedMaterials.includes(material.name)) {
      extrapolatedMaterials.push(material.name)
    }

    const n = props.n
    // Snell: sin(theta_j) = sin(theta_0) / n_j  (n_0 = 1)
    const sinThetaJ = cDiv(C(sinTheta0), n)
    const cosThetaJ = cSqrt(cSub(C(1), cMul(sinThetaJ, sinThetaJ)))
    const eta = tiltedAdmittance(n, cosThetaJ, pol)

    // A mesh sits at mid-depth, so the layer is split around it.
    const halves = layer.grid ? [layer.thicknessM / 2, layer.thicknessM / 2] : [layer.thicknessM]

    for (let h = 0; h < halves.length; h++) {
      const d = halves[h]
      if (d > 0) {
        const delta = clampPhaseThickness(cMul(cMul(n, cosThetaJ), C(k0 * d)))
        const cosD = cCos(delta)
        const sinD = cSin(delta)
        const layerMatrix: Matrix2 = [
          cosD,
          cDiv(cMul(C(0, 1), sinD), eta),
          cMul(cMul(C(0, 1), eta), sinD),
          cosD,
        ]
        m = matMul(m, layerMatrix)
      }

      if (layer.grid && h === 0) {
        const gridResult = evaluateWireGrid(layer.grid, freqHz)
        gridResults.push(gridResult)
        const sheet: Matrix2 = [C(1), C(0), gridResult.admittance, C(1)]
        m = matMul(m, sheet)
      }
    }
  }

  // Macleod's B, C: [B; C] = M * [1; eta_substrate]
  const bTerm = cAdd(m[0], cMul(m[1], etaSub))
  const cTerm = cAdd(m[2], cMul(m[3], etaSub))

  const denom = cAdd(cMul(eta0, bTerm), cTerm)
  const numR = cSub(cMul(eta0, bTerm), cTerm)

  const r = cDiv(numR, denom)
  const t = cDiv(cMul(C(2), eta0), denom)

  const reflectance = cAbs2(r)
  // T = 4 * Re(eta_0) * Re(eta_sub) / |eta_0*B + C|^2
  const transmittance = (4 * eta0.re * etaSub.re) / cAbs2(denom)
  const absorptance = Math.max(0, 1 - transmittance - reflectance)

  return {
    solution: {
      transmittance,
      reflectance,
      absorptance,
      transmissionLossDb: transmittance > 0 ? -10 * Math.log10(transmittance) : Infinity,
      t,
      r,
    },
    diagnostics: {
      extrapolated: extrapolatedMaterials.length > 0,
      extrapolatedMaterials,
      gridResults,
      totalThicknessM,
    },
  }
}

/**
 * Unpolarised transmission loss: the average of the two polarisations' power
 * transmittances. Used for scalar coverage maps; the ray tracer keeps TE and TM
 * separate and combines them with the actual field polarisation.
 */
export function unpolarisedTransmissionLossDb(
  layers: StackLayer[],
  materials: Map<string, MaterialDefinition>,
  freqHz: number,
  incidenceRad: number,
): number {
  const te = solveStack(layers, materials, freqHz, incidenceRad, 'TE').solution.transmittance
  const tm = solveStack(layers, materials, freqHz, incidenceRad, 'TM').solution.transmittance
  const mean = (te + tm) / 2
  return mean > 0 ? -10 * Math.log10(mean) : Infinity
}
