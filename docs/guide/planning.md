# Going further

Once you have a map you believe, these four things turn it into a decision.

## Add your neighbours

Interference is usually the reason a network is disappointing rather than
coverage, and you cannot see interference without knowing what else is on the
air.

A neighbour's transmit power is never known, so the app does not guess it.
Instead:

1. Place the neighbour roughly where its router sits. You do not need to be
   precise, and you can put it outside your own outline.
2. Stand somewhere in your flat with a Wi-Fi analyser and note the level that
   network shows.
3. Type that reading in, with the point you took it from.

The engine traces that geometry and back-solves the transmit power that would
produce your reading. From then on the neighbour is a fully modelled source: its
interference in every other room follows the same physics as your own access
points, walls included.

This is much better than assuming a power, because it automatically absorbs
everything you cannot see. If that network is behind a concrete wall, your
measurement already includes the wall, and the back-solved power reproduces it.

You do need the neighbour's channel and width. Any Wi-Fi analyser app lists both.

## Rank the channels

With neighbours in the model, run the channel plan. It scores every channel in
the serving access point's band against the interference in the map you already
computed, and reports what each one would give you.

It is quick because it does not re-trace anything. Only the spectral overlap
changes when you move channel, and the propagation is already solved.

Two things worth knowing when you read the ranking:

**Candidates stay inside the current band.** Across a band the wall behaviour
barely changes, so comparing channel 36 with channel 149 is fair. Across bands it
changes a great deal, so the app does not pretend that comparing 2.4 GHz with
5 GHz on one number is meaningful. Decide the band yourself, then let this pick
the channel.

**Partial overlap is worse than full overlap.** On 2.4 GHz, sharing channel 1
with a neighbour means you take turns politely, because you can hear each other
and the protocol is built for that. Sitting on channel 3 next to that neighbour
means you cannot decode each other but you still corrupt each other's frames.
The app models this: it weights each interferer by the fraction of its occupied
spectrum that lands inside your channel. It is why 1, 6 and 11 exist.

## Let the optimiser search

Give it a coverage target and it searches candidate positions for a better place
to put the router.

The settings:

- **Target signal level.** The default is −67 dBm, the usual voice threshold.
- **How many access points to place.** With more than one it places them
  greedily: it finds the best single position, then the best position for a
  second given the first, and so on.
- **Candidate spacing.** How finely it searches. Coarser is much faster, and
  1.5 m is plenty in a flat.
- **Evaluation spacing.** How finely it measures each candidate. This one costs
  the most, because the whole map is recomputed for every candidate.
- **Mounting height.**

It reports, for each suggestion, what fraction of the area reaches the target and
the fifth-percentile signal level. That second figure is the one to watch: it
tells you how bad the worst corners are, and an average can hide a dead bedroom
completely.

::: warning It optimises what you asked for
The optimiser knows nothing about where the power socket is, whether the cable
reaches, or whether the best spot is in the middle of your hallway ceiling. Read
its suggestions as "here is where the physics wants it" and then apply judgement.
:::

## Export a report

You get one self-contained HTML file. It contains the map, every radio and client
setting that produced it, the channel ranking, and the source of every material
constant used.

It loads nothing from the network, so it stays readable years from now, works
with no internet, and can be emailed to somebody who does not have the app.

This is the thing to send a landlord, a facilities manager or a client. It is
also worth exporting for yourself before you change anything, so you have a
before and after.

There is also a plain PNG export of the map alone, for when you just want the
picture.
