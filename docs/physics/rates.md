# From signal to speed

The ray tracer gives a received power. Getting from there to a number of
megabits per second takes four more steps.

## 1. The noise floor

Thermal noise in the channel:

```
N = -174 dBm/Hz + 10*log10(B) + NF
```

The −174 comes from 10 log10(k T0 × 1000) at T0 = 290 K, the standard reference
temperature. NF is the receiver's noise figure, around 7 dB for consumer silicon.

For a 20 MHz channel with a perfect receiver that gives −101 dBm, which is the
number every Wi-Fi data sheet quotes.

**Every doubling of bandwidth costs exactly 3 dB.** This is the trade behind
channel width: an 80 MHz channel carries four times the data of a 20 MHz one and
starts 6 dB further behind.

## 2. Interference

Every other transmitter, whether one of your own access points or a neighbour, is
weighted by how much of its occupied spectrum lands inside the channel you are
listening on, and added to the noise.

The overlap model treats both occupancies as rectangles and normalises by the
interferer's own width. It is the standard first-order adjacent-channel model.

This is where the 2.4 GHz channel folklore comes from. Channels 1, 6 and 11 are
20 MHz wide and spaced 25 MHz apart, so they do not overlap at all. Channel 1 and
channel 2 overlap by more than 70 percent, which is why choosing channel 2 next
to a neighbour on channel 1 is worse than simply sharing channel 1 with them: on
the same channel you can hear each other and take turns, on adjacent channels you
cannot decode each other but you still corrupt each other's frames.

Signal over noise plus interference gives SINR, and everything after this point
depends only on that.

## 3. Which modulation the link can carry

The app uses the receiver sensitivity tables from IEEE Std 802.11-2020 and
802.11ax-2021, the "receiver minimum input sensitivity" figures. Those are what a
device must meet to be compliant, measured at 10 percent packet error rate on a
4096-octet frame.

Those figures already contain a reference 5 dB noise figure and a 5 dB
implementation margin. Subtracting that reference noise floor recovers a
bandwidth-independent required SNR, because sensitivity and noise both scale with
bandwidth in exactly the same way.

| MCS | Modulation | Coding | Sensitivity at 20 MHz | Required SNR |
| --- | --- | --- | --- | --- |
| 0 | BPSK | 1/2 | −82 dBm | 9.0 dB |
| 1 | QPSK | 1/2 | −79 dBm | 12.0 dB |
| 2 | QPSK | 3/4 | −77 dBm | 14.0 dB |
| 3 | 16-QAM | 1/2 | −74 dBm | 17.0 dB |
| 4 | 16-QAM | 3/4 | −70 dBm | 21.0 dB |
| 5 | 64-QAM | 2/3 | −66 dBm | 25.0 dB |
| 6 | 64-QAM | 3/4 | −65 dBm | 26.0 dB |
| 7 | 64-QAM | 5/6 | −64 dBm | 27.0 dB |
| 8 | 256-QAM | 3/4 | −59 dBm | 32.0 dB |
| 9 | 256-QAM | 5/6 | −57 dBm | 34.0 dB |
| 10 | 1024-QAM | 3/4 | −54 dBm | 37.0 dB |
| 11 | 1024-QAM | 5/6 | −52 dBm | 39.0 dB |

Required SNR is shown at the default chipset margin of 5 dB. These sit a few
decibels above what an information-theory table would give, because they come
from the standard's compliance requirement rather than from the theoretical limit
of each modulation. Real silicon typically beats the mandated minimum by 3 to
6 dB, which is what the chipset margin setting adjusts.

The highest MCS available depends on the generation: 802.11n stops at 7,
802.11ac at 9, and 802.11ax and 802.11be reach 11.

## 4. The data rate

Not looked up in a table. Computed from the standard's own OFDM parameters, so
any combination of bandwidth, streams, modulation and guard interval is covered:

```
R = Nss * Nsd * Nbpscs * Rcode / Tsym
```

- **Nss** is the number of spatial streams, capped by both ends of the link.
- **Nsd** is the number of data subcarriers, set by the OFDM numerology. 802.11n
  and 802.11ac use a 64-point FFT per 20 MHz with 52 data tones; 802.11ax and
  802.11be use a 256-point FFT per 20 MHz with 234.
- **Nbpscs** and **Rcode** come from the modulation and coding.
- **Tsym** is the symbol duration including the guard interval: 3.2 microseconds
  of FFT for 802.11n and 802.11ac, 12.8 for 802.11ax and 802.11be.

This reproduces the published rate tables exactly. 802.11ax at 80 MHz, MCS 11,
two spatial streams, 0.8 microsecond guard interval gives 1201 Mb/s, which is
what the tables say. That agreement is
[checked on every commit](/reference/validation) for a spread of a dozen
combinations across all four generations.

## 5. What you actually get

The PHY rate counts the preamble, the interframe spacing and the acknowledgement
as though they were payload. They are not. Actual goodput pays for:

- the PHY preamble and signalling, once per transmission
- DIFS, which is SIFS plus two slot times
- the average backoff, half the minimum contention window
- SIFS and the block acknowledgement at the end

all of it amortised over one aggregate rather than one frame, which is what
aggregation is for. The result typically lands around 60 to 70 percent of the PHY
rate, and the fraction improves at higher rates because the fixed overhead is
spread over more data.

::: warning This is one station on an idle channel
The throughput figure does not model several clients sharing airtime, OFDMA
scheduling or multi-user MIMO. Treat it as the ceiling one device can reach with
nothing else going on.
:::

## Regulatory limits

The app checks the configured EIRP against the applicable limit and says whether
it is allowed, whether the band is indoor only, and whether the channel requires
radar detection.

| Domain | Band | EIRP limit | Notes |
| --- | --- | --- | --- |
| ETSI | 2.4 GHz | 20 dBm | EN 300 328, also 10 dBm/MHz |
| ETSI | 5150 to 5350 | 23 dBm | indoor only, DFS and TPC above 5250 |
| ETSI | 5470 to 5725 | 30 dBm | DFS and TPC mandatory |
| ETSI | 5925 to 6425 | 23 dBm | indoor only, low power |
| FCC | 2.4 GHz | 36 dBm | 47 CFR 15.247 |
| FCC | 5150 to 5250 | 30 dBm | indoor only |
| FCC | 5250 to 5725 | 30 dBm | DFS required |
| FCC | 5725 to 5850 | 36 dBm | |
| FCC | 5925 to 7125 | 30 dBm | indoor only, low power |

Where a power spectral density limit applies it is checked too, and the app tells
you which of the two is actually binding at your channel width. On narrow
channels the density limit is often the real constraint, and it is the one people
forget.
