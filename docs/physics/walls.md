# Walls and glazing

A wall is not one material. It is a stack: plaster, brick, plaster. A window is
glass, gas, glass. A stud partition is board, cavity, board.

That layering is not a detail. It is the reason two walls with the same total
thickness and the same materials can behave completely differently, and it is the
single biggest thing a per-wall decibel table gets wrong.

## How a stack is solved

Exactly, with the characteristic matrix method, also called the Abeles method.
It is the same algebra optical thin-film design has used for eighty years, and it
is what ITU-R P.2040 Annex 1 section 3 uses for its own single-slab result,
generalised here to any number of layers.

Each layer contributes a two by two matrix:

```
M_j = [  cos(delta_j)           (i/eta_j) sin(delta_j) ]
      [  i*eta_j sin(delta_j)   cos(delta_j)           ]
```

with `delta_j = (2*pi/lambda_0) * n_j * d_j * cos(theta_j)`, where `n_j` is the
complex refractive index, `d_j` the thickness and `theta_j` the complex
refraction angle from Snell's law. The tilted admittance `eta` differs between
the two polarisations:

```
TE, perpendicular:  eta = n * cos(theta)
TM, parallel:       eta = n / cos(theta)
```

Multiply the layer matrices together in order, apply the boundary conditions with
air on both sides, and you get the complex reflection and transmission
coefficients directly.

Because it is exact rather than approximate, several things come out
automatically that no simpler model produces:

- the multiple internal reflections inside the construction
- the half-wave thickness resonances
- Brewster angle behaviour
- the full angle and polarisation dependence

The reference formulation is H. A. Macleod, *Thin-Film Optical Filters*, 4th
edition, CRC Press 2010, chapter 2.

## Why a sealed glazing unit is strange

This is the example worth working through, because it explains the whole
approach.

An ordinary 4-16-4 unit is 4 mm of glass, a 16 mm cavity, another 4 mm of glass.

At **2.4 GHz** the wavelength in air is 125 mm. A 16 mm cavity is about an eighth
of that. The two panes are close enough together, in wavelength terms, to act
roughly as one thin sheet, and the whole assembly is nearly transparent. It costs
about **0.2 dB**.

At **5.5 GHz** the wavelength is 54.5 mm. Now the 16 mm cavity is close to a
third of a wavelength, and the reflections off the four glass surfaces no longer
cancel out. They reinforce. The unit costs about **9.3 dB**.

Same window, nine decibels apart, purely because of geometry. This is not an
exotic case: it is the window in most homes, and it is a large part of why 5 GHz
feels so much worse near a balcony than 2.4 GHz does.

Both figures are checked on every commit. See
[the validation suite](/reference/validation).

## Low-emissivity coatings

Now the part that matters more than anything else on this page.

Essentially every insulating glass unit made since roughly 2000 carries a
low-emissivity coating: a metallic film a few nanometres thick, on one of the
inner surfaces. It is invisible, it is sold on thermal performance, and it is
electrically a **resistive sheet**.

At Wi-Fi frequencies that film is far thinner than a skin depth, which makes it
exactly a shunt resistive sheet with normalised admittance

```
y = eta_0 / R_sheet
```

where `R_sheet` is the coating's sheet resistance in ohms per square. That is a
published product property. What glass data sheets call emissivity is the same
property expressed differently, so this is a sourced input rather than a fitted
attenuation.

A bare resistive sheet in free space transmits

```
t = 2 / (2 + eta_0/R)
```

so a 5 ohm per square coating gives about 28 dB on its own. That lands squarely
in the 25 to 30 dB range measured for standard low-emissivity coatings between
850 MHz and 3 GHz, which is the cross-check that the sheet model behaves.

The families:

| Family | Sheet resistance | Emissivity | Loss at 2.4 GHz in a sealed unit |
| --- | --- | --- | --- |
| None, plain float glass | n/a | 0.84 | 1 to 3 dB |
| Hard-coat, pyrolytic tin oxide | about 20 ohm/sq | 0.15 to 0.20 | around 20 dB |
| Soft-coat single silver | about 5 ohm/sq | around 0.04 | around 29 dB |
| Soft-coat double silver, solar control | about 3 ohm/sq | around 0.03 | around 33 dB |
| Triple silver solar control | about 1.5 ohm/sq | very low | around 39 dB |

The practical consequence is worth stating plainly. **A modern window is not a
window as far as your Wi-Fi is concerned. It is a wall, and often a worse one
than the brick next to it.** A soft-coat unit at 29 dB attenuates more than
240 mm of plastered brick, which comes in around 5 dB.

References for the cross-check: Ranplan, "Low-E glass and 5G/4G wireless
coverage"; Ding, "5G Signal Penetrating Low-E Coating Technology", SVC 2021.

## Reinforcement mesh

A conductive grid inside a construction, whether that is reinforcement in a
concrete wall or the mesh in some security glazing, acts as a shunt inductive
sheet **provided the grid pitch is small compared with the wavelength**. For an
inductive grating of period `g` and round wires of radius `a`:

```
X / eta_0 = (g / lambda) * ln( g / (2*pi*a) )
```

(Marcuvitz, *Waveguide Handbook*, 1951, section 5.1; equivalently Casey,
"Electromagnetic shielding behavior of wire-mesh screens", IEEE Transactions on
EMC 30(3), 1988.)

**This is where the model runs out, and the app says so.** Ordinary building
reinforcement has a mesh pitch of 100 to 200 mm. A 2.4 GHz wavelength is 125 mm.
So a real reinforced wall sits at pitch roughly equal to wavelength, above the
grating's first onset, where the quasi-static result is simply not valid.

Rather than return a confident number from a model outside its range,
`evaluateWireGrid` reports the situation:

- **valid** below about a quarter wavelength pitch
- **marginal** between a quarter and a half, treat as indicative
- **out of range** above a half, do not use the number

For reinforced concrete at Wi-Fi frequencies you want a measured shielding value.
Published figures scatter broadly over 1 to 20 dB, and they are dominated by the
concrete itself and its moisture content rather than by the mesh.

The presets in the app cover common German reinforcement mesh per DIN 488-4
(Q188A, Q257A, Q335A, Q524A) plus finer plaster meshes, which do fall inside the
valid range.

## Some worked figures

Normal incidence, unpolarised, from the app's own default build-ups:

| Build-up | 2.4 GHz | 5.5 GHz |
| --- | --- | --- |
| Stud partition, 12.5 mm board / 75 mm cavity / 12.5 mm board | 1.0 dB | 1.1 dB |
| Single glazing, 4 mm | 1.1 dB | 3.0 dB |
| Brick 175 mm, plastered both sides | 4.9 dB | 6.9 dB |
| Double glazing 4-16-4, uncoated | 0.2 dB | 9.3 dB |
| Concrete 200 mm, unreinforced | 14.8 dB | 26.5 dB |
| Double glazing 4-16-4, soft-coat low-E | 29.3 dB | 34.1 dB |

Two things to take from that table. A modern window is the heaviest thing in most
houses. And the ordering changes with frequency: uncoated double glazing is the
most transparent thing in the list at 2.4 GHz and beats brick at 5.5 GHz.

A single decibel-per-wall figure cannot produce either result.
