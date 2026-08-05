# How it works

This section explains what the app computes and why. You do not need it to use
the tool. You do need it if you want to know whether to believe the output, and
the most useful page in it is
[what this does not model](/physics/limits).

## The short version

To find the signal at a point, the app finds every significant way energy can get
from the router to that point, works out what each route costs, and adds them up.

There are four kinds of route:

1. **The direct path**, attenuated by every surface it crosses.
2. **One reflection**, off a wall, floor, ceiling or piece of furniture, plus
   whatever it goes through on both legs.
3. **Two reflections**, restricted to the largest surfaces.
4. **Diffraction**, bending around a wall end or through a door reveal.

Each route is solved exactly rather than sampled, so its length, its angles and
its phase are all exact. Then the wall losses come from a full electromagnetic
solution of the actual construction, not from a table of decibels per wall.

## What makes this different from a free planner

Take the ordinary approach: draw a line, count walls, subtract a fixed number of
decibels each. Here is what that cannot express.

**Reflection.** Indoors, the floor and ceiling bounces frequently carry more
energy than the direct path once you are a room away. A line-of-sight model has
no concept of them, so it predicts a steep fall-off that does not happen.

**Diffraction.** Without it, a ray model predicts an abrupt cliff at the edge of
every shadow. Real fields do not have cliffs. The room behind a corner gets a
signal, and how much depends on the geometry in a way a constant cannot capture.

**Frequency dependence.** The same window is 0.2 dB at 2.4 GHz and 9.3 dB at
5.5 GHz. One number per wall cannot be both.

**Angle dependence.** A wall you hit at a slant is a thicker wall, and the
reflection coefficient changes shape entirely between the two polarisations.

**Interference.** Two paths of equal strength arriving out of phase give you
nothing at all. Adding decibels can never produce a null.

**Polarisation.** A router with an upright antenna and a phone lying flat are
cross-polarised, and that mismatch is a real loss. The engine carries the field
as a vector rather than a scalar so it can compute it instead of assuming the two
are aligned.

## Read on

- [Materials](/physics/materials): where every dielectric constant comes from.
- [Walls and glazing](/physics/walls): how a build-up is solved, and why sealed
  glazing units behave the way they do.
- [Finding the paths](/physics/tracing): the ray solver, reflections and
  diffraction.
- [From signal to speed](/physics/rates): link budget, modulation and throughput.
- [What this does not model](/physics/limits): read this one.

## The principle behind all of it

No invented numbers.

Every physical constant in this project carries its source, and the app can tell
you what that source is. Anything a standard does not cover is a required input
with a stated valid range, never a silent default. Where a model is used outside
the range it was published for, the app says so instead of returning a confident
wrong answer.

This costs something. It is why some ordinary building products are missing from
the material library, and why reinforced concrete gives you a warning rather than
a number. That is the intended trade: a gap you can see is more useful than a
figure you cannot check.
