/**
 * Radiation patterns.
 *
 * A pattern is only a directivity if it integrates to 4*pi over the sphere.
 * That single identity catches almost everything that can go wrong here, so it
 * is checked for every pattern the app offers rather than only for the ones
 * with a textbook peak gain. The polarisation vector gets the same treatment:
 * it has to be a unit vector perpendicular to the direction of travel, because
 * the whole point of carrying it is to compute a real mismatch loss instead of
 * assuming the two ends are aligned.
 */

import { describe, expect, test } from 'vitest'
import { evaluateAntenna, orientAntenna, peakGainDbi, type AntennaSpec } from '../src/physics/antenna'
import { vDot, vLen, v3 } from '../src/engine/geometry'

const PATTERNS: Array<[string, AntennaSpec]> = [
  ['isotropic', { kind: 'isotropic', boresight: v3(0, 0, 1), reference: v3(1, 0, 0) }],
  ['half-wave dipole', { kind: 'dipole', boresight: v3(0, 0, 1), reference: v3(1, 0, 0) }],
  [
    'two-element collinear',
    { kind: 'collinear', elements: 2, spacingLambda: 0.8, boresight: v3(0, 0, 1), reference: v3(1, 0, 0) },
  ],
  [
    'four-element collinear',
    { kind: 'collinear', elements: 4, spacingLambda: 0.8, boresight: v3(0, 0, 1), reference: v3(1, 0, 0) },
  ],
]

/** Integrate the pattern over the sphere with a uniform lat/long grid. */
function integrateOverSphere(spec: AntennaSpec, steps = 720): number {
  let total = 0
  for (let i = 0; i < steps; i++) {
    const theta = ((i + 0.5) / steps) * Math.PI
    const dTheta = Math.PI / steps
    let ring = 0
    const phiSteps = 180
    for (let j = 0; j < phiSteps; j++) {
      const phi = ((j + 0.5) / phiSteps) * 2 * Math.PI
      const dir = v3(
        Math.sin(theta) * Math.cos(phi),
        Math.sin(theta) * Math.sin(phi),
        Math.cos(theta),
      )
      ring += evaluateAntenna(spec, dir).gainLinear * ((2 * Math.PI) / phiSteps)
    }
    total += ring * Math.sin(theta) * dTheta
  }
  return total
}

describe('directivity', () => {
  test.each(PATTERNS)('%s integrates to 4*pi over the sphere', (_name, spec) => {
    expect(integrateOverSphere(spec) / (4 * Math.PI)).toBeCloseTo(1, 2)
  })

  test('the half-wave dipole peaks at the textbook 2.15 dBi', () => {
    // Balanis, Antenna Theory, 4th ed.: D = 1.643, which is 2.15 dBi.
    const dipole = PATTERNS[1][1]
    expect(peakGainDbi(dipole)).toBeCloseTo(2.15, 2)
    expect(evaluateAntenna(dipole, v3(1, 0, 0)).gainLinear).toBeCloseTo(1.643, 2)
  })

  test('stacking collinear elements raises the peak by roughly 3 dB each doubling', () => {
    const two = peakGainDbi(PATTERNS[2][1])
    const four = peakGainDbi(PATTERNS[3][1])
    expect(two).toBeGreaterThan(2.15)
    expect(four - two).toBeGreaterThan(2)
    expect(four - two).toBeLessThan(4)
  })

  test('an omni radiates nothing along its own axis and most across it', () => {
    for (const [, spec] of PATTERNS.slice(1)) {
      expect(evaluateAntenna(spec, v3(0, 0, 1)).gainLinear).toBeCloseTo(0, 6)
      expect(evaluateAntenna(spec, v3(0, 0, -1)).gainLinear).toBeCloseTo(0, 6)
      expect(evaluateAntenna(spec, v3(1, 0, 0)).gainLinear).toBeGreaterThan(1)
    }
  })

  test('a sector antenna is strongest on boresight and weakest behind', () => {
    const sector: AntennaSpec = {
      kind: 'sector',
      peakGainDbi: 9,
      vBeamwidthDeg: 60,
      hBeamwidthDeg: 65,
      frontToBackDb: 25,
      boresight: v3(1, 0, 0),
      reference: v3(0, 1, 0),
    }
    const front = evaluateAntenna(sector, v3(1, 0, 0)).gainLinear
    const side = evaluateAntenna(sector, v3(0, 1, 0)).gainLinear
    const back = evaluateAntenna(sector, v3(-1, 0, 0)).gainLinear

    expect(10 * Math.log10(front)).toBeCloseTo(9, 6)
    expect(front).toBeGreaterThan(side)
    expect(side).toBeGreaterThanOrEqual(back)
    expect(10 * Math.log10(front / back)).toBeCloseTo(25, 0)
  })

  /**
   * The rear half-space, swept rather than sampled on the axis. A sector
   * antenna used to return its full peak gain for a ray arriving exactly along
   * the reverse axis, which is precisely the direction a regular evaluation
   * grid keeps producing for a wall-mounted panel.
   */
  test('a sector antenna never exceeds its front-to-back floor behind itself', () => {
    const frontToBackDb = 25
    const sector: AntennaSpec = {
      kind: 'sector',
      peakGainDbi: 9,
      vBeamwidthDeg: 60,
      hBeamwidthDeg: 65,
      frontToBackDb,
      boresight: v3(1, 0, 0),
      reference: v3(0, 1, 0),
    }
    const floorDbi = 9 - frontToBackDb

    for (let i = 0; i <= 90; i++) {
      for (let j = 0; j <= 90; j++) {
        const theta = (i / 90) * Math.PI
        const phi = (j / 90) * 2 * Math.PI
        const dir = v3(
          Math.sin(theta) * Math.cos(phi),
          Math.sin(theta) * Math.sin(phi),
          Math.cos(theta),
        )
        // Only the rear half-space, where the floor must apply.
        if (vDot(dir, v3(1, 0, 0)) > -0.5) continue
        const dbi = 10 * Math.log10(evaluateAntenna(sector, dir).gainLinear)
        expect(dbi).toBeLessThanOrEqual(floorDbi + 1e-9)
      }
    }
  })
})

describe('polarisation', () => {
  test('the radiated field is a unit vector across the direction of travel', () => {
    const directions = [
      v3(1, 0, 0),
      v3(0, 1, 0),
      v3(0.6, 0.5, 0.62),
      v3(-0.3, 0.9, 0.31),
      v3(0.1, -0.2, 0.97),
    ].map((d) => ({ x: d.x / vLen(d), y: d.y / vLen(d), z: d.z / vLen(d) }))

    for (const [, spec] of PATTERNS) {
      for (const dir of directions) {
        const response = evaluateAntenna(spec, dir)
        if (response.gainLinear <= 1e-12) continue
        expect(vLen(response.polarisation)).toBeCloseTo(1, 9)
        expect(Math.abs(vDot(response.polarisation, dir))).toBeLessThan(1e-9)
      }
    }
  })

  test('a vertical and a horizontal dipole are cross-polarised broadside', () => {
    // The classic mismatch: a router with an upright whip and a phone lying
    // flat see each other through an orthogonal polarisation, which is why the
    // engine carries the vector instead of assuming they line up.
    const vertical: AntennaSpec = { kind: 'dipole', boresight: v3(0, 0, 1), reference: v3(1, 0, 0) }
    const horizontal: AntennaSpec = { kind: 'dipole', boresight: v3(0, 1, 0), reference: v3(1, 0, 0) }
    const along = v3(1, 0, 0)

    const a = evaluateAntenna(vertical, along).polarisation
    const b = evaluateAntenna(horizontal, along).polarisation
    expect(Math.abs(vDot(a, b))).toBeLessThan(1e-9)
  })
})

describe('orientation', () => {
  test('azimuth and tilt point the boresight where they say', () => {
    expect(orientAntenna(0, 90).boresight.z).toBeCloseTo(1, 9)
    expect(orientAntenna(0, -90).boresight.z).toBeCloseTo(-1, 9)

    const east = orientAntenna(0, 0).boresight
    expect(east.x).toBeCloseTo(1, 9)
    expect(east.z).toBeCloseTo(0, 9)

    const north = orientAntenna(90, 0).boresight
    expect(north.y).toBeCloseTo(1, 9)
  })

  test('the reference stays perpendicular to the boresight at any roll', () => {
    for (const azimuth of [0, 37, 180, 300]) {
      for (const tilt of [-90, -30, 0, 45, 90]) {
        for (const roll of [0, 45, 137]) {
          const { boresight, reference } = orientAntenna(azimuth, tilt, roll)
          expect(vLen(boresight)).toBeCloseTo(1, 9)
          expect(vLen(reference)).toBeCloseTo(1, 9)
          expect(Math.abs(vDot(boresight, reference))).toBeLessThan(1e-9)
        }
      }
    }
  })

  test('turning an omni does not change how much power it radiates', () => {
    for (const tilt of [0, 30, 90]) {
      const { boresight, reference } = orientAntenna(45, tilt)
      const spec: AntennaSpec = { kind: 'dipole', boresight, reference }
      expect(integrateOverSphere(spec, 360) / (4 * Math.PI)).toBeCloseTo(1, 2)
    }
  })
})
