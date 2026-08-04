/**
 * Antenna radiation patterns.
 *
 * Each pattern returns a directivity and the unit polarisation vector of the
 * radiated E-field for a given direction. Carrying the polarisation vector (not
 * just a scalar gain) is what lets the engine compute the real mismatch loss
 * between, say, a vertically mounted router antenna and a phone held flat —
 * instead of silently assuming they are aligned.
 *
 * Closed forms used:
 *  - Half-wave dipole: D(theta) = 1.643 * [cos(pi/2 cos theta) / sin theta]^2,
 *    peak 2.15 dBi. Balanis, "Antenna Theory", 4th ed., eq. 4-64/4-91.
 *  - Collinear array: element pattern times the uniform-array factor
 *    AF = sin(N*psi/2) / (N*sin(psi/2)), psi = k*d*cos(theta) + beta.
 *    Balanis ch. 6. Directivity is obtained by numerical integration of the
 *    resulting pattern over the sphere, so the reported dBi is the true one.
 *  - Sector/patch: 3GPP TR 38.901 Table 7.3-1 element pattern.
 */

import { vCross, vDot, vNorm, vSub, v3 } from '../engine/geometry'
import type { Vec3 } from '../scene/model'

export type PatternKind = 'isotropic' | 'dipole' | 'collinear' | 'sector'

export interface AntennaSpec {
  kind: PatternKind
  /** Collinear only: number of half-wave elements. */
  elements?: number
  /** Collinear only: element spacing in wavelengths. */
  spacingLambda?: number
  /** Sector only: peak gain, dBi. */
  peakGainDbi?: number
  /** Sector only: vertical and horizontal 3 dB beamwidths, degrees. */
  vBeamwidthDeg?: number
  hBeamwidthDeg?: number
  /** Sector only: front-to-back / sidelobe floor, dB. */
  frontToBackDb?: number
  /**
   * Orientation. `boresight` is the pattern's main axis: the dipole/collinear
   * axis for omni types, the beam direction for a sector. `reference` fixes the
   * roll about the boresight and defines the E-plane for a sector.
   */
  boresight: Vec3
  reference: Vec3
}

export const VERTICAL_DIPOLE: AntennaSpec = {
  kind: 'dipole',
  boresight: { x: 0, y: 0, z: 1 },
  reference: { x: 1, y: 0, z: 0 },
}

export interface AntennaResponse {
  /** Directivity in the given direction, linear (not dB). */
  gainLinear: number
  /** Unit vector of the radiated E-field. Zero-length if the gain is zero. */
  polarisation: Vec3
}

/** Rotate `boresight` by azimuth (about +z) and elevation tilt, in degrees. */
export function orientAntenna(
  azimuthDeg: number,
  tiltDeg: number,
  rollDeg = 0,
): { boresight: Vec3; reference: Vec3 } {
  const az = (azimuthDeg * Math.PI) / 180
  const tilt = (tiltDeg * Math.PI) / 180
  const roll = (rollDeg * Math.PI) / 180

  // Start pointing along +x, tilt up towards +z, then rotate about +z.
  const boresight = vNorm(
    v3(Math.cos(tilt) * Math.cos(az), Math.cos(tilt) * Math.sin(az), Math.sin(tilt)),
  )
  // A reference perpendicular to the boresight, rolled about it.
  const up = Math.abs(boresight.z) > 0.99 ? v3(1, 0, 0) : v3(0, 0, 1)
  const e1 = vNorm(vCross(up, boresight))
  const e2 = vCross(boresight, e1)
  const reference = vNorm(
    v3(
      e1.x * Math.cos(roll) + e2.x * Math.sin(roll),
      e1.y * Math.cos(roll) + e2.y * Math.sin(roll),
      e1.z * Math.cos(roll) + e2.z * Math.sin(roll),
    ),
  )
  return { boresight, reference }
}

/**
 * Component of `axis` perpendicular to the propagation direction, normalised.
 * This is the E-field direction a linear radiator produces: a dipole's field
 * lies along theta-hat, which is exactly the axis with its radial part removed.
 */
function transversePolarisation(axis: Vec3, dir: Vec3): Vec3 {
  const project = (a: Vec3): Vec3 => {
    const radial = vDot(a, dir)
    return vSub(a, { x: dir.x * radial, y: dir.y * radial, z: dir.z * radial })
  }
  let perp = project(axis)
  let len = Math.hypot(perp.x, perp.y, perp.z)
  if (len < 1e-9) {
    // The axis is parallel to the propagation direction, so it defines no
    // transverse direction. A dipole genuinely radiates nothing along its axis
    // (the caller's gain is zero there anyway); for an isotropic radiator the
    // axis is only a polarisation seed, so fall back to any perpendicular one.
    const seed = Math.abs(dir.z) > 0.9 ? v3(1, 0, 0) : v3(0, 0, 1)
    perp = project(seed)
    len = Math.hypot(perp.x, perp.y, perp.z)
    if (len < 1e-9) return { x: 0, y: 0, z: 0 }
  }
  return { x: perp.x / len, y: perp.y / len, z: perp.z / len }
}

/** Un-normalised pattern: |F(theta)|^2 for the omni families. */
function omniPatternPower(spec: AntennaSpec, cosTheta: number): number {
  const c = Math.max(-1, Math.min(1, cosTheta))
  const sinTheta = Math.sqrt(Math.max(0, 1 - c * c))
  if (sinTheta < 1e-9) return 0

  const element = Math.pow(Math.cos((Math.PI / 2) * c) / sinTheta, 2)
  if (spec.kind === 'dipole') return element

  const n = Math.max(1, Math.round(spec.elements ?? 2))
  const d = spec.spacingLambda ?? 0.8
  // Uniform, in-phase feed (beta = 0): the broadside collinear omni.
  const psi = 2 * Math.PI * d * c
  const half = psi / 2
  const af =
    Math.abs(Math.sin(half)) < 1e-9 ? 1 : Math.sin(n * half) / (n * Math.sin(half))
  return element * af * af
}

/**
 * Peak-normalising factor turning the raw pattern into directivity:
 * D = 4*pi*|F|^2 / integral(|F|^2 dOmega). Integrated numerically over theta
 * (the omni families are azimuthally symmetric), cached per spec signature.
 */
const directivityCache = new Map<string, number>()

function omniDirectivityFactor(spec: AntennaSpec): number {
  const key = `${spec.kind}|${spec.elements ?? 0}|${spec.spacingLambda ?? 0}`
  const cached = directivityCache.get(key)
  if (cached !== undefined) return cached

  const steps = 2000
  let integral = 0
  for (let i = 0; i < steps; i++) {
    const theta = ((i + 0.5) / steps) * Math.PI
    integral += omniPatternPower(spec, Math.cos(theta)) * Math.sin(theta) * (Math.PI / steps)
  }
  // The azimuthal integral contributes 2*pi; D = 4*pi*|F|^2 / (2*pi*integral).
  const factor = integral > 0 ? 2 / integral : 0
  directivityCache.set(key, factor)
  return factor
}

/** 3GPP TR 38.901 Table 7.3-1 sector element pattern, dB relative to peak. */
function sectorPatternDb(spec: AntennaSpec, thetaDeg: number, phiDeg: number): number {
  const vBw = spec.vBeamwidthDeg ?? 65
  const hBw = spec.hBeamwidthDeg ?? 65
  const maxAtten = spec.frontToBackDb ?? 30
  const av = -Math.min(12 * Math.pow(thetaDeg / vBw, 2), maxAtten)
  const ah = -Math.min(12 * Math.pow(phiDeg / hBw, 2), maxAtten)
  return -Math.min(-(av + ah), maxAtten)
}

/** Evaluate the antenna towards a unit direction. */
export function evaluateAntenna(spec: AntennaSpec, dir: Vec3): AntennaResponse {
  const boresight = vNorm(spec.boresight)

  if (spec.kind === 'isotropic') {
    // No preferred axis; use the reference as the polarisation seed.
    return { gainLinear: 1, polarisation: transversePolarisation(vNorm(spec.reference), dir) }
  }

  if (spec.kind === 'sector') {
    const reference = vNorm(spec.reference)
    // Angles measured off the boresight, split into the two principal planes.
    const forward = vDot(dir, boresight)
    const side = vDot(dir, reference)
    const upAxis = vCross(boresight, reference)
    const vert = vDot(dir, upAxis)
    const thetaDeg = (Math.atan2(vert, Math.max(1e-9, forward)) * 180) / Math.PI
    const phiDeg = (Math.atan2(side, Math.max(1e-9, forward)) * 180) / Math.PI

    const peak = spec.peakGainDbi ?? 8
    const db = peak + sectorPatternDb(spec, thetaDeg, phiDeg)
    return {
      gainLinear: Math.pow(10, db / 10),
      polarisation: transversePolarisation(upAxis, dir),
    }
  }

  const cosTheta = vDot(dir, boresight)
  const power = omniPatternPower(spec, cosTheta)
  return {
    gainLinear: power * omniDirectivityFactor(spec),
    polarisation: transversePolarisation(boresight, dir),
  }
}

/** Peak gain in dBi, for display in the UI and the report. */
export function peakGainDbi(spec: AntennaSpec): number {
  if (spec.kind === 'isotropic') return 0
  if (spec.kind === 'sector') return spec.peakGainDbi ?? 8

  let peak = 0
  for (let i = 0; i <= 900; i++) {
    const c = Math.cos((i / 900) * Math.PI)
    peak = Math.max(peak, omniPatternPower(spec, c))
  }
  const d = peak * omniDirectivityFactor(spec)
  return d > 0 ? 10 * Math.log10(d) : -Infinity
}
