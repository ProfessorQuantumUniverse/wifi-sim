# Materials

Everything the app knows about what buildings are made of comes from one place:

> Recommendation **ITU-R P.2040**, "Effects of building materials and structures
> on radiowave propagation above about 100 MHz", section 3 and Table 3.

It is a free download from the ITU and it is the reference the whole field uses.
The table is reproduced here without adjustment.

## How a material is described

Two numbers describe how a material responds to a radio wave, and both depend on
frequency. P.2040 gives them as power laws, with frequency in GHz:

```
eps_r' = a * f^b            relative permittivity, dimensionless
sigma  = c * f^d            conductivity, siemens per metre
```

which combine into the complex relative permittivity that everything downstream
uses:

```
eps_r = eps_r' - j * sigma / (2*pi*f*eps_0)
```

The real part says how much the wave slows down inside the material, which
determines how it refracts and how strongly it reflects at each interface. The
imaginary part says how much it is absorbed.

## The table

Every entry has a frequency range it was characterised over. That range is part
of the data and the app enforces it.

| Material | a | b | c | d | Valid range |
| --- | --- | --- | --- | --- | --- |
| Vacuum / air | 1 | 0 | 0 | 0 | 0.001 to 100 GHz |
| Concrete | 5.24 | 0 | 0.0462 | 0.7822 | 1 to 100 GHz |
| Brick | 3.91 | 0 | 0.0238 | 0.16 | 1 to 10 GHz |
| Plasterboard | 2.73 | 0 | 0.0085 | 0.9395 | 1 to 100 GHz |
| Wood | 1.99 | 0 | 0.0047 | 1.0718 | 0.001 to 100 GHz |
| Glass | 6.31 | 0 | 0.0036 | 1.3394 | 0.1 to 100 GHz |
| Ceiling board | 1.48 | 0 | 0.0011 | 1.075 | 1 to 100 GHz |
| Chipboard | 2.58 | 0 | 0.0217 | 0.78 | 1 to 100 GHz |
| Plywood | 2.71 | 0 | 0.33 | 0 | 1 to 40 GHz |
| Marble | 7.074 | 0 | 0.0055 | 0.9262 | 1 to 60 GHz |
| Floorboard | 3.66 | 0 | 0.0044 | 1.3515 | **50 to 100 GHz** |
| Metal | 1 | 0 | 1e7 | 0 | 1 to 100 GHz |
| Very dry ground | 3 | 0 | 0.00015 | 2.52 | 1 to 10 GHz |
| Medium dry ground | 15 | −0.1 | 0.035 | 1.63 | 1 to 10 GHz |
| Wet ground | 30 | −0.4 | 0.15 | 1.3 | 1 to 10 GHz |

Notice that `b` is zero for everything except the ground types. Over the ranges
given, the real permittivity of ordinary building materials does not depend on
frequency. All the frequency dependence you see in a wall comes from the
conductivity and from the geometry of the layers.

## Two entries worth watching

**Brick** stops at 10 GHz. The 6 GHz Wi-Fi band is inside that, so brick is fine
for everything this app does. 60 GHz would not be.

**Floorboard** is only characterised from **50 GHz upward**. Every Wi-Fi band is
a large extrapolation from that, and the app flags it every time. Use **Wood**
instead unless you have a measured value. This is the entry that catches people
out, because the name sounds exactly like what you want for a timber floor.

## Extrapolation is reported, not hidden

Ask for a material outside its stated range and you still get a number, because
refusing would be less useful than warning. But the result is marked, the marking
propagates up through the wall build-up to the coverage map, and the exported
report names which materials were extrapolated.

The point is that you can tell the difference between a number backed by
published measurements and a number produced by a power law running well past
where anybody checked it.

## What is deliberately missing

Several ordinary building products have no P.2040 entry, and this project does
not invent one:

- PVC and uPVC window profiles
- Screed, floor tile, carpet
- Mineral wool and other cavity insulation
- EPS and other rigid insulation boards
- Aerated concrete blocks
- Low-emissivity coatings, which are handled a different way, see
  [walls and glazing](/physics/walls)

If you need one of these, add it as a custom material. The app requires a
provenance note, which is the point: the exported report can then say where the
number came from, and a reader can judge it.

**If you have a sourced value for any of these, that is the most useful
contribution you can make to this project.** See
[contributing](/reference/contributing).

## Bulk absorption

For reference, the attenuation of a plane wave travelling inside a material, at
normal incidence, following P.2040 equations 12 and 13:

```
alpha = (2*pi*f/c) * Im(sqrt(eps_r))    nepers per metre
```

converted to decibels per metre with a factor of 20 log10(e), about 8.686.

This is the bulk absorption only. The reflections at each interface, and the
multiple reflections inside a layered construction, are handled separately by
the transfer matrix. See [walls and glazing](/physics/walls).
