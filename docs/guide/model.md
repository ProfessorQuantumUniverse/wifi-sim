# 3. Build the model

Press **Build model** in the header. Your traced lines become a three-dimensional
building: walls with a base and a top, a floor, a ceiling, and whatever openings
and furniture you add.

This is where you decide what the building is made of, and it is where most of
the accuracy of the final answer comes from.

## Wall types

A wall type is a build-up: an ordered list of layers, each with a material and a
thickness. "Brick 175 mm, plastered both sides" is three layers.

The app measures how thick each wall is on your drawing and matches it to the
closest build-up it knows, so you start with something sensible. Your job is to
skim the list and fix the ones that are wrong for your building.

### The inspector

Select a wall type and you get a plot of what it actually does: transmission loss
against frequency, and against angle of incidence.

Use it. It is the fastest way to sanity check a build-up before you trust a map
built on it. If you have ever measured the loss through one of your own walls
with a phone app, this is where you compare.

A few things you will notice on that plot:

- Loss almost always rises with frequency. This is why 5 GHz has shorter range
  indoors than 2.4 GHz.
- Loss rises with angle. A wall you hit at a slant is a thicker wall.
- Some build-ups have dips and peaks rather than a smooth curve. Those are
  resonances, and they are real: a layered construction is an interference
  filter whether it was designed as one or not.

### The layer library

Every material in the library comes from
[ITU-R P.2040 Table 3](/physics/materials), reproduced without adjustment. The
thicknesses are ordinary European construction practice and are the part you are
expected to change.

Some common building products are deliberately **absent**: PVC window profiles,
screed, tile, carpet, mineral wool. P.2040 has no entry for them, and this
project does not invent numbers. If you need one, add it as a custom material
with a citation. See [contributing](/reference/contributing) if you have a
source, because that is the single most useful thing you can give this project.

## Openings

An opening is a window, a door or an open passage cut into a wall. Each one has:

- **Position and size.** Offset along the wall, width, sill height, head height.
- **A build-up that fills it.** Glazing for a window, a leaf for a door, air for
  a passage.
- **A frame**, modelled as its own surface with its own build-up. This is why a
  large window with an aluminium frame behaves differently from the same window
  with a wooden one.
- **Mullions**, which split the opening into separate panes. These matter: a
  metal mullion in the middle of a big window is a bar of metal in the path, and
  averaging it away over the whole opening would hide it.

### Windows: read this part

**The default is double glazing with a soft-coat low-emissivity layer, and that
default costs about 29 dB.**

That is not a typo and it is not a safety margin. A low-emissivity coating is a
metallic film a few nanometres thick, applied to almost every insulating glass
unit manufactured since roughly 2000. It is sold on thermal performance. It is
also, electrically, a resistive sheet, and a resistive sheet is a very effective
radio screen.

The families, and what they cost at 2.4 GHz:

| Coating | Sheet resistance | Rough loss |
| --- | --- | --- |
| None, plain float glass | n/a | 1 to 3 dB |
| Hard-coat, pyrolytic | about 20 ohm per square | around 20 dB |
| Soft-coat single silver | about 5 ohm per square | around 29 dB |
| Soft-coat double silver, solar control | about 3 ohm per square | around 33 dB |
| Triple silver, high performance solar control | about 1.5 ohm per square | around 39 dB |

If you are not sure what your windows are, leave the default. In a building of
any recent vintage it is much more likely to be right than "uncoated", and
getting this wrong in the optimistic direction is how a planner ends up
promising coverage on a balcony that has none.

If you know your glazing, the data sheet gives emissivity. Emissivity and sheet
resistance are the same property expressed two ways, so a low emissivity figure
means a low sheet resistance and a lot of attenuation.

## Floor and ceiling

These are added automatically, spanning your building's bounding box plus a
small margin.

**Set the ceiling height to the real one.** Indoors, the floor and ceiling
reflections carry a serious fraction of the total signal, sometimes more than the
direct path once you are a room or two away. Where those reflections land depends
directly on the height.

The default floor and ceiling build-up is reinforced concrete. If you are in a
timber-framed house, change it, because the difference between a concrete slab
and a joisted timber floor is large.

::: tip Reinforcement mesh
If you use a build-up with a reinforcement mesh in it, look at what the app says
about it. Ordinary construction mesh has a pitch around 150 mm, and a 2.4 GHz
wavelength is 125 mm. The model used for wire grids needs the pitch to be small
compared with the wavelength, and it is not. The app reports this as out of
range rather than returning a confident number. See
[what this does not model](/physics/limits).
:::

## Furniture

Boxes with a position, size, rotation, height and build-up. Add the ones that
matter and ignore the rest.

What matters is anything large and either metallic or wet:

- A fridge or a metal cabinet is a mirror. It will show up clearly on the map.
- A large bookcase full of books is a genuine absorber.
- A television is a metal-backed panel, which is why "behind the TV" is one of
  the mounting options for the router.

What does not matter: chairs, small tables, anything you could pick up.

## Checking your model before you compute

Three quick checks that catch most problems:

1. **Are all the rooms closed?** A single missing wall segment leaks signal
   through a gap that does not exist.
2. **Do the wall types make sense?** Look for an interior partition that got
   matched to a 400 mm exterior wall, or the reverse.
3. **Is the ceiling height right?**

## Next

[Set up the radio](/guide/radio).
