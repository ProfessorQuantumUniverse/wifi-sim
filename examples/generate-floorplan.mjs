#!/usr/bin/env node
/*
 * Draws the example floorplan that ships with the project.
 *
 * It is generated rather than scanned so that it can be published without
 * anybody's real building in it, and so that it can be regenerated exactly.
 * It is deliberately not clean: it carries the dimension lines, hatching,
 * furniture symbols and lettering that make tracing a real plan awkward, so
 * that walking through the guide with it teaches the same thing a real drawing
 * would.
 *
 * Run:  node examples/generate-floorplan.mjs
 *
 * Copyright (C) 2025 Lorenzo Bay-Mueller. GPL-3.0-or-later.
 */

import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// --------------------------------------------------------------------------
// Canvas
// --------------------------------------------------------------------------

/** Pixels per metre. 100 makes a 1 px line 10 mm, thin against any wall. */
const PPM = 100
const MARGIN = 90
/** The dimension lines sit outside the building, so those two sides need more. */
const MARGIN_RIGHT = 260
const MARGIN_BOTTOM = 180
const PLAN_W = 11.0
const PLAN_H = 8.0

const WIDTH = Math.round(PLAN_W * PPM) + MARGIN + MARGIN_RIGHT
const HEIGHT = Math.round(PLAN_H * PPM) + MARGIN + MARGIN_BOTTOM

const pixels = new Uint8Array(WIDTH * HEIGHT).fill(255)

const px = (metres) => Math.round(metres * PPM) + MARGIN

/**
 * Ink only ever darkens, so overlapping strokes behave the way they do on
 * paper. Cutting an opening back out of a wall is the one operation that has
 * to overwrite, which is what `force` is for.
 */
function setPixel(x, y, value, force = false) {
  if (x < 0 || y < 0 || x >= WIDTH || y >= HEIGHT) return
  const i = y * WIDTH + x
  if (force || value < pixels[i]) pixels[i] = value
}

/** Filled rectangle in metres. */
function rect(x0, y0, x1, y1, value = 0, force = false) {
  const ax = px(Math.min(x0, x1))
  const ay = px(Math.min(y0, y1))
  const bx = px(Math.max(x0, x1))
  const by = px(Math.max(y0, y1))
  for (let y = ay; y < by; y++) for (let x = ax; x < bx; x++) setPixel(x, y, value, force)
}

/** Erase a rectangle back to paper, for cutting an opening out of a wall. */
const clear = (x0, y0, x1, y1) => rect(x0, y0, x1, y1, 255, true)

/** Line of a given width in metres, drawn in pixel space. */
function linePx(x0, y0, x1, y1, widthPx = 1, value = 0) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1)
  const half = (widthPx - 1) / 2
  for (let s = 0; s <= steps; s++) {
    const x = Math.round(x0 + ((x1 - x0) * s) / steps)
    const y = Math.round(y0 + ((y1 - y0) * s) / steps)
    for (let dy = -Math.floor(half); dy <= Math.ceil(half); dy++) {
      for (let dx = -Math.floor(half); dx <= Math.ceil(half); dx++) {
        setPixel(x + dx, y + dy, value)
      }
    }
  }
}

const line = (x0, y0, x1, y1, widthPx = 1, value = 0) =>
  linePx(px(x0), px(y0), px(x1), px(y1), widthPx, value)

function arc(cx, cy, radius, fromRad, toRad, value = 90) {
  const steps = Math.max(24, Math.round(radius * PPM))
  for (let s = 0; s <= steps; s++) {
    const a = fromRad + ((toRad - fromRad) * s) / steps
    setPixel(px(cx + radius * Math.cos(a)), px(cy + radius * Math.sin(a)), value)
  }
}

/** Diagonal hatching inside a rectangle, the kind used for tiled areas. */
function hatch(x0, y0, x1, y1, spacingM = 0.16, value = 110) {
  const span = (x1 - x0) + (y1 - y0)
  for (let o = 0; o < span; o += spacingM) {
    const ax = x0 + o
    const ay = y0
    const bx = x0
    const by = y0 + o
    // Clip the 45 degree line to the rectangle.
    const cx = Math.min(ax, x1)
    const cy = ay + (ax - cx)
    const dx = Math.min(bx + (by - y1 > 0 ? by - y1 : 0), x1)
    const dy = Math.min(by, y1)
    if (cy > y1 || dx > x1) continue
    line(cx, cy, dx, dy, 1, value)
  }
}

// --------------------------------------------------------------------------
// A 5x7 stencil font, enough for room labels and a dimension figure
// --------------------------------------------------------------------------

/**
 * Written out as explicit rows. A single flat string per glyph is shorter and
 * is also impossible to check by eye, which is how you end up with a plan that
 * says BFD 1.
 */
const GLYPHS = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  G: ['.####', '#....', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#.#.#', '#..##', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  '0': ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  '1': ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  '2': ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  '4': ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  '8': ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
}

function text(str, xM, yM, scale = 3, value = 40) {
  let cursor = px(xM)
  const top = px(yM)
  for (const ch of str.toUpperCase()) {
    const glyph = GLYPHS[ch]
    if (!glyph) {
      cursor += 4 * scale
      continue
    }
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 5; c++) {
        if (glyph[r][c] !== '#') continue
        for (let dy = 0; dy < scale; dy++) {
          for (let dx = 0; dx < scale; dx++) {
            setPixel(cursor + c * scale + dx, top + r * scale + dy, value)
          }
        }
      }
    }
    cursor += 6 * scale
  }
}

// --------------------------------------------------------------------------
// The flat
// --------------------------------------------------------------------------

const EXT = 0.3 // exterior wall thickness, m
const INT = 0.12 // partition thickness, m
const LOAD = 0.175 // internal load-bearing wall, m

// Exterior shell, drawn as four solid bands.
rect(0, 0, PLAN_W, EXT)
rect(0, PLAN_H - EXT, PLAN_W, PLAN_H)
rect(0, 0, EXT, PLAN_H)
rect(PLAN_W - EXT, 0, PLAN_W, PLAN_H)

// Internal load-bearing wall running the full depth at x = 6.4.
rect(6.4, EXT, 6.4 + LOAD, PLAN_H - EXT)

// Partitions.
rect(EXT, 4.6, 6.4, 4.6 + INT) // living room from bedroom corridor
rect(3.1, 4.6 + INT, 3.1 + INT, PLAN_H - EXT) // between the two bedrooms
rect(6.4 + LOAD, 3.4, PLAN_W - EXT, 3.4 + INT) // kitchen from bathroom
rect(8.8, 3.4 + INT, 8.8 + INT, PLAN_H - EXT) // bathroom from utility

// --------------------------------------------------------------------------
// Openings, cut back out of the walls, with their door swings
// --------------------------------------------------------------------------

/** Cut an opening and draw its leaf and swing arc. */
function door(x0, y0, x1, y1, hinge, swing) {
  clear(x0, y0, x1, y1)
  const horizontal = x1 - x0 > y1 - y0
  const width = horizontal ? x1 - x0 : y1 - y0
  const [hx, hy] = hinge
  line(hx, hy, hx + swing[0] * width, hy + swing[1] * width, 2, 60)
  const start = Math.atan2(swing[1], swing[0])
  arc(hx, hy, width, start, start + Math.PI / 2, 120)
}

// Living room to hall.
door(6.4, 1.5, 6.4 + LOAD, 2.4, [6.4, 2.4], [-1, 0])
// Bedroom one.
door(1.3, 4.6, 2.2, 4.6 + INT, [1.3, 4.6], [0, -1])
// Bedroom two.
door(4.4, 4.6, 5.3, 4.6 + INT, [4.4, 4.6], [0, -1])
// Bathroom.
door(7.6, 3.4, 8.4, 3.4 + INT, [7.6, 3.4], [0, -1])
// Front door in the exterior wall, clear of the kitchen units.
clear(PLAN_W - EXT, 2.4, PLAN_W, 3.3)
line(PLAN_W - EXT, 3.3, PLAN_W, 3.3, 2, 60)
arc(PLAN_W - EXT, 3.3, 0.9, Math.PI, 1.5 * Math.PI, 120)

// Windows, drawn the way plans draw them: the wall band replaced by a pair of
// thin lines across the reveal.
function window(x0, y0, x1, y1) {
  clear(x0, y0, x1, y1)
  const horizontal = x1 - x0 > y1 - y0
  if (horizontal) {
    line(x0, y0 + (y1 - y0) * 0.32, x1, y0 + (y1 - y0) * 0.32, 2, 50)
    line(x0, y0 + (y1 - y0) * 0.68, x1, y0 + (y1 - y0) * 0.68, 2, 50)
    line(x0, y0, x0, y1, 2, 50)
    line(x1, y0, x1, y1, 2, 50)
  } else {
    line(x0 + (x1 - x0) * 0.32, y0, x0 + (x1 - x0) * 0.32, y1, 2, 50)
    line(x0 + (x1 - x0) * 0.68, y0, x0 + (x1 - x0) * 0.68, y1, 2, 50)
    line(x0, y0, x1, y0, 2, 50)
    line(x0, y1, x1, y1, 2, 50)
  }
}

window(1.2, 0, 3.0, EXT) // living room, north
window(4.0, 0, 5.6, EXT) // living room, north
window(8.0, 0, 9.8, EXT) // kitchen, north
window(1.0, PLAN_H - EXT, 2.4, PLAN_H) // bedroom one, south
window(4.0, PLAN_H - EXT, 5.4, PLAN_H) // bedroom two, south
window(0, 2.0, EXT, 3.6) // living room, west
window(PLAN_W - EXT, 5.0, PLAN_W, 6.4) // utility, east

// --------------------------------------------------------------------------
// The clutter a real plan carries
// --------------------------------------------------------------------------

// Tiled floors, hatched.
hatch(6.4 + LOAD + 0.05, EXT + 0.05, PLAN_W - EXT - 0.05, 3.35)
hatch(6.4 + LOAD + 0.05, 3.6, 8.75, PLAN_H - EXT - 0.05)

// Furniture, all in thin strokes.
const box = (x0, y0, x1, y1, value = 100) => {
  line(x0, y0, x1, y0, 2, value)
  line(x1, y0, x1, y1, 2, value)
  line(x1, y1, x0, y1, 2, value)
  line(x0, y1, x0, y0, 2, value)
}
box(0.6, 0.6, 2.6, 1.5) // sofa
box(3.4, 1.2, 4.6, 2.6) // table
box(0.5, 5.4, 2.0, 7.4) // bed one
box(3.5, 5.4, 5.0, 7.4) // bed two
box(7.0, 0.6, 8.0, 1.2) // kitchen units
box(8.2, 0.6, 9.4, 1.2)
box(9.6, 0.6, 10.5, 1.6) // fridge
box(7.0, 4.0, 7.8, 4.8) // bath
box(8.0, 4.0, 8.5, 4.5) // basin

// Room labels.
text('LIVING', 1.0, 3.2, 3)
text('BED 1', 1.0, 5.0, 3)
text('BED 2', 3.9, 5.0, 3)
text('KITCHEN', 6.9, 2.4, 3)
text('BATH', 6.9, 5.4, 3)
text('UTIL', 9.2, 4.2, 3)

// --------------------------------------------------------------------------
// The dimension line, which is the whole point of publishing this
// --------------------------------------------------------------------------

const DIM_Y = PLAN_H + 0.45
line(0, DIM_Y, PLAN_W, DIM_Y, 1, 70)
line(0, DIM_Y - 0.12, 0, DIM_Y + 0.12, 1, 70)
line(PLAN_W, DIM_Y - 0.12, PLAN_W, DIM_Y + 0.12, 1, 70)
// Extension lines up to the building.
line(0, PLAN_H, 0, DIM_Y, 1, 140)
line(PLAN_W, PLAN_H, PLAN_W, DIM_Y, 1, 140)
text('11.00 M', 4.7, DIM_Y + 0.12, 3, 70)

// A second, vertical dimension, so there is a choice of what to scale from.
const DIM_X = PLAN_W + 0.42
line(DIM_X, 0, DIM_X, PLAN_H, 1, 70)
line(DIM_X - 0.12, 0, DIM_X + 0.12, 0, 1, 70)
line(DIM_X - 0.12, PLAN_H, DIM_X + 0.12, PLAN_H, 1, 70)
line(PLAN_W, 0, DIM_X, 0, 1, 140)
line(PLAN_W, PLAN_H, DIM_X, PLAN_H, 1, 140)
// Not rotated, so it is set beside the line rather than along it.
text('8.00 M', DIM_X + 0.12, PLAN_H / 2 - 0.11, 2, 70)

// --------------------------------------------------------------------------
// PNG encoding
// --------------------------------------------------------------------------

function crc32(buf) {
  let c
  const table = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const byte of buf) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

// Greyscale, 8 bit, one filter byte per scanline.
const raw = Buffer.alloc((WIDTH + 1) * HEIGHT)
for (let y = 0; y < HEIGHT; y++) {
  raw[y * (WIDTH + 1)] = 0
  for (let x = 0; x < WIDTH; x++) raw[y * (WIDTH + 1) + 1 + x] = pixels[y * WIDTH + x]
}

const ihdr = Buffer.alloc(13)
ihdr.writeUInt32BE(WIDTH, 0)
ihdr.writeUInt32BE(HEIGHT, 4)
ihdr[8] = 8 // bit depth
ihdr[9] = 0 // greyscale
ihdr[10] = 0
ihdr[11] = 0
ihdr[12] = 0

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
])

// Written into public/ so the built app serves it too, which means the guide
// can link straight to a floorplan the reader can load and follow along with.
const out = fileURLToPath(new URL('../public/example-floorplan.png', import.meta.url))
writeFileSync(out, png)
console.log(`${out}  ${WIDTH}x${HEIGHT}  ${(png.length / 1024).toFixed(0)} kB`)
console.log(`Scale: the printed overall dimension is ${PLAN_W.toFixed(2)} m.`)
