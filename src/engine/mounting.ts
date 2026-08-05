/**
 * How and where the access point is physically installed.
 *
 * Two things follow from this. First, the antenna's natural orientation: a whip
 * on a shelf stands upright, the same router screwed to a ceiling hangs upside
 * down, and a wall-mounted panel points into the room. Second, the enclosure it
 * radiates through: a router inside a closed cabinet is behind a door, and that
 * door is a real, measurable loss that no amount of repositioning recovers.
 *
 * The enclosure loss is NOT a fudge factor for "somewhere awkward": it is the
 * one-way transmission loss of the material in front of the antenna, and the
 * defaults below are computed from the same ITU-R P.2040 stacks the walls use.
 * Set it to zero for anything in free air.
 */

export type MountingKind =
  | 'free-standing'
  | 'shelf-top'
  | 'inside-cabinet-wood'
  | 'inside-cabinet-glass'
  | 'inside-metal-rack'
  | 'wall-mounted'
  | 'ceiling-mounted'
  | 'behind-tv'

export interface MountingPreset {
  id: MountingKind
  name: string
  /** Typical installation height above the floor, m. */
  heightM: number
  /** Antenna axis tilt from horizontal, degrees. 90 = upright whip. */
  tiltDeg: number
  /**
   * One-way loss of whatever the signal must cross immediately: a cabinet door,
   * a rack panel. 0 for open air.
   */
  enclosureLossDb: number
  /** Which build-up the loss figure was derived from, for the report. */
  enclosureBasis: string
  hint: string
}

export const MOUNTING_PRESETS: MountingPreset[] = [
  {
    id: 'free-standing',
    name: 'Free standing, table or desk',
    heightM: 0.75,
    tiltDeg: 90,
    enclosureLossDb: 0,
    enclosureBasis: 'nothing in front of the antenna',
    hint: 'Open air on all sides. Low, so the floor is close and the floor reflection will be strong.',
  },
  {
    id: 'shelf-top',
    name: 'On top of a shelf or cupboard',
    heightM: 1.8,
    tiltDeg: 90,
    enclosureLossDb: 0,
    enclosureBasis: 'nothing in front of the antenna',
    hint: 'Usually the best spot in a home: high, clear of furniture, nothing blocking it.',
  },
  {
    id: 'inside-cabinet-wood',
    name: 'Inside a closed wooden cabinet',
    heightM: 1.2,
    tiltDeg: 90,
    enclosureLossDb: 2.4,
    enclosureBasis: '18 mm chipboard door, ITU-R P.2040 chipboard at 5.5 GHz',
    hint: 'The door costs a couple of dB in every direction. That is worse than it sounds, because it applies before any wall loss.',
  },
  {
    id: 'inside-cabinet-glass',
    name: 'Inside a cabinet with glass doors',
    heightM: 1.2,
    tiltDeg: 90,
    enclosureLossDb: 1.5,
    enclosureBasis: '4 mm uncoated float glass, ITU-R P.2040 glass at 5.5 GHz',
    hint: 'Plain glass is fairly transparent to Wi-Fi. Only mirrored or coated glass is a problem.',
  },
  {
    id: 'inside-metal-rack',
    name: 'Inside a metal cabinet or rack',
    heightM: 1.2,
    tiltDeg: 90,
    enclosureLossDb: 25,
    enclosureBasis: 'sheet metal enclosure; escape is through seams and openings, not through the metal',
    hint: 'Do not do this with internal antennas. The figure is a placeholder for leakage through gaps. The real value depends entirely on the openings.',
  },
  {
    id: 'wall-mounted',
    name: 'Wall mounted',
    heightM: 2.0,
    tiltDeg: 90,
    enclosureLossDb: 0,
    enclosureBasis: 'nothing in front of the antenna',
    hint: 'The wall behind it blocks one half-space, which the ray tracer already accounts for. Put it on the wall of the room you want covered.',
  },
  {
    id: 'ceiling-mounted',
    name: 'Ceiling mounted',
    heightM: 2.4,
    tiltDeg: -90,
    enclosureLossDb: 0,
    enclosureBasis: 'nothing in front of the antenna',
    hint: 'Antennas hang downward. The classic layout for even coverage on one floor.',
  },
  {
    id: 'behind-tv',
    name: 'Behind a TV or monitor',
    heightM: 1.1,
    tiltDeg: 90,
    enclosureLossDb: 6,
    enclosureBasis: 'screen back panel with internal metal shielding, one-way estimate',
    hint: 'A screen is a metal-backed panel. Coverage on the far side of it will be poor. Verify with a probe point.',
  },
]

export function mountingPreset(id: MountingKind): MountingPreset {
  return MOUNTING_PRESETS.find((m) => m.id === id) ?? MOUNTING_PRESETS[0]
}
