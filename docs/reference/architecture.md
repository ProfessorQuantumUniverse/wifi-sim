# Architecture

TypeScript, React, Vite, Zustand. No runtime dependencies beyond those, no
network calls, and no build step needed to read the physics.

## Where things live

```
src/
  physics/     the electromagnetics. No React, no browser, no state.
  engine/      geometry, ray tracing, link budget, planning.
  floorplan/   scan to wall segments.
  scene/       the editable building model.
  state/       Zustand stores and persistence.
  ui/          React components.
tests/         the validation suite.
docs/          this documentation.
```

The important boundary is that **`physics/` and `engine/` know nothing about the
browser**. They are plain functions over plain data. That is what makes the
validation suite possible, and it is what would make a headless or command-line
version straightforward.

## The layers, bottom up

### `physics/`

| File | What it does |
| --- | --- |
| `complex.ts` | complex arithmetic, as plain objects so it stays debuggable |
| `materials.ts` | the ITU-R P.2040 table and evaluation at a frequency |
| `layerStack.ts` | the transfer matrix that solves a build-up |
| `coatings.ts` | low-emissivity presets and the resistive sheet closed form |
| `wireGrid.ts` | conductive mesh, and the validity reporting |
| `utd.ts` | the diffraction coefficient |
| `antenna.ts` | radiation patterns and polarisation vectors |

### `engine/`

| File | What it does |
| --- | --- |
| `geometry.ts` | vectors, ray and rectangle intersection, the bounding volume hierarchy |
| `tracer.ts` | path enumeration and the field carried along each one |
| `solver.ts` | the editable scene into a traceable one, and the grid sweep |
| `linkBudget.ts` | noise, sensitivity, rates, MAC efficiency, regulatory limits |
| `planning.ts` | neighbours, channel ranking, placement search |
| `mounting.ts` | installation presets |
| `engine.worker.ts` | runs the grid solve off the main thread |

### `floorplan/`

The image pipeline, in one place so the worker and any future headless use share
exactly the same ordering of operations.

`imageOps.ts` does greyscale, levels, blur and thresholding. `edt.ts` does the
distance transform and the morphological open and close. `skeleton.ts` thins the
mask. `vectorize.ts` turns centrelines into wall segments with thicknesses.
`pipeline.ts` sequences all of it.

### `scene/`

`model.ts` holds the editable building and compiles it into the flat surface list
the engine consumes. The interesting part is `panelsForWall`, which cuts a wall
face into a non-overlapping set of rectangles around any arrangement of openings
using a guillotine subdivision, so no general polygon clipping library is needed.

`defaults.ts` is the starter build-up library.

### `state/`

Three Zustand stores: the floorplan, the scene and the simulation. `persistence.ts`
serialises all three to the project format and back, and runs the debounced
autosave into IndexedDB.

### `ui/`

React components. `PlanCanvas` draws the floorplan, mask and heatmap;
`SceneCanvas` draws the compiled model; the panels are the step-by-step sidebar.
`report.ts` generates the self-contained HTML export.

## The two workers

Both the wall tracing and the coverage solve run in Web Workers, so a long
computation does not freeze the interface.

This is the reason the app cannot be shipped as a single double-clickable HTML
file: browsers refuse to start a worker on a page loaded from the file system.
See [ways to run it](/guide/install).

The single-point probe deliberately runs on the main thread instead. One point
costs a scene build and one path solve, which is fast enough that a round trip
through a worker would add more latency than it saves.

## Data flow

```
image ─▶ floorplan worker ─▶ traced walls ─▶ Scene
                                                │
                                    compileScene│
                                                ▼
                                          Surface[]
                                                │
                                     buildFacets│ + BVH + stack tables
                                                ▼
                                          TraceScene
                                                │
                                      tracePaths│ per grid point, per AP
                                                ▼
                                      PropagationPath[]
                                                │
                                    coherent or │ incoherent sum
                                                ▼
                                      RSSI ─▶ SINR ─▶ MCS ─▶ rate ─▶ throughput
```

A `TraceScene` is built per access point, because the stack coefficient tables
are frequency specific and each access point may be on a different channel.

## Performance notes

The cost of a solve is the number of grid cells times the number of paths per
cell. The things that move it, in order:

- **Grid resolution.** Quadratic. Going from 0.35 m to 0.5 m is roughly a factor
  of two.
- **Reflection order.** Second order is quadratic in the number of surfaces
  considered, which is why there is a cap and why the cap is applied to the
  largest surfaces first.
- **Number of access points.** Linear, and each one needs its own `TraceScene`.
- **Dynamic range.** Trimming at 35 dB instead of 45 dB drops a good number of
  paths that cannot move the sum.

Stack coefficients are tabulated once per build-up per frequency, over 181
incidence bins, and interpolated. The
[validation suite](/reference/validation) bounds the resulting interpolation
error at better than 0.02 dB, by comparing the traced two-ray result against one
computed from the exact coefficient.

## Building on it

The engine has no browser dependency, so it can be driven from a script:

```ts
import { solveGrid, DEFAULT_CLIENT } from './src/engine/solver'
import { DEFAULT_TRACE_OPTIONS } from './src/engine/tracer'
import { DEFAULT_MAC } from './src/engine/linkBudget'

const result = solveGrid(scene, [], [accessPoint], DEFAULT_CLIENT, gridSpec, {
  domain: 'etsi',
  trace: DEFAULT_TRACE_OPTIONS,
  mac: DEFAULT_MAC,
  combining: 'incoherent',
  externalSources: [],
})
```

`scene` is exactly the object stored under `model.scene` in a `.wifisim` file,
so a saved project can be loaded and swept from a script. See
[project file format](/reference/file-format), and `tests/scene.test.ts` for a
worked example.
