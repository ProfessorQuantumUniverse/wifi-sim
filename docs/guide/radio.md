# 4. Set up the radio

Two things to describe here: what is transmitting, and what is listening. Both
matter, and the second one is the half people forget.

## The access point

### Band, channel and width

| Band | Range | Notes |
| --- | --- | --- |
| 2.4 GHz | reaches furthest, three usable channels | crowded everywhere, and shared with Bluetooth, microwaves and everything else |
| 5 GHz | the sensible default | much more spectrum, shorter reach through walls |
| 6 GHz | most spectrum, cleanest air | indoor only and low power in both ETSI and FCC territory, and only recent devices support it |

**Width** trades range against speed. Doubling the width doubles the data rate
and costs exactly 3 dB of range, because the noise you collect scales with
bandwidth. On 2.4 GHz, do not use 40 MHz: there is not enough room, and you will
simply collide with your neighbours.

The app checks whatever you pick against the regulatory limits for your domain
and tells you if the configuration is not allowed, which channel needs radar
detection, and which band is indoor only.

### Power

Set the **conducted power**, which is what the radio delivers to the antenna
connector, plus any **cable loss**. The app adds the antenna gain to get EIRP
and compares that against your regulatory ceiling.

This distinction trips people up. A box that says "20 dBm" might mean 20 dBm
conducted or 20 dBm EIRP, and those differ by the antenna gain. If you get it
wrong you will be off by two or three decibels.

::: tip The AI lookup button
There is a button that writes a research brief for your exact router model. You
take that text to whatever AI assistant you use, bring the answer back, and the
app parses it.

It then does something useful: it reconciles the conducted power against the
EIRP and against your regulatory ceiling, and afterwards it tells you exactly
which fields it accepted and which are still your own values. So you can see what
it actually changed rather than trusting it wholesale.

The app makes no network calls of its own. You do the asking, which means nothing
about your project leaves your machine.
:::

### Antenna

- **Isotropic** radiates equally in all directions. Not a real antenna, useful as
  a reference.
- **Dipole** is the standard whip, 2.15 dBi, a doughnut with a null along its own
  axis.
- **Collinear** stacks several dipoles to flatten that doughnut, trading vertical
  coverage for horizontal reach. This is what most "high gain" router antennas
  are. Note the consequence: a high-gain omni is worse directly above and below
  itself, which matters in a house with more than one floor.
- **Sector** is a directional panel, for ceiling and wall mounted access points.

### How it is mounted

This one has more effect than people expect, and it sets two things at once: the
antenna's natural orientation and whatever the signal has to get through
immediately.

| Mounting | Height | Enclosure loss |
| --- | --- | --- |
| Free standing on a table | 0.75 m | none |
| On top of a shelf | 1.8 m | none |
| Inside a closed wooden cabinet | 1.2 m | 2.4 dB |
| Inside a cabinet with glass doors | 1.2 m | 1.5 dB |
| Inside a metal cabinet or rack | 1.2 m | 25 dB, and see below |
| Wall mounted | 2.0 m | none |
| Ceiling mounted | 2.4 m | none, antennas hang down |
| Behind a TV or monitor | 1.1 m | 6 dB |

The enclosure loss is not a fudge factor. It is the one-way transmission loss of
the material actually in front of the antenna, computed from the same ITU-R
P.2040 build-ups the walls use, and the app tells you which build-up each figure
came from.

It costs more than it looks, because it applies **in every direction, before any
wall loss**. Two decibels off a cabinet door is two decibels off everywhere, and
no amount of moving the router around the room recovers it.

The metal rack figure is the exception and it is honest about being a
placeholder. Signal does not go through sheet metal, it leaks out through seams
and openings, so the real number depends entirely on how open your rack is. If
you are planning a rack installation, do not trust 25 dB. Put the antennas
outside the rack.

## The client

This is the half people skip, and skipping it is why so many coverage maps
disagree with what a phone actually shows.

**A phone in your hand and a laptop on a desk see different maps.** Different
height, different antenna orientation, and your own body is in the way of one of
them.

### The settings

**Height.** The map is computed at one height above the floor. 1.1 m is a
reasonable "phone in hand while sitting" value. Set 0.8 m for a desk, or 1.5 m
for standing.

**Antenna and receive chains.** The number of chains caps how many spatial
streams the link can use, together with the access point's own count. Two is
typical for a phone, two or three for a laptop.

**Noise figure.** How much noise the receiver adds. 7 dB is a fair figure for
consumer silicon. Lower is a better receiver.

**Body loss.** What your hand and body absorb. Use 0 for something fixed on a
shelf, and 3 to 6 dB for a phone held in a hand. This is a real effect and it is
large enough to move a room from working to not.

**Chipset margin.** How many decibels better than a just-compliant receiver your
device is. 0 dB models a device that only meets the IEEE minimum sensitivity;
5 dB gives back the whole implementation allowance that the standard builds into
those figures. Raising it lowers the SNR that every rate needs, so raising it is
optimistic.

The panel shows you the consequence live: how many decibels of SNR the lowest and
highest modulations need at your current setting. If you are not sure, leave it
at 5.

## Neighbouring networks

Add the networks around you and the app will include them as interference, which
changes the SINR and therefore the achievable rate.

You need each one's channel, width and roughly how strong it is where you
measured it. Any Wi-Fi analyser app will tell you. The app back-solves a transmit
power from the level you observed at the point you observed it, then propagates
that neighbour through your model like any other source.

This is what makes the [channel plan](/guide/planning) meaningful rather than
theoretical.

## Next

[Compute and read the map](/guide/results).
