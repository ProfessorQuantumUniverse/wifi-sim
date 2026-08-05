# When something looks wrong

Symptoms first, in roughly the order people hit them.

## The tracing does not find my walls

**Everything is highlighted, including the text.** Raise **Min stroke
half-width** until the thin things disappear. That slider does most of the work.

**Nothing is highlighted.** Your plan is probably light on dark. Turn on
**Invert input**.

**Only parts of the plan are highlighted, and the dark parts are missing.**
The exposure is uneven, which happens with photographs of printed plans. Switch
the threshold method to **Adaptive**, and set the window radius clearly larger
than your thickest wall stroke.

**Walls come out as a dashed line of fragments.** Raise **Gap bridging**. Door
swings and scan dropouts break wall strokes, and the min stroke slider makes it
worse before it makes it better.

**Walls come out as hollow outlines rather than solid strokes.** Your adaptive
window radius is too small, so the middle of each thick stroke is being read as
background.

**Furniture and stair symbols are being read as walls.** Use **Exclude** boxes.
Fighting this with sliders will cost you real partition walls.

**Nothing works.** Draw the walls by hand in the model editor. On a flat this
takes about five minutes and gives a perfect result. Also please
[open an issue and attach the plan](https://github.com/ProfessorQuantumUniverse/wifi-sim/issues/new/choose),
because a plan that defeats the tracer is exactly what is needed to improve it.

## The wall thicknesses are absurd

Almost always the scale. Go back to [set the scale](/guide/scale) and do it
again with the longest printed dimension you can find.

If the scale is definitely right and the thicknesses are still wrong, the tracer
is probably finding the outlines of wall strokes rather than the strokes
themselves. See "hollow outlines" above.

## Compute coverage does nothing

Check, in this order:

1. Is there at least one access point, and is it enabled?
2. Does the model have walls? Building the model from an empty trace produces an
   empty scene.
3. Is the browser tab still in the foreground? Long solves get throttled in
   background tabs.

If the button turns busy and then reports an error, the message says what
happened. If it is not clear,
[that is worth an issue](https://github.com/ProfessorQuantumUniverse/wifi-sim/issues/new/choose).

## The solve is very slow

The cost is roughly the number of grid cells times the number of paths per cell.
Both are adjustable.

- **Raise the grid resolution value.** 0.35 m is the default. 0.5 m is four times
  faster and is plenty for deciding where a router goes.
- **Drop the reflection order to 1.** Second-order reflections are the expensive
  part, and indoors they usually move the answer by a decibel or two.
- **Lower the second-order reflector cap** if you want to keep order 2. It
  considers the largest surfaces first, which is the right call: floors, ceilings
  and long walls carry essentially all of the second-order energy.
- **Narrow the dynamic range.** The default keeps paths down to 45 dB below the
  strongest. 35 dB is faster and changes the sum very little.

## The map disagrees with my phone

This is the useful failure, because it tells you something.

**If the map is optimistic**, in order of likelihood:

1. A wall is missing from the trace. Check that the room's outline is closed.
2. Your windows are set to uncoated glass and are actually low-emissivity. That
   alone is worth 25 dB or more.
3. Body loss is set to 0 and you are holding the phone.
4. The router is in a cabinet or behind something, and the mounting is set to
   free standing.

**If the map is pessimistic:**

1. A wall type got matched to something far heavier than it is. Look for a
   partition assigned an exterior build-up.
2. The ceiling height is wrong, which puts the floor and ceiling reflections in
   the wrong place.
3. There is a large opening the model does not have. Signal through a doorway
   often beats signal through the wall around it by a wide margin.

**Either way, probe the point.** Click on the map at the place you measured and
look at the actual paths. It usually makes the answer obvious.

**A note on comparing at all.** Phones report signal strength with generous
rounding and their own calibration, and two phones held side by side routinely
differ by several decibels. Being within about 5 dB is a good match. Being 15 dB
out means something in the model is wrong.

## The map is full of speckle

You are on the **coherent** combining setting, which shows the real standing wave
pattern. At 5 GHz a half wavelength is about 27 mm, so the field genuinely varies
that fast.

Switch to **incoherent** for a planning map. It gives the local average, which is
what a client that moves at all actually experiences.

## The app says a material was extrapolated

It is telling you that a build-up used a material outside the frequency range its
published data covers, and that the specific number involved is less trustworthy
than the rest.

The usual culprit is **Floorboard**, which ITU-R P.2040 only characterises from
50 GHz upward. At Wi-Fi frequencies that is a very long extrapolation. Use
**Wood** instead, or a measured value.

See [materials](/physics/materials).

## The app says the reinforcement mesh is out of range

Also expected, and it is being honest rather than broken.

The wire grid model needs the mesh pitch to be small compared with the
wavelength. Ordinary construction mesh has a pitch around 150 mm and a 2.4 GHz
wavelength is 125 mm, so the model does not apply. Rather than return a confident
number from a model outside its validity, the app says so.

For a reinforced concrete wall, use a measured shielding value if you have one.
Published figures are broadly 1 to 20 dB, and they are dominated by the concrete
and its moisture content rather than by the mesh. See
[what this does not model](/physics/limits).

## Something else

[Open an issue.](https://github.com/ProfessorQuantumUniverse/wifi-sim/issues/new/choose)
Attaching the `.wifisim` file makes it enormously easier to help, because it
contains everything needed to reproduce exactly what you are seeing.
