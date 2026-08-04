/**
 * Starter build-up library.
 *
 * Every layer here is one of the ITU-R P.2040 Table 3 materials at a nominal
 * construction thickness — no invented dielectric constants. Where a common
 * building product has no P.2040 entry (PVC window profiles, screed, tile,
 * carpet, mineral wool, Low-E coatings) it is deliberately absent: add it as a
 * custom material with a citation rather than have the tool guess.
 *
 * Thicknesses follow ordinary German/European construction practice and are the
 * part you are expected to change to match your building.
 */

import type { WallType } from './model'

export const AIR_TYPE_ID = 'air'

export const DEFAULT_WALL_TYPES: WallType[] = [
  {
    id: AIR_TYPE_ID,
    name: 'Open passage (air)',
    colour: '#64748b',
    layers: [{ materialId: 'vacuum', thicknessM: 0.001 }],
  },
  {
    id: 'brick-175-plastered',
    name: 'Brick 175 mm, plastered both sides',
    colour: '#f97316',
    layers: [
      { materialId: 'plasterboard', thicknessM: 0.015 },
      { materialId: 'brick', thicknessM: 0.175 },
      { materialId: 'plasterboard', thicknessM: 0.015 },
    ],
  },
  {
    id: 'brick-115-plastered',
    name: 'Brick 115 mm, plastered both sides',
    colour: '#fb923c',
    layers: [
      { materialId: 'plasterboard', thicknessM: 0.015 },
      { materialId: 'brick', thicknessM: 0.115 },
      { materialId: 'plasterboard', thicknessM: 0.015 },
    ],
  },
  {
    id: 'brick-240-plastered',
    name: 'Brick 240 mm, plastered both sides',
    colour: '#ea580c',
    layers: [
      { materialId: 'plasterboard', thicknessM: 0.015 },
      { materialId: 'brick', thicknessM: 0.24 },
      { materialId: 'plasterboard', thicknessM: 0.015 },
    ],
  },
  {
    id: 'concrete-200',
    name: 'Concrete 200 mm (unreinforced)',
    colour: '#94a3b8',
    layers: [{ materialId: 'concrete', thicknessM: 0.2 }],
  },
  {
    id: 'concrete-200-rebar',
    name: 'Reinforced concrete 200 mm (Q188A mesh)',
    colour: '#475569',
    layers: [
      {
        materialId: 'concrete',
        thicknessM: 0.2,
        grid: { pitchM: 0.15, wireRadiusM: 0.003 },
      },
    ],
  },
  {
    id: 'drywall-stud',
    name: 'Stud partition, 12.5 mm board / 75 mm cavity / 12.5 mm board',
    colour: '#a3e635',
    layers: [
      { materialId: 'plasterboard', thicknessM: 0.0125 },
      { materialId: 'vacuum', thicknessM: 0.075 },
      { materialId: 'plasterboard', thicknessM: 0.0125 },
    ],
  },
  {
    id: 'glass-single-4',
    name: 'Single glazing 4 mm',
    colour: '#38bdf8',
    layers: [{ materialId: 'glass', thicknessM: 0.004 }],
  },
  {
    id: 'glass-double-4-16-4',
    name: 'Double glazing 4-16-4, UNCOATED',
    colour: '#22d3ee',
    layers: [
      { materialId: 'glass', thicknessM: 0.004 },
      { materialId: 'vacuum', thicknessM: 0.016 },
      { materialId: 'glass', thicknessM: 0.004 },
    ],
  },
  {
    id: 'glass-double-lowe-soft',
    name: 'Double glazing 4-16-4, soft-coat Low-E (typical since ~2000)',
    colour: '#0891b2',
    layers: [
      { materialId: 'glass', thicknessM: 0.004 },
      { materialId: 'vacuum', thicknessM: 0.016 },
      // Coating faces the cavity on the inner pane — the standard position 3.
      { materialId: 'glass', thicknessM: 0.004, coating: { sheetResistanceOhmPerSq: 5 } },
    ],
  },
  {
    id: 'glass-double-lowe-hard',
    name: 'Double glazing 4-16-4, hard-coat Low-E',
    colour: '#0e7490',
    layers: [
      { materialId: 'glass', thicknessM: 0.004 },
      { materialId: 'vacuum', thicknessM: 0.016 },
      { materialId: 'glass', thicknessM: 0.004, coating: { sheetResistanceOhmPerSq: 20 } },
    ],
  },
  {
    id: 'glass-triple-4-12-4-12-4',
    name: 'Triple glazing 4-12-4-12-4, two soft-coat Low-E layers',
    colour: '#0ea5e9',
    layers: [
      { materialId: 'glass', thicknessM: 0.004 },
      { materialId: 'vacuum', thicknessM: 0.012 },
      { materialId: 'glass', thicknessM: 0.004, coating: { sheetResistanceOhmPerSq: 5 } },
      { materialId: 'vacuum', thicknessM: 0.012 },
      { materialId: 'glass', thicknessM: 0.004, coating: { sheetResistanceOhmPerSq: 5 } },
    ],
  },
  {
    id: 'glass-solar-control',
    name: 'Solar-control glazing (double-silver)',
    colour: '#155e75',
    layers: [
      { materialId: 'glass', thicknessM: 0.006 },
      { materialId: 'vacuum', thicknessM: 0.016 },
      { materialId: 'glass', thicknessM: 0.004, coating: { sheetResistanceOhmPerSq: 3 } },
    ],
  },
  {
    id: 'door-wood-40',
    name: 'Door leaf, wood 40 mm',
    colour: '#b45309',
    layers: [{ materialId: 'wood', thicknessM: 0.04 }],
  },
  {
    id: 'door-chipboard-40',
    name: 'Door leaf, chipboard-core 40 mm',
    colour: '#a16207',
    layers: [{ materialId: 'chipboard', thicknessM: 0.04 }],
  },
  {
    id: 'frame-wood',
    name: 'Window frame, wood 70 mm',
    colour: '#78350f',
    layers: [{ materialId: 'wood', thicknessM: 0.07 }],
  },
  {
    id: 'frame-aluminium',
    name: 'Window frame, aluminium',
    colour: '#cbd5e1',
    layers: [{ materialId: 'metal', thicknessM: 0.002 }],
  },
  {
    id: 'slab-concrete-200-rebar',
    name: 'Floor/ceiling slab, reinforced concrete 200 mm',
    colour: '#334155',
    layers: [
      {
        materialId: 'concrete',
        thicknessM: 0.2,
        grid: { pitchM: 0.15, wireRadiusM: 0.003 },
      },
    ],
  },
  {
    id: 'furniture-wood',
    name: 'Furniture, solid wood',
    colour: '#92400e',
    layers: [{ materialId: 'wood', thicknessM: 0.02 }],
  },
  {
    id: 'furniture-metal',
    name: 'Furniture, sheet metal (fridge, cabinet)',
    colour: '#e2e8f0',
    layers: [{ materialId: 'metal', thicknessM: 0.001 }],
  },
  {
    id: 'furniture-marble',
    name: 'Worktop, marble/stone 30 mm',
    colour: '#d6d3d1',
    layers: [{ materialId: 'marble', thicknessM: 0.03 }],
  },
]

export const DEFAULT_SCENE_DEFAULTS = {
  ceilingHeightM: 2.5,
  wallTypeId: 'brick-175-plastered',
  floorTypeId: 'slab-concrete-200-rebar',
  ceilingTypeId: 'slab-concrete-200-rebar',
  // Soft-coat Low-E is what almost every window fitted since about 2000 is;
  // defaulting to uncoated glass would understate window loss by 20-30 dB.
  windowTypeId: 'glass-double-lowe-soft',
  doorTypeId: 'door-wood-40',
  frameTypeId: 'frame-wood',
} as const
