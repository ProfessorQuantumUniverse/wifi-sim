# What this does not model

The most useful page in the documentation.

Every model is wrong somewhere. A model that tells you where is far more useful
than one that does not, because you can work around a known gap and you cannot
work around a hidden one.

## In the propagation

### Diffraction happens once

A path can bend around one edge. It cannot bend around a corner and then another
corner.

**What this means in practice:** coverage two corners deep, down an L-shaped
corridor or in a room reached only via a bend in a hallway, is underestimated.
Reflections usually pick up most of the slack indoors, so the error is smaller
than it sounds, but it is in the pessimistic direction.

### Two reflections, and only off the large surfaces

Third-order and higher reflections are not computed. Second-order reflections
consider only a capped set of the largest surfaces.

**What this means:** in a small, hard-walled, empty room, a real field has
significant energy in higher-order bounces that this does not include. Again
pessimistic. In a furnished home it makes very little difference, because those
higher orders have been through so many walls that they are far below the direct
path anyway.

### Surfaces are smooth

All reflection is specular. There is no diffuse scattering off rough surfaces,
and surface roughness is not used even where the material table carries a value
for it.

**What this means:** rough render, exposed brickwork and textured ceilings
scatter some energy out of the specular direction. This model keeps it all in the
specular lobe, so specular reflections are slightly overstated and the field away
from them slightly understated.

### The diffraction coefficient mixes polarisations

A detail, but a real one. Luebbers' heuristic replaces the perfectly conducting
face reflection coefficients with the actual ones. A full implementation applies
a separate coefficient per polarisation. This implementation applies a single
scalar coefficient built from the TE and TM coefficients of the two wedge faces,
and samples both at the incidence azimuth.

**What this means:** diffracted fields carry a small error, and the channel comes
out reciprocal to about a thousandth of a decibel rather than exactly. That is
far below anything that matters for planning, and it is
[measured on every commit](/reference/validation) so it cannot silently get
worse.

### One floor at a time

The model is a single storey with a floor and a ceiling. There is no second
floor above or below, and no path that goes up through a slab, along, and back
down.

**What this means:** if you are planning a house, model each floor separately.
The app will tell you correctly what the slab costs, but it will not compute
coverage upstairs from a router downstairs. This is the largest single gap in
the tool.

### Nothing moves and nobody is home

Static geometry, one snapshot. No people walking about, no doors opening and
closing, no Doppler, no time variation of any kind.

A human body is a bag of salt water and blocks 3 to 6 dB. Where the map says a
room is marginal, a person standing in the wrong place will take it below
threshold. The client body loss setting covers the person holding the device, not
the ones walking past.

### Reinforced concrete is refused rather than guessed

Covered fully under [walls and glazing](/physics/walls). The short version: the
wire grid model needs the mesh pitch to be small against the wavelength,
construction mesh at 150 mm against 125 mm is not, and the app reports the
situation instead of returning a number.

**What to do:** use a measured shielding value. Published figures for reinforced
concrete scatter over roughly 1 to 20 dB and are dominated by the concrete and
its moisture rather than by the mesh.

## In the model of the building

### Walls have no thickness

They are planes carrying a stack. See
[finding the paths](/physics/tracing) for why this is mostly right rather than
an approximation. What it does neglect is the small sideways offset a ray picks
up crossing a real slab, which is minor at construction thicknesses.

It also means a wall junction is a mathematical intersection of two planes rather
than a real corner with a corner's own geometry.

### Furniture is boxes

Rectangular boxes with a build-up. Real furniture is not, and a bookcase full of
books is not one material.

Model the things that matter, which is anything large and either metallic or wet:
fridges, metal cabinets, televisions, full bookcases. Ignore chairs.

### There is no ceiling structure

No beams, no suspended ceiling void, no ductwork, no pipe runs, no cable trays.
In an office building those are often the dominant reflectors and blockers.

This tool is aimed at homes and small offices. In a large commercial fit-out,
expect it to be optimistic.

## In the link

### One station, idle channel

The throughput figure is what a single client can reach with nothing else using
the air. It does not model:

- several clients sharing airtime
- OFDMA scheduling in 802.11ax
- multi-user MIMO
- the way a slow client at the edge of a cell drags the whole cell down

That last one is a real effect with a name, and it is worth knowing about even
though this tool does not model it: airtime is shared, not bandwidth, so one
device stuck at MCS 0 occupies far more airtime per byte than a fast one and
slows everybody down.

### No beamforming

Antennas radiate their static pattern. Explicit beamforming, which every modern
access point does, steers energy towards the client and typically buys a few
decibels.

Pessimistic, by roughly 2 to 4 dB where beamforming is active.

### MIMO is counted, not modelled

Spatial streams multiply the data rate, capped by the smaller of the two ends'
chain counts. But the rich multipath a real MIMO link needs to actually achieve
those streams is not evaluated. The app assumes the streams work if both ends
have the chains.

In a normal indoor environment that is a reasonable assumption. In an open hall
with a clean line of sight and little multipath, it is optimistic.

### Roaming is not simulated

The map shows the best serving access point per point. Real clients decide when
to move themselves, are often reluctant to, and can hold onto a distant access
point long after a nearer one became better.

## What this means for how much to trust it

The gaps mostly point in the pessimistic direction: missing higher-order
reflections, missing second-order diffraction, missing beamforming. The
optimistic ones are surface roughness, MIMO stream availability and, in
commercial buildings, ceiling structure.

For the question most people bring to it, which is where to put a router in a
home or small office, it is well inside the accuracy of the input you can
realistically give it. Your wall build-ups and your scale carry far more
uncertainty than any of the above.

**The right way to use it** is to compare options rather than to read absolute
values. "Is the hallway better than the living room" is a question this answers
very well, because the modelling gaps affect both candidates the same way.
"Exactly how many dBm will my phone show in the bedroom" is a question it answers
to within a handful of decibels, which is about as well as two phones agree with
each other.

## Take one measurement

If you do one thing to validate a model, do this. Stand somewhere with a Wi-Fi
analyser, note the level, and compare it with the same point on the map.

Within about 5 dB, trust the map. If you are 15 dB out, something in the model is
wrong, and the [probe tool](/guide/results) will usually show you what within a
minute.
