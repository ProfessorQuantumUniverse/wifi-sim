# Validation suite

This project claims to compute real electromagnetics. That claim is only worth
anything if it is checked, so it is, on every commit and every pull request.

```bash
npm test
```

## What is being checked

The suite is deliberately not a set of unit tests. Testing that a function
returns what it returns proves nothing about whether the physics is right. What
these tests do instead is compare the engine against results that can be worked
out on paper, plus a small number of invariants that must hold for any correct
implementation.

### Against closed-form references

| Test | Reference | Agreement |
| --- | --- | --- |
| Direct path | Friis, over four distances and six frequencies | better than 0.002 dB |
| Ground reflection | two-ray model with the exact Fresnel coefficient, over concrete, metal and wet ground | better than 0.02 dB |
| Interference null | path difference of one wavelength over a conductor | more than 20 dB deep |
| Brewster's angle | TM reflection null at atan(sqrt(eps_r)) | reflectance below 1e-20 |
| Shadow boundary | half the incident field, 6.02 dB below free space | within 1 dB |
| Half-wave dipole | Balanis, D = 1.643 | 2.15 dBi to two decimals |
| Low-E coating | t = 2/(2 + eta_0/R) for a resistive sheet | to nine decimals |
| PHY rates | published 802.11n, ac, ax and be rate tables, twelve combinations | exact |
| Noise floor | kTB at 290 K | −101 dBm at 20 MHz |
| Channel overlap | 1, 6 and 11 do not overlap; 1 and 2 overlap by more than 70 percent | exact |

### Invariants

Things that must be true of any correct solver, whatever the geometry.

- **Energy conservation.** For a lossless stack, transmittance plus reflectance
  equals one to nine decimal places, across six frequencies, eight incidence
  angles and both polarisations. For every build-up in the library, nothing ever
  returns more power than went in.
- **Stack reciprocity.** Reversing the layer order of an asymmetric wall leaves
  transmission unchanged while reflection differs. This is the cheapest check
  that the matrix product is right.
- **Channel reciprocity.** Swapping transmitter and receiver changes nothing.
  Reflections and transmissions are exactly reciprocal; diffraction holds to
  within 0.01 dB, limited by the Luebbers heuristic described in
  [what this does not model](/physics/limits).
- **Directivity.** Every radiation pattern integrates to 4 pi over the sphere,
  which is what makes it a directivity rather than an arbitrary shape.
- **Geometry conservation.** A wall face with any arrangement of windows, doors,
  frames and mullions in it is tiled exactly by its compiled panels: no gaps, no
  overlaps. A gap here would be a hole in the building that nobody drew, and the
  map would be optimistic without any visible symptom.
- **Nothing exceeds the transmitter.** Swept over a grid, no path and no path sum
  carries more power than was sent, and nothing is NaN or infinite.

### Documented claims

The two figures the README and this documentation lead with are asserted
directly, so they cannot drift:

- An uncoated 4-16-4 sealed unit is under 0.5 dB at 2.4 GHz and between 8.5 and
  10 dB at 5.5 GHz.
- Adding a soft-coat low-emissivity layer takes the same unit above 25 dB.

### Behaviour that has to stay honest

- Ordinary reinforcement mesh is reported as out of range at every Wi-Fi
  frequency, rather than returning a number.
- A material used outside its published frequency range is flagged, and the flag
  propagates up through the wall build-up.
- A channel with no regulatory allocation is refused rather than allowed.

## Three bugs this suite found

Worth recording, because they are the argument for having written it.

**The shadow boundary was inverted for half of all walls.** The reference
direction the diffraction angles are measured from was built with a cross product
whose sign depended on the order a wall's two endpoints happened to be stored in.
Draw a wall left to right and diffraction was correct; draw the same wall right
to left and the lit and shadow regions swapped, so the diffracted field added
where it should have subtracted. The field jumped by about 9 dB across the shadow
boundary instead of being continuous. Nothing about a result may depend on which
end of a wall the user clicked first, and now a test says so.

**Exactly on a shadow boundary, the field collapsed.** The UTD coefficient
contains a product of a cotangent that diverges and a transition function that
goes to zero. Evaluated separately that is infinity times zero, so the term that
removes the geometrical-optics cliff silently disappeared and the field dropped
by 27 dB. This is not a corner case: an axis-aligned wall and a regular
evaluation grid land on it routinely. It now uses the closed-form limit.

**A sector antenna radiated its full peak gain straight backwards.** The angle
off boresight was computed with the forward component clamped to a small positive
number, so a ray arriving exactly along the reverse axis reported zero degrees
off boresight. A wall-mounted panel therefore had a full-strength spike pointing
through its own reflector, in precisely the direction a regular grid keeps
producing.

## Running it

```bash
npm test          # once
npm run test:watch  # on change
npm run typecheck   # types, including the tests themselves
```

The suite runs in well under a second, so there is no reason not to have it
running while you work.

## Adding to it

The bar for a new test is not "does this cover more lines". It is one of:

1. It compares against an external reference: a standard, a textbook result, a
   published table, or an analytic solution.
2. It asserts an invariant that must hold for any correct implementation.
3. It pins a claim the documentation makes, so the claim cannot quietly become
   false.

Tests that check the engine agrees with itself are not validation and are not
wanted. See [contributing](/reference/contributing).
