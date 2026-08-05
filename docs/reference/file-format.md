# Project file format

A `.wifisim` file is JSON. You can read it in a text editor, keep it in version
control and diff two variants of a plan.

The same shape is what the browser autosaves to IndexedDB, so an autosave slot
and an exported file are interchangeable.

## Top level

```json
{
  "format": "wifi-sim-project",
  "version": 1,
  "savedAt": "2025-08-05T09:41:22.104Z",
  "image": { "name": "...", "width": 2480, "height": 1754, "dataUrl": "data:image/png;base64,..." },
  "floorplan": { "params": {}, "walls": [], "calibration": {} },
  "model": { "scene": {}, "customMaterials": [], "transform": {} },
  "simulation": {}
}
```

`format` and `version` are checked on load. A file written by a newer version is
refused with a message rather than half-read.

`image` may be null if no floorplan was loaded. When present it is the scan
re-encoded as a PNG data URL, which is what makes these files large. A typical
project is 1 to 3 MB and almost all of it is this field.

## `floorplan`

Everything about turning the scan into wall lines.

- `params` is the full tracing configuration: the region of interest, exclude
  rectangles, the greyscale and levels settings, the threshold mode, the
  morphology radii and the vectorisation options. Saving these is what lets you
  reopen a project and continue tuning rather than starting over.
- `walls` is the traced result: line segments with a measured thickness each.
- `calibration` is the scale, as the two picked points and the real distance
  between them.

## `model`

- `scene` is the building: ceiling height, the wall type library, the walls with
  their openings, furniture, and which build-ups the floor and ceiling use.
- `customMaterials` are any materials you added. Each carries a provenance,
  which is what lets the exported report state where the number came from.
- `transform` maps plan pixels to metres for drawing.

### A wall

```json
{
  "id": "w3",
  "a": { "x": 0.0, "y": 0.0 },
  "b": { "x": 4.85, "y": 0.0 },
  "typeId": "brick-175-plastered",
  "baseM": 0,
  "topM": 2.5,
  "measuredThicknessM": 0.18,
  "openings": []
}
```

`measuredThicknessM` is informational. It is what the wall type was matched
against, and it lets you spot a wall whose assigned build-up disagrees with the
drawing.

### A wall type

```json
{
  "id": "brick-175-plastered",
  "name": "Brick 175 mm, plastered both sides",
  "colour": "#f97316",
  "layers": [
    { "materialId": "plasterboard", "thicknessM": 0.015 },
    { "materialId": "brick", "thicknessM": 0.175 },
    { "materialId": "plasterboard", "thicknessM": 0.015 }
  ]
}
```

Layers are ordered from the wall's a-side to its b-side. A layer may also carry:

- `coating`, a conductive film on its front face, given as
  `{ "sheetResistanceOhmPerSq": 5 }`. This is how low-emissivity glazing is
  described.
- `grid`, a conductive mesh at mid-depth, given as
  `{ "pitchM": 0.15, "wireRadiusM": 0.003 }`.

### An opening

```json
{
  "id": "o1",
  "kind": "window",
  "offsetM": 1.2,
  "widthM": 1.4,
  "sillM": 0.9,
  "headM": 2.1,
  "typeId": "glass-double-lowe-soft",
  "frameWidthM": 0.07,
  "frameTypeId": "frame-wood",
  "mullionCount": 1,
  "mullionWidthM": 0.05
}
```

`kind` is `window`, `door` or `passage`. `offsetM` is measured along the wall
from endpoint `a`. The frame is compiled as its own surfaces with its own
build-up, and mullions split the aperture into equal panes.

## `simulation`

Access points, the client, neighbouring networks, the regulatory domain, the
trace options, the MAC parameters, the combining mode, the grid resolution, the
evaluation height and the optimiser settings.

An access point carries its band, channel, width, generation, guard interval,
spatial streams, conducted power, cable loss, antenna spec, mounting and
enclosure loss.

## What is deliberately not saved

**The heatmap.** It can be several megabytes and it goes stale the moment any
setting changes. Pressing **Compute coverage** regenerates it in seconds, from
inputs that are all in the file, so nothing is lost.

## Compatibility

`version` is currently 1. If the format changes, older files will be migrated on
load rather than rejected. A file from a newer version than the app understands
is refused with a clear message, because silently ignoring fields it does not
know would be worse than saying so.

## Working with these files programmatically

The physics is plain TypeScript with no browser dependency, so a `.wifisim` file
can be driven from a script. `src/engine/solver.ts` exposes `solveGrid`, and the
`scene` object in the file is exactly what it expects. See
[architecture](/reference/architecture).
