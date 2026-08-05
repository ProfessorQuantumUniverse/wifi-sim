# Finding the paths

Most ray tracers work by shooting. Launch a few hundred thousand rays in random
or evenly spread directions, follow each one as it bounces, and collect whatever
lands near the receiver.

This one does not. It enumerates the paths and solves each in closed form.

## Why enumerate rather than shoot

Shooting rays has three problems that are awkward to fix.

**Quantisation.** A ray either lands in the reception sphere or it does not, so
path lengths and angles come out on a grid set by the ray spacing. Everything
downstream inherits that error, including the phase, which is the most sensitive
quantity in the whole calculation.

**Monte Carlo noise.** Run it twice with different seeds and you get slightly
different answers. In a coverage map that shows up as speckle you cannot
distinguish from the real interference pattern.

**Double counting.** Two rays from the same specular family can both land in the
reception sphere, and the usual fixes are heuristics.

Enumeration by the method of images has none of these. Each path's length,
incidence angles and phase are exact. The result is bit-for-bit reproducible.
There is no reception sphere at all.

The cost is a cap on how many surfaces participate in second-order reflections,
which is discussed below.

## The four path families

### Order 0: the direct path

A straight line from transmitter to receiver, attenuated by every surface it
crosses on the way.

Its power follows the free-space law, which the app reproduces exactly:

```
gain = (lambda / (4 * pi * d))^2
```

### Order 1: one reflection

Mirror the transmitter through each surface's plane. If the line from that image
to the receiver crosses the surface inside its rectangle, that crossing point is
the specular reflection point, exactly. Both endpoints must be on the same side
of the plane for the reflection to exist at all.

### Order 2: two reflections

Same idea applied twice. Mirror the transmitter through the first surface, mirror
that image through the second, and work the crossing points back.

Second order is restricted to a capped set of the **largest** surfaces, sorted by
area. Indoors, that means the floor, the ceiling and the long walls, which is
where essentially all of the second-order energy is. The cost of this stage grows
with the square of the number of surfaces considered, so the cap is what keeps a
solve interactive.

### Diffraction

Energy bending around an edge. Without it, a ray model predicts an abrupt,
unphysical cliff at every shadow boundary.

The app takes its edges directly from the model rather than by analysing which
surfaces touch which: the vertical jambs, head and sill of every opening, plus a
vertical edge at any wall end that no other wall meets. Those are exactly the
discontinuities that cast a shadow indoors.

The coefficient is the Uniform Theory of Diffraction one (Kouyoumjian and Pathak,
*Proceedings of the IEEE* 62(11), 1974). Dielectric faces are handled with
Luebbers' heuristic (*IEEE Transactions on Antennas and Propagation* 32(1),
1984): the perfectly conducting reflection coefficients of −1 and +1 are replaced
with the actual coefficients of the wedge faces.

Because walls are modelled as zero-thickness surfaces carrying a stack, every
free edge is a half-plane edge, so the wedge parameter is 2. That is the
self-consistent choice for this geometry model rather than an approximation
bolted on.

**The property that pins diffraction down is continuity.** Exactly on a shadow
boundary, the total field must be half the incident field, which is 6.02 dB
below free space, and the field must not jump as you step across. That is a
result you can work out on paper, and it is checked on every commit. See
[the validation suite](/reference/validation).

## Walls have no thickness

Every surface in the engine is a zero-thickness plane carrying a multilayer
stack, and a transmitted ray continues in a straight line through it.

That sounds like an approximation and mostly is not. The stack's transfer matrix
already contains the refraction and the internal multiple reflections inside the
construction. Refracting the ray through the slab volume as well would count the
same physics twice.

What it does neglect is the small lateral offset a ray picks up crossing a real
slab. For construction thicknesses of 0.1 to 0.3 m against room-scale path
lengths, that offset is small, and treating walls as planes is what makes exact
closed-form image solving valid even with transmissions in the path.

## What is carried along a path

Not a scalar. A complex three-dimensional field vector.

At each interaction the field is split into the component perpendicular to the
plane of incidence (TE) and the component in it (TM), each is multiplied by the
appropriate coefficient from the stack, and the result is recombined. At the
receiver the field is projected onto the receiving antenna's own polarisation
vector.

This is what lets the engine compute the real mismatch between a router with an
upright antenna and a phone lying flat, instead of assuming they are aligned. It
is also why the reflection coefficients have to be kept separate per
polarisation: they behave completely differently, and near Brewster's angle the
TM coefficient passes through zero while TE does not.

## Adding the paths up

Two ways, and the choice matters.

**Coherent** sums the complex fields, phase included. It is physically the more
complete answer and it shows the real standing wave pattern, with nulls and peaks
every half wavelength. At 5 GHz that is every 27 mm, so a coherent map looks like
noise unless you zoom a long way in.

**Incoherent** sums the powers. This gives the local average, which is what a
client that moves at all actually experiences, and it is the default for coverage
maps.

Both are correct answers to different questions. Use incoherent to decide where
to put a router, and coherent when you want to see that the fine structure is
really there.

## Trimming

Once the paths are enumerated, anything more than a set number of decibels below
the strongest is discarded, because it cannot move the sum. The default is 45 dB,
which is a factor of about thirty thousand in power.

This is a speed setting, not a physics one. Narrowing it to 35 dB is noticeably
faster and changes results by a small fraction of a decibel.

One consequence worth knowing: whether a path sitting exactly at the threshold
survives can depend on rounding, so two runs of a geometry that should be
symmetric can report slightly different path counts. The energy involved is
44 dB down and the difference in the total is far below a thousandth of a
decibel.

## Spatial acceleration

Surfaces go into a bounding volume hierarchy so that finding what a leg crosses
does not mean testing every surface. Each surface is a rectangle, which makes the
intersection test exact and cheap: intersect the plane, express the hit point in
the rectangle's own edge basis, and check both parameters lie between 0 and 1. No
triangulation, no barycentric coordinates.
