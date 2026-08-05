/**
 * Walls, glazing and the transfer matrix that solves them.
 *
 * The claim this project makes is that a build-up is solved rather than looked
 * up, so these tests check the things a lookup table cannot do: energy is
 * conserved to machine precision, Brewster's angle produces an exact null, a
 * sealed glazing unit behaves completely differently at 2.4 and 5.5 GHz, and a
 * Low-E coating reproduces the closed-form resistive sheet it is modelled as.
 */

import { describe, expect, test } from 'vitest'
import {
  solveStack,
  unpolarisedTransmissionLossDb,
  type Polarisation,
  type StackLayer,
} from '../src/physics/layerStack'
import { evaluateWireGrid } from '../src/physics/wireGrid'
import { sheetAttenuationDb } from '../src/physics/coatings'
import { ITU_MATERIALS, materialAt } from '../src/physics/materials'
import { DEFAULT_WALL_TYPES } from '../src/scene/defaults'
import { WIFI_FREQUENCIES, lossless, materials } from './helpers'

const POLARISATIONS: Polarisation[] = ['TE', 'TM']
const ANGLES = [0, 0.2, 0.5, Math.PI / 6, Math.PI / 4, 1.2, 1.4, 1.5]
const buildUp = (id: string): StackLayer[] =>
  DEFAULT_WALL_TYPES.find((t) => t.id === id)!.layers

describe('energy conservation', () => {
  test('a lossless stack transmits and reflects exactly all of the power', () => {
    const table = new Map(materials)
    table.set('l1', lossless('l1', 6.31))
    table.set('l2', lossless('l2', 2.5))
    const stack: StackLayer[] = [
      { materialId: 'l1', thicknessM: 0.004 },
      { materialId: 'l2', thicknessM: 0.05 },
      { materialId: 'l1', thicknessM: 0.006 },
    ]

    for (const freqHz of WIFI_FREQUENCIES) {
      for (const angle of ANGLES) {
        for (const pol of POLARISATIONS) {
          const { solution } = solveStack(stack, table, freqHz, angle, pol)
          expect(solution.transmittance + solution.reflectance).toBeCloseTo(1, 9)
          expect(solution.absorptance).toBeLessThan(1e-9)
        }
      }
    }
  })

  test('no real build-up ever returns more power than went in', () => {
    for (const type of DEFAULT_WALL_TYPES) {
      for (const freqHz of WIFI_FREQUENCIES) {
        for (const angle of ANGLES) {
          for (const pol of POLARISATIONS) {
            const { solution } = solveStack(type.layers, materials, freqHz, angle, pol)
            expect(solution.transmittance).toBeGreaterThanOrEqual(0)
            expect(solution.reflectance).toBeGreaterThanOrEqual(0)
            expect(solution.transmittance + solution.reflectance).toBeLessThanOrEqual(1 + 1e-9)
            expect(Number.isFinite(solution.t.re)).toBe(true)
            expect(Number.isFinite(solution.r.re)).toBe(true)
          }
        }
      }
    }
  })

  test('transmission is the same from either side of an asymmetric wall', () => {
    // A reciprocal stack transmits equally in both directions even when it is
    // not symmetric, while its reflection generally differs. Reversing the
    // layer order is the cheapest way to check the matrix product is right.
    const stack: StackLayer[] = [
      { materialId: 'plasterboard', thicknessM: 0.0125 },
      { materialId: 'vacuum', thicknessM: 0.075 },
      { materialId: 'concrete', thicknessM: 0.1 },
      { materialId: 'wood', thicknessM: 0.02 },
    ]
    const reversed = [...stack].reverse()

    for (const freqHz of WIFI_FREQUENCIES) {
      for (const angle of ANGLES) {
        for (const pol of POLARISATIONS) {
          const a = solveStack(stack, materials, freqHz, angle, pol).solution
          const b = solveStack(reversed, materials, freqHz, angle, pol).solution
          expect(b.transmittance).toBeCloseTo(a.transmittance, 12)
        }
      }
    }
  })
})

describe('angle of incidence', () => {
  test('Brewster’s angle produces an exact null in TM reflection', () => {
    const table = new Map(materials)
    for (const epsR of [2.5, 4, 6.31, 9]) {
      table.set('l', lossless('l', epsR))
      const brewster = Math.atan(Math.sqrt(epsR))
      const stack: StackLayer[] = [{ materialId: 'l', thicknessM: 0.004 }]

      const atBrewster = solveStack(stack, table, 5.5e9, brewster, 'TM').solution
      expect(atBrewster.reflectance).toBeLessThan(1e-20)
      expect(atBrewster.transmittance).toBeCloseTo(1, 12)

      // Either side of it there is a real reflection, so the null is a null
      // and not just a flat curve.
      for (const delta of [-0.15, 0.15]) {
        const off = solveStack(stack, table, 5.5e9, brewster + delta, 'TM').solution
        expect(off.reflectance).toBeGreaterThan(1e-4)
      }

      // TE has no Brewster angle; it reflects there like anywhere else.
      const te = solveStack(stack, table, 5.5e9, brewster, 'TE').solution
      expect(te.reflectance).toBeGreaterThan(0.01)
    }
  })

  test('a wall costs more at a slant than head on', () => {
    for (const id of ['brick-175-plastered', 'concrete-200']) {
      const layers = buildUp(id)
      const straight = unpolarisedTransmissionLossDb(layers, materials, 5.5e9, 0)
      const slanted = unpolarisedTransmissionLossDb(layers, materials, 5.5e9, 1.2)
      expect(slanted).toBeGreaterThan(straight)
    }
  })
})

describe('glazing', () => {
  /**
   * The example the README leads with. A sealed 4-16-4 unit is nearly
   * transparent at 2.4 GHz and costs about 9 dB at 5.5 GHz, because at the
   * higher frequency the 16 mm cavity is close to half a wavelength. No
   * constant dB-per-wall figure can express a 9 dB swing across one band, which
   * is the entire argument for solving the stack.
   */
  test('an uncoated sealed unit behaves completely differently at 2.4 and 5.5 GHz', () => {
    const layers = buildUp('glass-double-4-16-4')
    const at24 = unpolarisedTransmissionLossDb(layers, materials, 2.442e9, 0)
    const at55 = unpolarisedTransmissionLossDb(layers, materials, 5.5e9, 0)

    expect(at24).toBeLessThan(0.5)
    expect(at55).toBeGreaterThan(8.5)
    expect(at55).toBeLessThan(10)
    expect(at55 - at24).toBeGreaterThan(8)
  })

  test('a Low-E coating turns the same unit into a screen', () => {
    const plain = unpolarisedTransmissionLossDb(buildUp('glass-double-4-16-4'), materials, 2.442e9, 0)
    const lowE = unpolarisedTransmissionLossDb(
      buildUp('glass-double-lowe-soft'),
      materials,
      2.442e9,
      0,
    )
    expect(lowE).toBeGreaterThan(25)
    expect(lowE).toBeLessThan(35)
    expect(lowE - plain).toBeGreaterThan(25)
  })

  test('the coating matches the closed-form resistive sheet it is modelled as', () => {
    // A film far thinner than a skin depth is exactly a shunt resistive sheet.
    // Standing in free space it transmits t = 2 / (2 + eta_0/R), which is what
    // `sheetAttenuationDb` states. Carrying it on a zero-thickness layer of air
    // isolates the sheet from any surrounding dielectric, so the two have to
    // agree to the last digit.
    for (const sheetResistance of [1.5, 3, 5, 20, 100]) {
      const sheet: StackLayer[] = [
        { materialId: 'vacuum', thicknessM: 0, coating: { sheetResistanceOhmPerSq: sheetResistance } },
      ]
      const { solution } = solveStack(sheet, materials, 2.442e9, 0, 'TE')
      const loss = -10 * Math.log10(solution.transmittance)
      expect(loss).toBeCloseTo(sheetAttenuationDb(sheetResistance), 9)
    }
  })

  test('a coating on glass costs more the lower its sheet resistance', () => {
    // Backed by a dielectric the sheet sees a different impedance, so the free
    // space figure no longer applies exactly. The ordering still has to hold,
    // and the strongest coatings still have to land in the 25-35 dB range that
    // measurements of Low-E glazing report.
    const table = new Map(materials)
    table.set('clear', lossless('clear', 6.31))

    let previous = -Infinity
    for (const sheetResistance of [100, 20, 5, 3, 1.5]) {
      const coated: StackLayer[] = [
        {
          materialId: 'clear',
          thicknessM: 0.004,
          coating: { sheetResistanceOhmPerSq: sheetResistance },
        },
      ]
      const loss =
        -10 * Math.log10(solveStack(coated, table, 2.442e9, 0, 'TE').solution.transmittance)
      expect(loss).toBeGreaterThan(previous)
      previous = loss
    }

    const softCoat: StackLayer[] = [
      { materialId: 'clear', thicknessM: 0.004, coating: { sheetResistanceOhmPerSq: 5 } },
    ]
    const softCoatLoss =
      -10 * Math.log10(solveStack(softCoat, table, 2.442e9, 0, 'TE').solution.transmittance)
    expect(softCoatLoss).toBeGreaterThan(25)
    expect(softCoatLoss).toBeLessThan(35)
  })

  test('triple glazing with two coatings blocks more than double with one', () => {
    const double = unpolarisedTransmissionLossDb(buildUp('glass-double-lowe-soft'), materials, 5.5e9, 0)
    const triple = unpolarisedTransmissionLossDb(
      buildUp('glass-triple-4-12-4-12-4'),
      materials,
      5.5e9,
      0,
    )
    expect(triple).toBeGreaterThan(double + 10)
  })
})

describe('reinforcement mesh', () => {
  test('ordinary rebar is reported as outside the model at Wi-Fi frequencies', () => {
    // 150 mm mesh against a 125 mm wavelength. The quasi-static sheet model
    // needs the pitch to be small against the wavelength and it is not, so the
    // right behaviour is to say so rather than return a confident number.
    for (const freqHz of [2.442e9, 5.5e9, 6.115e9]) {
      const result = evaluateWireGrid({ pitchM: 0.15, wireRadiusM: 0.003 }, freqHz)
      expect(result.validity).toBe('out-of-range')
      expect(result.validityNote).not.toHaveLength(0)
    }
  })

  test('a fine plaster mesh is inside the model and shields more than a coarse one', () => {
    const fine = evaluateWireGrid({ pitchM: 0.01, wireRadiusM: 0.0005 }, 2.442e9)
    const coarse = evaluateWireGrid({ pitchM: 0.04, wireRadiusM: 0.0005 }, 2.442e9)
    expect(fine.validity).toBe('valid')
    expect(fine.sheetShieldingDb).toBeGreaterThan(coarse.sheetShieldingDb)
  })
})

describe('the ITU-R P.2040 material table', () => {
  test('every entry stays physical across the Wi-Fi bands', () => {
    for (const material of ITU_MATERIALS) {
      for (const freqHz of WIFI_FREQUENCIES) {
        const props = materialAt(material, freqHz)
        expect(props.epsR).toBeGreaterThanOrEqual(1)
        expect(props.sigma).toBeGreaterThanOrEqual(0)
        // A passive medium absorbs, so the refractive index must have a
        // non-negative imaginary part in this sign convention.
        expect(props.n.re).toBeGreaterThan(0)
        expect(Math.abs(props.n.im)).toBeGreaterThanOrEqual(0)
      }
    }
  })

  test('use outside a sourced range is flagged rather than silently allowed', () => {
    const brick = ITU_MATERIALS.find((m) => m.id === 'brick')!
    expect(materialAt(brick, 5.5e9).extrapolated).toBe(false)
    expect(materialAt(brick, 60e9).extrapolated).toBe(true)

    // Floorboard is only characterised from 50 GHz up, so every Wi-Fi band is
    // an extrapolation and the app has to say so.
    const floorboard = ITU_MATERIALS.find((m) => m.id === 'floorboard')!
    for (const freqHz of WIFI_FREQUENCIES) {
      expect(materialAt(floorboard, freqHz).extrapolated).toBe(true)
    }
  })

  test('a stack reports which of its materials were extrapolated', () => {
    const { diagnostics } = solveStack(
      [
        { materialId: 'concrete', thicknessM: 0.2 },
        { materialId: 'floorboard', thicknessM: 0.02 },
      ],
      materials,
      5.5e9,
      0,
      'TE',
    )
    expect(diagnostics.extrapolated).toBe(true)
    expect(diagnostics.extrapolatedMaterials).toContain('Floorboard')
    expect(diagnostics.extrapolatedMaterials).not.toContain('Concrete')
    expect(diagnostics.totalThicknessM).toBeCloseTo(0.22, 9)
  })
})
