/**
 * The building model, and one whole run through the solver.
 *
 * A wall with a window in it is cut into a solid remainder, a frame ring,
 * mullions and panes. If that subdivision leaks, the engine sees a hole that
 * nobody drew and the map quietly becomes optimistic, which is exactly the
 * failure the whole project exists to avoid. Area is the invariant that catches
 * it: the panels must tile the wall face exactly, no gaps and no overlaps.
 *
 * The end-to-end test at the bottom is deliberately small. It is not a physics
 * check, it is a check that all the parts still fit together and that a room
 * with a router in it produces a map with plausible numbers in it.
 */

import { describe, expect, test } from 'vitest'
import { compileScene, sceneBounds, type Scene, type SceneWall } from '../src/scene/model'
import { solveGrid, DEFAULT_CLIENT, type AccessPointConfig } from '../src/engine/solver'
import { DEFAULT_TRACE_OPTIONS } from '../src/engine/tracer'
import { DEFAULT_MAC } from '../src/engine/linkBudget'
import { DEFAULT_WALL_TYPES, DEFAULT_SCENE_DEFAULTS } from '../src/scene/defaults'
import { VERTICAL_DIPOLE } from '../src/physics/antenna'

function surfaceArea(p0: { x: number; y: number; z: number }, p1: typeof p0, p3: typeof p0): number {
  const e1 = Math.hypot(p1.x - p0.x, p1.y - p0.y, p1.z - p0.z)
  const e2 = Math.hypot(p3.x - p0.x, p3.y - p0.y, p3.z - p0.z)
  return e1 * e2
}

function wallWith(openings: SceneWall['openings']): Scene {
  return {
    ceilingHeightM: 2.5,
    wallTypes: DEFAULT_WALL_TYPES,
    walls: [
      {
        id: 'w',
        a: { x: 0, y: 0 },
        b: { x: 5, y: 0 },
        typeId: 'brick-175-plastered',
        baseM: 0,
        topM: 2.5,
        openings,
      },
    ],
    furniture: [],
    floorTypeId: DEFAULT_SCENE_DEFAULTS.floorTypeId,
    ceilingTypeId: DEFAULT_SCENE_DEFAULTS.ceilingTypeId,
  }
}

const makeWindow = (over: Partial<SceneWall['openings'][number]> = {}): SceneWall['openings'][number] => ({
  id: 'o1',
  kind: 'window',
  offsetM: 1.5,
  widthM: 1.2,
  sillM: 0.9,
  headM: 2.1,
  typeId: 'glass-double-lowe-soft',
  frameWidthM: 0.07,
  frameTypeId: 'frame-wood',
  mullionCount: 0,
  mullionWidthM: 0.05,
  ...over,
})

describe('a wall face is tiled exactly by its panels', () => {
  const WALL_AREA = 5 * 2.5

  test.each([
    ['no openings', []],
    ['one window', [makeWindow()]],
    ['a window with two mullions', [makeWindow({ mullionCount: 2 })]],
    ['a frameless passage', [makeWindow({ frameWidthM: 0, typeId: 'air' })]],
    [
      'a window and a door',
      [
        makeWindow(),
        makeWindow({
          id: 'o2',
          kind: 'door',
          offsetM: 3.4,
          widthM: 0.9,
          sillM: 0,
          headM: 2.05,
          typeId: 'door-wood-40',
        }),
      ],
    ],
    [
      'two windows sharing a height band',
      [makeWindow({ offsetM: 0.4 }), makeWindow({ id: 'o2', offsetM: 3.0 })],
    ],
  ] as Array<[string, SceneWall['openings']]>)('%s', (_name, openings) => {
    const surfaces = compileScene(wallWith(openings)).filter((s) => s.sourceId === 'w')
    const total = surfaces.reduce((sum, s) => sum + surfaceArea(s.p0, s.p1, s.p3), 0)
    expect(total).toBeCloseTo(WALL_AREA, 6)
  })

  test('an opening actually produces glass, a frame and mullions', () => {
    const surfaces = compileScene(wallWith([makeWindow({ mullionCount: 2 })])).filter(
      (s) => s.sourceId === 'w',
    )
    const roles = surfaces.map((s) => s.role)
    expect(roles).toContain('wall')
    expect(roles).toContain('frame')
    expect(roles).toContain('opening')
    expect(roles.filter((r) => r === 'mullion')).toHaveLength(2)
    expect(roles.filter((r) => r === 'opening')).toHaveLength(3)

    const glass = surfaces.filter((s) => s.role === 'opening')
    for (const pane of glass) {
      expect(pane.typeId).toBe('glass-double-lowe-soft')
    }
  })

  test('an opening larger than its wall is clamped instead of overflowing', () => {
    const surfaces = compileScene(
      wallWith([makeWindow({ offsetM: -1, widthM: 12, sillM: -1, headM: 9 })]),
    ).filter((s) => s.sourceId === 'w')
    const total = surfaces.reduce((sum, s) => sum + surfaceArea(s.p0, s.p1, s.p3), 0)
    expect(total).toBeCloseTo(WALL_AREA, 6)
  })

  test('no surface is degenerate', () => {
    const surfaces = compileScene(wallWith([makeWindow({ mullionCount: 3 })]))
    for (const s of surfaces) {
      expect(surfaceArea(s.p0, s.p1, s.p3)).toBeGreaterThan(0)
      const n = Math.hypot(s.normal.x, s.normal.y, s.normal.z)
      expect(n).toBeCloseTo(1, 9)
    }
  })
})

describe('a whole solve', () => {
  /** A four metre by three metre room with one internal partition. */
  function room(): Scene {
    const walls: SceneWall[] = [
      [
        { x: 0, y: 0 },
        { x: 6, y: 0 },
      ],
      [
        { x: 6, y: 0 },
        { x: 6, y: 4 },
      ],
      [
        { x: 6, y: 4 },
        { x: 0, y: 4 },
      ],
      [
        { x: 0, y: 4 },
        { x: 0, y: 0 },
      ],
      [
        { x: 3, y: 0 },
        { x: 3, y: 4 },
      ],
    ].map(([a, b], i) => ({
      id: `w${i}`,
      a,
      b,
      typeId: i === 4 ? 'drywall-stud' : 'brick-240-plastered',
      baseM: 0,
      topM: 2.5,
      openings:
        i === 4
          ? [
              {
                id: 'door',
                kind: 'door' as const,
                offsetM: 1.4,
                widthM: 0.9,
                sillM: 0,
                headM: 2.05,
                typeId: 'door-wood-40',
                frameWidthM: 0.06,
                frameTypeId: 'frame-wood',
                mullionCount: 0,
                mullionWidthM: 0,
              },
            ]
          : [],
    }))

    return {
      ceilingHeightM: 2.5,
      wallTypes: DEFAULT_WALL_TYPES,
      walls,
      furniture: [],
      floorTypeId: DEFAULT_SCENE_DEFAULTS.floorTypeId,
      ceilingTypeId: DEFAULT_SCENE_DEFAULTS.ceilingTypeId,
    }
  }

  const accessPoint: AccessPointConfig = {
    id: 'ap',
    name: 'Test AP',
    x: 1.5,
    y: 2,
    heightM: 1.8,
    enabled: true,
    band: '5',
    channel: 36,
    widthMHz: 80,
    generation: 'he',
    guardIntervalUs: 0.8,
    spatialStreams: 2,
    conductedPowerDbm: 15,
    cableLossDb: 0,
    antenna: VERTICAL_DIPOLE,
    mounting: 'shelf-top',
    enclosureLossDb: 0,
  }

  test('produces a map with plausible numbers everywhere in the room', () => {
    const scene = room()
    const bounds = sceneBounds(scene)!
    const result = solveGrid(
      scene,
      [],
      [accessPoint],
      DEFAULT_CLIENT,
      { ...bounds, resolutionM: 0.5, heightM: 1.1 },
      {
        domain: 'etsi',
        trace: { ...DEFAULT_TRACE_OPTIONS, maxReflectionOrder: 1 },
        mac: DEFAULT_MAC,
        combining: 'incoherent',
        externalSources: [],
      },
    )

    expect(result.cols).toBeGreaterThan(5)
    expect(result.rows).toBeGreaterThan(3)

    let served = 0
    for (let i = 0; i < result.rssiDbm.length; i++) {
      if (result.bestAp[i] < 0) continue
      served++
      // Nothing may exceed the transmitted power, and nothing served may be
      // below the weakest usable signal.
      expect(result.rssiDbm[i]).toBeLessThan(accessPoint.conductedPowerDbm)
      expect(result.rssiDbm[i]).toBeGreaterThan(-100)
      expect(result.mcs[i]).toBeGreaterThanOrEqual(0)
      expect(result.mcs[i]).toBeLessThanOrEqual(11)
      expect(result.throughputMbps[i]).toBeLessThan(result.phyRateMbps[i])
      expect(Number.isFinite(result.sinrDb[i])).toBe(true)
    }
    // A six by four metre flat with one router in it is covered.
    expect(served / result.rssiDbm.length).toBeGreaterThan(0.9)
  })

  test('the far room is weaker than the near room', () => {
    const scene = room()
    const bounds = sceneBounds(scene)!
    const result = solveGrid(
      scene,
      [],
      [accessPoint],
      DEFAULT_CLIENT,
      { ...bounds, resolutionM: 0.5, heightM: 1.1 },
      {
        domain: 'etsi',
        trace: { ...DEFAULT_TRACE_OPTIONS, maxReflectionOrder: 1 },
        mac: DEFAULT_MAC,
        combining: 'incoherent',
        externalSources: [],
      },
    )

    const at = (x: number, y: number) => {
      const col = Math.round((x - bounds.minX) / 0.5)
      const row = Math.round((y - bounds.minY) / 0.5)
      return result.rssiDbm[row * result.cols + col]
    }

    // Same distance from the router, but one side of the partition each.
    expect(at(1.5, 3.5)).toBeGreaterThan(at(4.5, 3.5))
  })

  test('a disabled access point contributes nothing', () => {
    const scene = room()
    const bounds = sceneBounds(scene)!
    const result = solveGrid(
      scene,
      [],
      [{ ...accessPoint, enabled: false }],
      DEFAULT_CLIENT,
      { ...bounds, resolutionM: 1, heightM: 1.1 },
      {
        domain: 'etsi',
        trace: DEFAULT_TRACE_OPTIONS,
        mac: DEFAULT_MAC,
        combining: 'incoherent',
        externalSources: [],
      },
    )
    expect([...result.bestAp].every((a) => a === -1)).toBe(true)
  })
})
