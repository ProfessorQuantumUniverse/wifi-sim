/**
 * The ray tracer against closed-form propagation results.
 *
 * These are the tests that decide whether a coverage map means anything. If the
 * direct path does not reproduce Friis, nothing downstream can be trusted, and
 * if the ground-reflection case does not reproduce the two-ray model then the
 * phase bookkeeping that produces every interference fringe is wrong.
 */

import { describe, expect, test } from 'vitest'
import {
  TraceScene,
  coherentSum,
  incoherentSum,
  tracePaths,
  DEFAULT_TRACE_OPTIONS,
} from '../src/engine/tracer'
import { solveStack, type StackLayer } from '../src/physics/layerStack'
import { buildTraceScene } from '../src/engine/solver'
import {
  C_LIGHT,
  ISOTROPIC_Y,
  VERTICAL_DIPOLE,
  WIFI_FREQUENCIES,
  friisGain,
  groundPlane,
  materials,
  screenScene,
  toDb,
} from './helpers'

const emptyScene = (freqHz: number) => new TraceScene([], new Map(), materials, freqHz, [])

describe('free space', () => {
  test('the direct path reproduces the Friis equation', () => {
    for (const freqHz of WIFI_FREQUENCIES) {
      const scene = emptyScene(freqHz)
      for (const d of [0.5, 1, 2, 5, 10, 25, 50, 100]) {
        const paths = tracePaths(
          scene,
          { position: { x: 0, y: 0, z: 1.5 }, antenna: ISOTROPIC_Y },
          { position: { x: d, y: 0, z: 1.5 }, antenna: ISOTROPIC_Y },
          DEFAULT_TRACE_OPTIONS,
        )
        expect(paths).toHaveLength(1)
        expect(paths[0].lengthM).toBeCloseTo(d, 9)
        // 0.002 dB is the figure the README claims; the engine is far inside it.
        expect(toDb(paths[0].gain) - toDb(friisGain(d, freqHz))).toBeLessThan(0.002)
      }
    }
  })

  test('a dipole pair adds its two 2.15 dBi peaks broadside', () => {
    const freqHz = 5.5e9
    const d = 12
    const paths = tracePaths(
      emptyScene(freqHz),
      { position: { x: 0, y: 0, z: 1.5 }, antenna: VERTICAL_DIPOLE },
      { position: { x: d, y: 0, z: 1.5 }, antenna: VERTICAL_DIPOLE },
      DEFAULT_TRACE_OPTIONS,
    )
    const excessDb = toDb(paths[0].gain) - toDb(friisGain(d, freqHz))
    expect(excessDb).toBeCloseTo(2 * 2.15, 1)
  })

  test('a dipole radiates nothing along its own axis', () => {
    const paths = tracePaths(
      emptyScene(5.5e9),
      { position: { x: 0, y: 0, z: 0 }, antenna: VERTICAL_DIPOLE },
      { position: { x: 0, y: 0, z: 8 }, antenna: VERTICAL_DIPOLE },
      DEFAULT_TRACE_OPTIONS,
    )
    expect(paths).toHaveLength(0)
  })
})

describe('two-ray ground reflection', () => {
  /**
   * Transmitter and receiver above a single reflecting plane. The field is
   *
   *     E = (lambda / 4pi) * [ exp(-jk*d1)/d1 + G * exp(-jk*d2)/d2 ]
   *
   * with G the plane's reflection coefficient at the reflection angle. Both
   * antennas are polarised along y and the geometry lies in the xz plane, so
   * the reflection is purely TE and G is the stack's own TE coefficient.
   */
  function analyticTwoRay(
    d: number,
    h1: number,
    h2: number,
    freqHz: number,
    stack: StackLayer[],
  ): number {
    const lambda = C_LIGHT / freqHz
    const k = (2 * Math.PI) / lambda
    const d1 = Math.hypot(d, h1 - h2)
    const d2 = Math.hypot(d, h1 + h2)
    const incidence = Math.acos((h1 + h2) / d2)
    const g = solveStack(stack, materials, freqHz, incidence, 'TE').solution.r

    const a1 = lambda / (4 * Math.PI * d1)
    const a2 = lambda / (4 * Math.PI * d2)
    const re =
      a1 * Math.cos(-k * d1) + a2 * (g.re * Math.cos(-k * d2) - g.im * Math.sin(-k * d2))
    const im =
      a1 * Math.sin(-k * d1) + a2 * (g.re * Math.sin(-k * d2) + g.im * Math.cos(-k * d2))
    return re * re + im * im
  }

  test.each([
    ['concrete', [{ materialId: 'concrete', thicknessM: 0.3 }]],
    ['metal', [{ materialId: 'metal', thicknessM: 0.002 }]],
    ['wet ground', [{ materialId: 'wet-ground', thicknessM: 2 }]],
  ] as Array<[string, StackLayer[]]>)('matches the analytic model over %s', (_name, stack) => {
    const freqHz = 2.442e9
    const scene = new TraceScene(
      [groundPlane('ground')],
      new Map([['ground', stack]]),
      materials,
      freqHz,
      [],
    )
    const h1 = 2.6
    const h2 = 1.1
    const options = {
      ...DEFAULT_TRACE_OPTIONS,
      maxReflectionOrder: 1 as const,
      enableDiffraction: false,
    }

    for (const d of [3, 7, 15, 30, 60, 120, 250]) {
      const paths = tracePaths(
        scene,
        { position: { x: 0, y: 0, z: h1 }, antenna: ISOTROPIC_Y },
        { position: { x: d, y: 0, z: h2 }, antenna: ISOTROPIC_Y },
        options,
      )
      expect(paths).toHaveLength(2)

      const h = coherentSum(paths)
      const traced = toDb(h.re * h.re + h.im * h.im)
      const reference = toDb(analyticTwoRay(d, h1, h2, freqHz, stack))
      // The tracer interpolates its reflection coefficients from a 0.5 degree
      // table, so this also bounds that interpolation error.
      expect(Math.abs(traced - reference)).toBeLessThan(0.02)
    }
  })

  test('the interference nulls land where the path difference is a half wavelength', () => {
    const freqHz = 2.442e9
    const lambda = C_LIGHT / freqHz
    const stack: StackLayer[] = [{ materialId: 'metal', thicknessM: 0.002 }]
    const scene = new TraceScene(
      [groundPlane('ground')],
      new Map([['ground', stack]]),
      materials,
      freqHz,
      [],
    )
    const h1 = 2.5
    const h2 = 2.5
    const options = {
      ...DEFAULT_TRACE_OPTIONS,
      maxReflectionOrder: 1 as const,
      enableDiffraction: false,
    }
    const gainAt = (d: number) => {
      const h = coherentSum(
        tracePaths(
          scene,
          { position: { x: 0, y: 0, z: h1 }, antenna: ISOTROPIC_Y },
          { position: { x: d, y: 0, z: h2 }, antenna: ISOTROPIC_Y },
          options,
        ),
      )
      return h.re * h.re + h.im * h.im
    }

    // Over a near-perfect conductor the reflection is inverted, so the two rays
    // cancel wherever their path difference is a whole number of wavelengths.
    // Solve d for a path difference of exactly one wavelength.
    const target = lambda
    const pathDifference = (d: number) => Math.hypot(d, h1 + h2) - d
    let lo = 1
    let hi = 200
    for (let i = 0; i < 200; i++) {
      const mid = (lo + hi) / 2
      if (pathDifference(mid) > target) lo = mid
      else hi = mid
    }
    const nullDistance = (lo + hi) / 2

    const atNull = toDb(gainAt(nullDistance))
    const offNull = toDb(gainAt(nullDistance * 1.06))
    expect(atNull).toBeLessThan(offNull - 20)
  })
})

describe('invariants any correct solver must hold', () => {
  /**
   * Reciprocity. Swapping transmitter and receiver must not change the channel.
   * It is the cheapest way to catch a geometry or bookkeeping error, because
   * almost any sign or index slip breaks it.
   *
   * Reflections and transmissions are exactly reciprocal here. Diffraction is
   * reciprocal to about a thousandth of a dB rather than exactly, because the
   * Luebbers face coefficients are both sampled at the incidence azimuth
   * (`tracer.ts`), and that one angle is not symmetric under the swap. The
   * tolerance below is set to catch a real break while tolerating that known
   * heuristic; if the diffraction model is ever tightened up, this should be
   * expected to get better, never worse.
   */
  const reciprocityPoints = [
    { x: -3, y: 1.5, z: 1.1 },
    { x: 2.5, y: -1, z: 2.0 },
    { x: 4, y: 6, z: 0.6 },
    { x: -1, y: 9, z: 1.8 },
  ]

  function worstReciprocityErrorDb(enableDiffraction: boolean): number {
    const freqHz = 5.5e9
    const scene = buildTraceScene(
      screenScene([{ materialId: 'brick', thicknessM: 0.175 }], 12),
      [],
      freqHz,
    )
    const options = { ...DEFAULT_TRACE_OPTIONS, enableDiffraction }
    let worst = 0
    for (let i = 0; i < reciprocityPoints.length; i++) {
      for (let j = i + 1; j < reciprocityPoints.length; j++) {
        const forward = tracePaths(
          scene,
          { position: reciprocityPoints[i], antenna: ISOTROPIC_Y },
          { position: reciprocityPoints[j], antenna: ISOTROPIC_Y },
          options,
        )
        const backward = tracePaths(
          scene,
          { position: reciprocityPoints[j], antenna: ISOTROPIC_Y },
          { position: reciprocityPoints[i], antenna: ISOTROPIC_Y },
          options,
        )
        // Path counts are deliberately not compared. A path sitting within a
        // hair of the dynamic-range floor can be kept in one direction and
        // dropped in the other, and at 44 dB below the dominant path that
        // decision moves the total by well under a thousandth of a dB.
        expect(forward.length).toBeGreaterThan(0)
        worst = Math.max(
          worst,
          Math.abs(toDb(incoherentSum(backward)) - toDb(incoherentSum(forward))),
        )
      }
    }
    return worst
  }

  test('reflections and transmissions are exactly reciprocal', () => {
    expect(worstReciprocityErrorDb(false)).toBeLessThan(1e-9)
  })

  test('diffraction is reciprocal to within the Luebbers heuristic', () => {
    expect(worstReciprocityErrorDb(true)).toBeLessThan(0.01)
  })

  test('no path and no path sum carries more power than the transmitter sent', () => {
    const freqHz = 5.5e9
    const scene = buildTraceScene(
      screenScene([{ materialId: 'metal', thicknessM: 0.002 }], 20),
      [],
      freqHz,
    )
    for (let x = -6; x <= 6; x += 0.7) {
      for (let y = -4; y <= 14; y += 0.9) {
        const paths = tracePaths(
          scene,
          { position: { x: -3, y: 4, z: 1.4 }, antenna: ISOTROPIC_Y },
          { position: { x, y, z: 1.1 }, antenna: ISOTROPIC_Y },
          DEFAULT_TRACE_OPTIONS,
        )
        for (const p of paths) {
          expect(Number.isFinite(p.gain)).toBe(true)
          expect(p.gain).toBeGreaterThanOrEqual(0)
        }
        const total = incoherentSum(paths)
        expect(Number.isFinite(total)).toBe(true)
        expect(total).toBeLessThanOrEqual(1)
      }
    }
  })

  test('an opaque wall costs far more than an open passage', () => {
    const freqHz = 5.5e9
    const tx = { position: { x: -3, y: 5, z: 1.2 }, antenna: ISOTROPIC_Y }
    const rx = { position: { x: 3, y: 5, z: 1.2 }, antenna: ISOTROPIC_Y }
    const options = { ...DEFAULT_TRACE_OPTIONS, enableDiffraction: false }

    const through = (layers: StackLayer[]) =>
      toDb(incoherentSum(tracePaths(buildTraceScene(screenScene(layers), [], freqHz), tx, rx, options)))

    const air = through([{ materialId: 'vacuum', thicknessM: 0.001 }])
    const brick = through([{ materialId: 'brick', thicknessM: 0.24 }])
    const concrete = through([{ materialId: 'concrete', thicknessM: 0.2 }])

    expect(air).toBeCloseTo(toDb(friisGain(6, freqHz)), 3)
    expect(air - brick).toBeGreaterThan(5)
    expect(brick - concrete).toBeGreaterThan(5)
  })
})
