/**
 * From channel gain to a number on the box.
 *
 * The data rates here are not copied from a table, they are computed from the
 * standard's own OFDM parameters. That is only worth doing if it reproduces the
 * published rates exactly, so this file checks a spread of them against the
 * figures every 802.11 rate chart lists. The regulatory limits are checked the
 * same way: against the clause, not against the app.
 */

import { describe, expect, test } from 'vitest'
import {
  MCS_TABLE,
  channelCentreMHz,
  channelOverlapFraction,
  checkCompliance,
  maxMcsFor,
  noiseFloorDbm,
  phyRateBps,
  requiredSnrDb,
  selectRate,
  throughput,
  DEFAULT_MAC,
  type ChannelWidthMHz,
  type Generation,
} from '../src/engine/linkBudget'

describe('PHY rates against the published 802.11 tables', () => {
  // generation, width, MCS, spatial streams, guard interval, expected Mbps
  const cases: Array<[Generation, ChannelWidthMHz, number, number, number, number]> = [
    // 802.11n (HT), 800 ns guard interval
    ['ht', 20, 7, 1, 0.8, 65],
    ['ht', 20, 7, 2, 0.8, 130],
    ['ht', 40, 7, 2, 0.8, 270],
    // 802.11ac (VHT)
    ['vht', 80, 9, 1, 0.8, 390],
    ['vht', 80, 9, 1, 0.4, 433.3],
    ['vht', 160, 9, 2, 0.4, 1733.3],
    // 802.11ax (HE), 12.8 us symbol
    ['he', 20, 11, 1, 0.8, 143.4],
    ['he', 40, 11, 1, 0.8, 286.8],
    ['he', 80, 11, 2, 0.8, 1201],
    ['he', 160, 11, 2, 0.8, 2402],
    ['he', 80, 0, 1, 0.8, 36],
    // 802.11be (EHT)
    ['eht', 320, 11, 2, 0.8, 4804],
  ]

  test.each(cases)(
    '%s %i MHz MCS%i x%i, %s us GI',
    (generation, width, mcs, streams, gi, expectedMbps) => {
      const mbps = phyRateBps(generation, width, mcs, streams, gi) / 1e6
      // The published tables are rounded to a tenth of a Mbps.
      expect(mbps).toBeCloseTo(expectedMbps, expectedMbps > 1000 ? -0.5 : 0)
    },
  )

  test('a generation cannot be pushed past its highest MCS', () => {
    expect(maxMcsFor('ht')).toBe(7)
    expect(maxMcsFor('vht')).toBe(9)
    expect(maxMcsFor('he')).toBe(11)
    expect(maxMcsFor('eht')).toBe(11)

    const plenty = selectRate(60, 'ht', 80, 2, 0.8, 5)
    expect(plenty.mcs).toBe(7)
  })
})

describe('noise and sensitivity', () => {
  test('the thermal noise floor matches kTB at room temperature', () => {
    // -174 dBm/Hz + 10log10(20 MHz) = -101 dBm, the number every Wi-Fi
    // datasheet quotes for a 20 MHz channel with a perfect receiver.
    expect(noiseFloorDbm(20, 0)).toBeCloseTo(-101, 1)
    expect(noiseFloorDbm(40, 0)).toBeCloseTo(-98, 1)
    expect(noiseFloorDbm(160, 0)).toBeCloseTo(-92, 1)
    // Doubling the bandwidth costs exactly 3 dB.
    expect(noiseFloorDbm(40, 7) - noiseFloorDbm(20, 7)).toBeCloseTo(3.01, 2)
  })

  test('the required SNR rises with every step up the modulation ladder', () => {
    let previous = -Infinity
    for (let mcs = 0; mcs <= 11; mcs++) {
      const need = requiredSnrDb(mcs)
      expect(need).toBeGreaterThan(previous)
      previous = need
    }
    // These come from the standard's compliance sensitivities, not from the
    // theoretical limit of each modulation, so they sit a few dB above what an
    // information-theory table would give. MCS 0 is BPSK at rate 1/2 and lands
    // just under 9 dB; MCS 11 is 1024-QAM and lands just under 39.
    expect(requiredSnrDb(0)).toBeGreaterThan(5)
    expect(requiredSnrDb(0)).toBeLessThan(12)
    expect(requiredSnrDb(11)).toBeGreaterThan(35)
    expect(requiredSnrDb(11)).toBeLessThan(42)
    // The spread between them is fixed by the sensitivity table alone: the
    // -52 dBm of MCS 11 against the -82 dBm of MCS 0.
    expect(requiredSnrDb(11) - requiredSnrDb(0)).toBeCloseTo(30, 9)
  })

  test('the required SNR does not depend on channel width', () => {
    // Sensitivity and noise both scale with bandwidth, so what is left is a
    // pure SNR. If this ever stopped holding, wide channels would look either
    // free or impossible.
    const rate20 = selectRate(25, 'he', 20, 1, 0.8, 5)
    const rate160 = selectRate(25, 'he', 160, 1, 0.8, 5)
    expect(rate160.mcs).toBe(rate20.mcs)
  })

  /**
   * The chipset margin says how much better than a just-compliant receiver the
   * client is, so raising it must make every rate easier to reach. The sign of
   * this knob is easy to get backwards, and getting it backwards would quietly
   * turn an optimistic assumption into a pessimistic map.
   */
  test('a better chipset reaches a higher MCS at the same SNR', () => {
    const justCompliant = selectRate(30, 'he', 80, 2, 0.8, 0)
    const typical = selectRate(30, 'he', 80, 2, 0.8, 5)
    expect(typical.mcs).toBeGreaterThan(justCompliant.mcs)
    expect(typical.requiredSnrDb).toBeLessThan(justCompliant.requiredSnrDb)

    // A margin of 5 dB is exactly the allowance the standard's sensitivity
    // figures already contain, so it recovers the reference receiver.
    expect(requiredSnrDb(0, 5, 0) - requiredSnrDb(0, 5, 5)).toBeCloseTo(5, 9)
  })

  test('below the lowest modulation there is no link at all', () => {
    const nothing = selectRate(-20, 'he', 20, 2, 0.8, 5)
    expect(nothing.mcs).toBe(-1)
    expect(nothing.phyRateBps).toBe(0)
    expect(throughput(nothing.phyRateBps, DEFAULT_MAC).throughputBps).toBe(0)
  })
})

describe('MAC efficiency', () => {
  test('goodput is a sensible fraction of the PHY rate and never above it', () => {
    for (const entry of MCS_TABLE) {
      const phy = phyRateBps('he', 80, entry.mcs, 2, 0.8)
      const result = throughput(phy, DEFAULT_MAC)
      expect(result.throughputBps).toBeLessThan(phy)
      expect(result.efficiency).toBeGreaterThan(0.5)
      expect(result.efficiency).toBeLessThan(1)
    }
  })

  test('aggregation makes fast links relatively more efficient', () => {
    const slow = throughput(phyRateBps('he', 20, 0, 1, 0.8), DEFAULT_MAC)
    const fast = throughput(phyRateBps('he', 160, 11, 4, 0.8), DEFAULT_MAC)
    expect(fast.mpdusPerAggregate).toBeGreaterThan(slow.mpdusPerAggregate)
  })
})

describe('channels', () => {
  test('centre frequencies match the band plans', () => {
    expect(channelCentreMHz('2.4', 1)).toBe(2412)
    expect(channelCentreMHz('2.4', 6)).toBe(2437)
    expect(channelCentreMHz('2.4', 11)).toBe(2462)
    expect(channelCentreMHz('2.4', 13)).toBe(2472)
    expect(channelCentreMHz('5', 36)).toBe(5180)
    expect(channelCentreMHz('5', 100)).toBe(5500)
    expect(channelCentreMHz('5', 165)).toBe(5825)
    expect(channelCentreMHz('6', 1)).toBe(5955)
    expect(channelCentreMHz('6', 37)).toBe(6135)
  })

  test('the classic 2.4 GHz overlap story comes out right', () => {
    const at = (channel: number) => channelCentreMHz('2.4', channel)
    // 1, 6 and 11 are the non-overlapping set every deployment guide names.
    expect(channelOverlapFraction(at(1), 20, at(6), 20)).toBe(0)
    expect(channelOverlapFraction(at(1), 20, at(11), 20)).toBe(0)
    expect(channelOverlapFraction(at(6), 20, at(11), 20)).toBe(0)
    // Neighbouring channels overlap almost completely, which is why using
    // channel 2 next to a network on channel 1 is worse than sharing it.
    expect(channelOverlapFraction(at(1), 20, at(2), 20)).toBeGreaterThan(0.7)
    expect(channelOverlapFraction(at(1), 20, at(1), 20)).toBe(1)
  })

  test('a narrow interferer inside a wide channel counts in full', () => {
    // All of a 20 MHz neighbour lands inside an 80 MHz channel, so all of its
    // power is interference, even though it only spoils a quarter of the band.
    expect(channelOverlapFraction(5210, 80, 5200, 20)).toBe(1)
    // The other way round only a quarter of the wide signal lands in the
    // narrow victim.
    expect(channelOverlapFraction(5200, 20, 5210, 80)).toBeCloseTo(0.25, 2)
  })
})

describe('regulatory limits', () => {
  test('ETSI caps 2.4 GHz at 20 dBm EIRP', () => {
    expect(checkCompliance('etsi', 2437, 20, 20).compliant).toBe(true)
    const over = checkCompliance('etsi', 2437, 20, 23)
    expect(over.compliant).toBe(false)
    expect(over.exceedanceDb).toBeCloseTo(3, 6)
  })

  test('power spectral density, not total power, binds on narrow channels', () => {
    // EN 300 328 allows 20 dBm EIRP but only 10 dBm/MHz. On a 20 MHz channel
    // the density limit works out to 10 + 10log10(20) = 23 dBm, so the total
    // power limit is the binding one. On a 5 MHz occupancy it would not be.
    const wide = checkCompliance('etsi', 2437, 20, 19)
    expect(wide.maxEirpDbm).toBeCloseTo(20, 6)
    expect(wide.psdLimitedEirpDbm).toBeCloseTo(23.01, 1)
  })

  test('the 6 GHz band is indoor only under both domains', () => {
    for (const domain of ['etsi', 'fcc'] as const) {
      const check = checkCompliance(domain, 6135, 80, 20)
      expect(check.limit?.indoorOnly).toBe(true)
      expect(check.messages.join(' ')).toContain('Indoor')
    }
  })

  test('channels needing radar detection say so', () => {
    const dfs = checkCompliance('etsi', 5500, 20, 20)
    expect(dfs.limit?.requiresDfs).toBe(true)
    expect(dfs.messages.join(' ')).toContain('DFS')
  })

  test('a channel with no allocation is refused rather than allowed', () => {
    const nowhere = checkCompliance('etsi', 4000, 20, 10)
    expect(nowhere.limit).toBeNull()
    expect(nowhere.compliant).toBe(false)
    expect(nowhere.messages.join(' ')).toContain('not usable')
  })

  test('FCC allows more than ETSI on 2.4 GHz', () => {
    const etsi = checkCompliance('etsi', 2437, 20, 20)
    const fcc = checkCompliance('fcc', 2437, 20, 20)
    expect(fcc.maxEirpDbm).toBeGreaterThan(etsi.maxEirpDbm)
  })
})
