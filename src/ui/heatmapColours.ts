import type { HeatmapData, HeatmapLayer } from '../state/simStore'

export interface ScaleStop {
  /** Lower bound of the band; the first entry is the "worse than" catch-all. */
  from: number
  colour: [number, number, number]
  label: string
}

/**
 * Banded scales rather than a continuous gradient: coverage decisions are made
 * against thresholds ("is it above -67 dBm?"), and a band edge is far easier to
 * read off a map than a hue shift. Bands are listed worst-first.
 */
export const SCALES: Record<Exclude<HeatmapLayer, 'bestAp'>, ScaleStop[]> = {
  rssi: [
    { from: -Infinity, colour: [69, 10, 30], label: '< −85 dBm — no usable link' },
    { from: -85, colour: [136, 19, 55], label: '−85 … −80' },
    { from: -80, colour: [190, 24, 93], label: '−80 … −75' },
    { from: -75, colour: [217, 70, 39], label: '−75 … −70' },
    { from: -70, colour: [234, 138, 35], label: '−70 … −67  (VoIP floor)' },
    { from: -67, colour: [234, 190, 45], label: '−67 … −60  (reliable data)' },
    { from: -60, colour: [163, 200, 60], label: '−60 … −55' },
    { from: -55, colour: [74, 190, 100], label: '−55 … −45  (very good)' },
    { from: -45, colour: [16, 160, 140], label: '> −45 dBm — excellent' },
  ],
  sinr: [
    { from: -Infinity, colour: [69, 10, 30], label: '< 5 dB — below MCS0' },
    { from: 5, colour: [166, 30, 60], label: '5 … 10' },
    { from: 10, colour: [217, 70, 39], label: '10 … 15' },
    { from: 15, colour: [234, 138, 35], label: '15 … 21' },
    { from: 21, colour: [234, 190, 45], label: '21 … 27' },
    { from: 27, colour: [163, 200, 60], label: '27 … 32' },
    { from: 32, colour: [74, 190, 100], label: '32 … 39' },
    { from: 39, colour: [16, 160, 140], label: '> 39 dB — MCS11 capable' },
  ],
  mcs: [
    { from: -Infinity, colour: [50, 12, 28], label: 'no link' },
    { from: 0, colour: [136, 19, 55], label: 'MCS 0–1  BPSK/QPSK' },
    { from: 2, colour: [200, 55, 50], label: 'MCS 2–3' },
    { from: 4, colour: [234, 138, 35], label: 'MCS 4–5  16/64-QAM' },
    { from: 6, colour: [234, 190, 45], label: 'MCS 6–7  64-QAM' },
    { from: 8, colour: [130, 195, 75], label: 'MCS 8–9  256-QAM' },
    { from: 10, colour: [16, 160, 140], label: 'MCS 10–11  1024-QAM' },
  ],
  phyRate: [
    { from: -Infinity, colour: [50, 12, 28], label: 'no link' },
    { from: 1, colour: [136, 19, 55], label: '< 50 Mb/s' },
    { from: 50, colour: [200, 55, 50], label: '50 … 150' },
    { from: 150, colour: [234, 138, 35], label: '150 … 350' },
    { from: 350, colour: [234, 190, 45], label: '350 … 600' },
    { from: 600, colour: [130, 195, 75], label: '600 … 900' },
    { from: 900, colour: [16, 160, 140], label: '> 900 Mb/s' },
  ],
  throughput: [
    { from: -Infinity, colour: [50, 12, 28], label: 'no link' },
    { from: 1, colour: [136, 19, 55], label: '< 25 Mb/s' },
    { from: 25, colour: [200, 55, 50], label: '25 … 80' },
    { from: 80, colour: [234, 138, 35], label: '80 … 200' },
    { from: 200, colour: [234, 190, 45], label: '200 … 400' },
    { from: 400, colour: [130, 195, 75], label: '400 … 700' },
    { from: 700, colour: [16, 160, 140], label: '> 700 Mb/s' },
  ],
}

/** Distinct hues for the best-serving-AP layer. */
export const AP_COLOURS: Array<[number, number, number]> = [
  [56, 189, 248],
  [244, 114, 182],
  [163, 230, 53],
  [251, 146, 60],
  [167, 139, 250],
  [45, 212, 191],
  [250, 204, 21],
  [248, 113, 113],
]

function bandFor(stops: ScaleStop[], value: number): [number, number, number] {
  let colour = stops[0].colour
  for (const s of stops) {
    if (value >= s.from) colour = s.colour
    else break
  }
  return colour
}

export function layerValues(data: HeatmapData, layer: HeatmapLayer): ArrayLike<number> {
  switch (layer) {
    case 'rssi':
      return data.rssiDbm
    case 'sinr':
      return data.sinrDb
    case 'mcs':
      return data.mcs
    case 'phyRate':
      return data.phyRateMbps
    case 'throughput':
      return data.throughputMbps
    case 'bestAp':
      return data.bestAp
  }
}

export function layerUnit(layer: HeatmapLayer): string {
  switch (layer) {
    case 'rssi':
      return 'dBm'
    case 'sinr':
      return 'dB'
    case 'mcs':
      return ''
    default:
      return 'Mb/s'
  }
}

/** Render the grid into RGBA at one pixel per cell; the canvas scales it up. */
export function renderHeatmap(
  data: HeatmapData,
  layer: HeatmapLayer,
  alpha: number,
): ImageData {
  const values = layerValues(data, layer)
  const image = new ImageData(data.cols, data.rows)
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
  const stops = layer === 'bestAp' ? null : SCALES[layer]

  for (let i = 0; i < data.cols * data.rows; i++) {
    const p = i * 4
    // Cells with no serving AP stay transparent so the plan shows through.
    if (data.bestAp[i] < 0) continue

    const value = values[i]
    const colour = stops
      ? bandFor(stops, value)
      : AP_COLOURS[Math.max(0, data.bestAp[i]) % AP_COLOURS.length]

    image.data[p] = colour[0]
    image.data[p + 1] = colour[1]
    image.data[p + 2] = colour[2]
    image.data[p + 3] = a
  }
  return image
}
