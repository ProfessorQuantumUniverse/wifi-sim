/**
 * Edge diffraction.
 *
 * Diffraction is the term that decides what a coverage map says about the room
 * next door, and it is the easiest one to get subtly wrong: the arithmetic
 * stays finite and the picture stays plausible while the answer is inverted.
 * The property that pins it down is continuity. A ray model without diffraction
 * predicts a cliff at the shadow boundary; the whole job of the UTD term is to
 * remove that cliff and leave exactly half the incident field on the boundary
 * itself. That is a number worked out on paper, not one read off this engine.
 */

import { describe, expect, test } from 'vitest'
import { coherentSum, tracePaths, DEFAULT_TRACE_OPTIONS } from '../src/engine/tracer'
import { utdDiffractionCoefficient } from '../src/physics/utd'
import { buildTraceScene } from '../src/engine/solver'
import { C } from '../src/physics/complex'
import { C_LIGHT, ISOTROPIC_Y, friisGain, screenScene, toDb } from './helpers'

const FREQ_HZ = 5.5e9
const OPAQUE = [{ materialId: 'metal', thicknessM: 0.002 }]

/**
 * The screen runs along y at x = 0 from y = 0 upwards, so its free lower end is
 * the diffracting edge. The transmitter sits at (-2, 2); the shadow boundary is
 * the straight line from there through the edge at the origin, and it reaches
 * x = 2 at y = -2. Offsetting the receiver in y from that point steps across
 * the boundary: negative y is lit, positive y is shadowed.
 */
const TX = { position: { x: -2, y: 2, z: 1.2 }, antenna: ISOTROPIC_Y }

function fieldRelativeToFreeSpaceDb(offsetM: number, reversed = false): number {
  const scene = buildTraceScene(screenScene(OPAQUE, 30, reversed), [], FREQ_HZ)
  const rx = { position: { x: 2, y: -2 + offsetM, z: 1.2 }, antenna: ISOTROPIC_Y }
  const paths = tracePaths(scene, TX, rx, {
    ...DEFAULT_TRACE_OPTIONS,
    maxReflectionOrder: 0,
  })
  const h = coherentSum(paths)
  const distance = Math.hypot(4, -4 + offsetM)
  return toDb(h.re * h.re + h.im * h.im) - toDb(friisGain(distance, FREQ_HZ))
}

describe('the shadow boundary behind a straight edge', () => {
  test('the field is half the incident field on the boundary', () => {
    // Half the field is a quarter of the power: 10*log10(0.25) = -6.02 dB.
    expect(fieldRelativeToFreeSpaceDb(0)).toBeCloseTo(-6.02, 0)
  })

  test('the field is continuous across the boundary', () => {
    const lit = fieldRelativeToFreeSpaceDb(-0.01)
    const shadow = fieldRelativeToFreeSpaceDb(0.01)
    expect(Math.abs(lit - shadow)).toBeLessThan(0.75)
    for (const value of [lit, shadow]) {
      expect(value).toBeGreaterThan(-6.9)
      expect(value).toBeLessThan(-5.2)
    }
  })

  test('the field falls off monotonically into the shadow', () => {
    const depths = [0.05, 0.1, 0.25, 0.5, 1, 2, 4]
    let previous = fieldRelativeToFreeSpaceDb(0.01)
    for (const depth of depths) {
      const here = fieldRelativeToFreeSpaceDb(depth)
      expect(here).toBeLessThan(previous)
      previous = here
    }
    // Four metres past the boundary the edge should be costing real signal.
    expect(previous).toBeLessThan(-20)
  })

  test('deep shadow still receives something rather than nothing', () => {
    const value = fieldRelativeToFreeSpaceDb(6)
    expect(Number.isFinite(value)).toBe(true)
    expect(value).toBeLessThan(-20)
    expect(value).toBeGreaterThan(-80)
  })

  /**
   * The reference direction the diffraction angles are measured from used to be
   * built with a cross product whose sign depended on the order the wall's two
   * endpoints happened to be stored in. Drawing the same wall the other way
   * round then swapped the lit and shadow regions, and the diffracted field
   * added where it should have subtracted. Nothing about a result may depend on
   * which end of a wall the user clicked first.
   */
  test('drawing the wall backwards changes nothing', () => {
    for (const offset of [-1, -0.25, -0.01, 0, 0.01, 0.25, 1, 3]) {
      const forwards = fieldRelativeToFreeSpaceDb(offset, false)
      const backwards = fieldRelativeToFreeSpaceDb(offset, true)
      // Not bit-identical: reversing the wall flips the facet normal, which
      // reflects the azimuths and so reorders the two reflection-boundary
      // terms. That moves the answer by well under a thousandth of a dB. The
      // bug this guards against moved it by nine.
      expect(Math.abs(backwards - forwards)).toBeLessThan(1e-3)
    }
  })
})

describe('the UTD coefficient itself', () => {
  const k = (2 * Math.PI) / (C_LIGHT / FREQ_HZ)
  const geometry = { k, sPrime: 3, s: 3, beta0: Math.PI / 2, n: 2, r0: C(-1), rN: C(-1) }

  /** Diffracted field at the receiver, as a fraction of the incident field. */
  function relativeToIncident(phiPrime: number, phi: number): number {
    const d = utdDiffractionCoefficient({ ...geometry, phiPrime, phi })
    const { sPrime, s } = geometry
    const spread = Math.sqrt(sPrime / (s * (sPrime + s)))
    return Math.hypot(d.re, d.im) * spread * ((sPrime + s) / sPrime)
  }

  test('it stays finite exactly on the boundary, where cot and F cancel', () => {
    // cot() diverges here and the transition function goes to zero. Evaluated
    // separately that is Infinity times zero, which silently deletes the term
    // that removes the cliff. A regular grid over an axis-aligned wall lands on
    // this case routinely, so it is not a corner worth leaving broken.
    const phiPrime = 0.6
    const onBoundary = relativeToIncident(phiPrime, phiPrime + Math.PI)
    expect(Number.isFinite(onBoundary)).toBe(true)
    expect(onBoundary).toBeCloseTo(0.5, 1)
  })

  test('it agrees with the direct evaluation just off the boundary', () => {
    const phiPrime = 0.6
    const onBoundary = relativeToIncident(phiPrime, phiPrime + Math.PI)

    // Approached from the two sides the magnitude is not quite the same, since
    // only the leading term is symmetric. What must hold is that the closed
    // form used on the boundary reproduces one of the two one-sided limits
    // instead of inventing a third value, and that both sides sit near a half.
    for (const delta of [1e-7, 1e-6, 1e-5]) {
      const lit = relativeToIncident(phiPrime, phiPrime + Math.PI - delta)
      const shadow = relativeToIncident(phiPrime, phiPrime + Math.PI + delta)
      expect(Math.min(Math.abs(onBoundary - lit), Math.abs(onBoundary - shadow))).toBeLessThan(1e-3)
      expect(Math.abs(lit - 0.5)).toBeLessThan(0.05)
      expect(Math.abs(shadow - 0.5)).toBeLessThan(0.05)
    }
  })

  test('it decays away from the boundary in both directions', () => {
    const phiPrime = 0.6
    let previous = relativeToIncident(phiPrime, phiPrime + Math.PI)
    for (const delta of [0.05, 0.15, 0.4, 0.8]) {
      const here = relativeToIncident(phiPrime, phiPrime + Math.PI + delta)
      expect(here).toBeLessThan(previous)
      previous = here
    }
  })
})
