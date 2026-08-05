/**
 * Shared fixtures for the validation suite.
 *
 * The tests below check the engine against results that can be worked out on
 * paper: Friis, the two-ray ground model, Brewster's angle, the half-strength
 * field on a shadow boundary, the 802.11 rate tables. Anything that needs the
 * engine to agree with itself rather than with an outside reference is not a
 * validation, so those cases are limited to invariants that must hold for any
 * correct implementation, such as reciprocity and energy conservation.
 */

import type { AntennaSpec } from '../src/physics/antenna'
import type { Scene, Surface } from '../src/scene/model'
import type { StackLayer } from '../src/physics/layerStack'
import type { MaterialDefinition } from '../src/physics/materials'
import { buildMaterialMap } from '../src/engine/solver'

export const C_LIGHT = 299792458

export const materials = buildMaterialMap([])

/** dB from a linear power ratio. */
export const toDb = (linear: number): number => 10 * Math.log10(linear)

/** Free-space path gain (Friis, unity antennas) as a linear power ratio. */
export function friisGain(distanceM: number, freqHz: number): number {
  const lambda = C_LIGHT / freqHz
  return Math.pow(lambda / (4 * Math.PI * distanceM), 2)
}

/**
 * Isotropic antenna whose polarisation seed is the y axis. Every test geometry
 * here lies in the xz plane, so the radiated field comes out exactly along y,
 * which keeps the reference calculations pure TE and free of any polarisation
 * bookkeeping.
 */
export const ISOTROPIC_Y: AntennaSpec = {
  kind: 'isotropic',
  boresight: { x: 0, y: 0, z: 1 },
  reference: { x: 0, y: 1, z: 0 },
}

export const VERTICAL_DIPOLE: AntennaSpec = {
  kind: 'dipole',
  boresight: { x: 0, y: 0, z: 1 },
  reference: { x: 1, y: 0, z: 0 },
}

/** A large horizontal plane at z = 0, normal pointing up. */
export function groundPlane(typeId: string, halfSizeM = 400): Surface {
  const L = halfSizeM
  return {
    id: 'ground',
    role: 'floor',
    typeId,
    sourceId: 'ground',
    p0: { x: -L, y: -L, z: 0 },
    p1: { x: L, y: -L, z: 0 },
    p2: { x: L, y: L, z: 0 },
    p3: { x: -L, y: L, z: 0 },
    normal: { x: 0, y: 0, z: 1 },
  }
}

/**
 * A single straight wall with both ends free, which is the closest thing the
 * scene model has to a half-plane screen. Drawn along y so the scene has no
 * extent in x, which stops `compileScene` from adding a floor and a ceiling and
 * leaves the wall as the only surface in the trace.
 */
export function screenScene(layers: StackLayer[], lengthM = 30, reversed = false): Scene {
  const a = { x: 0, y: 0 }
  const b = { x: 0, y: lengthM }
  return {
    ceilingHeightM: 2.5,
    wallTypes: [{ id: 'screen', name: 'Test screen', colour: '#000000', layers }],
    walls: [
      {
        id: 'w1',
        a: reversed ? b : a,
        b: reversed ? a : b,
        typeId: 'screen',
        baseM: 0,
        topM: 2.5,
        openings: [],
      },
    ],
    furniture: [],
    floorTypeId: 'screen',
    ceilingTypeId: 'screen',
  }
}

/** A lossless dielectric, for the tests that need exact energy conservation. */
export function lossless(id: string, epsR: number): MaterialDefinition {
  return {
    id,
    name: `Lossless eps_r = ${epsR}`,
    a: epsR,
    b: 0,
    c: 0,
    d: 0,
    fMinGHz: 0.001,
    fMaxGHz: 100,
    provenance: { kind: 'user', note: 'test fixture' },
  }
}

export const WIFI_FREQUENCIES = [2.412e9, 2.442e9, 5.18e9, 5.5e9, 5.745e9, 6.115e9]
