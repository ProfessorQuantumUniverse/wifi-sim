/**
 * From channel gain to a data rate.
 *
 * Sources:
 *  - Receiver sensitivity: IEEE Std 802.11-2020 / 802.11ax-2021, the "Receiver
 *    minimum input sensitivity" tables (Table 27-53 for HE). These are the
 *    values a device must meet to be compliant, measured at 10% PER on a
 *    4096-octet PSDU, and they already include the standard's reference 5 dB
 *    noise figure and 5 dB implementation margin. Real silicon is typically
 *    3-6 dB better, which is why `implementationMarginDb` is adjustable and why
 *    a measured per-device table can be supplied instead.
 *  - Data rates: computed from the standard's own parameters rather than copied
 *    from a rate table, so any combination of bandwidth, streams, MCS and guard
 *    interval is covered:  R = Nss * Nsd * Nbpscs * Rcode / Tsym.
 *  - Thermal noise: N = -174 dBm/Hz + 10log10(B) + NF, with -174 dBm/Hz being
 *    10log10(k*T0*1000) at T0 = 290 K.
 *  - EIRP limits: ETSI EN 300 328 (2.4 GHz) and EN 301 893 (5 GHz), CEPT/EC
 *    2021/2069 for 6 GHz LPI; FCC 47 CFR 15.247 / 15.407 / 15.407(6 GHz).
 */

export const THERMAL_NOISE_DBM_PER_HZ = -174

export type Generation = 'ht' | 'vht' | 'he' | 'eht'
export type Band = '2.4' | '5' | '6'
export type ChannelWidthMHz = 20 | 40 | 80 | 160 | 320

export interface ModulationEntry {
  mcs: number
  modulation: string
  /** Coded bits per subcarrier per stream. */
  bitsPerSymbol: number
  codingRate: number
  /** IEEE minimum input sensitivity at 20 MHz, dBm. */
  sensitivity20MHzDbm: number
}

/**
 * MCS 0-11 as used by HE/EHT; HT/VHT stop at 7/9 respectively. Sensitivities
 * are the 20 MHz HE figures; wider channels scale by 10log10(BW/20).
 */
export const MCS_TABLE: ModulationEntry[] = [
  { mcs: 0, modulation: 'BPSK', bitsPerSymbol: 1, codingRate: 1 / 2, sensitivity20MHzDbm: -82 },
  { mcs: 1, modulation: 'QPSK', bitsPerSymbol: 2, codingRate: 1 / 2, sensitivity20MHzDbm: -79 },
  { mcs: 2, modulation: 'QPSK', bitsPerSymbol: 2, codingRate: 3 / 4, sensitivity20MHzDbm: -77 },
  { mcs: 3, modulation: '16-QAM', bitsPerSymbol: 4, codingRate: 1 / 2, sensitivity20MHzDbm: -74 },
  { mcs: 4, modulation: '16-QAM', bitsPerSymbol: 4, codingRate: 3 / 4, sensitivity20MHzDbm: -70 },
  { mcs: 5, modulation: '64-QAM', bitsPerSymbol: 6, codingRate: 2 / 3, sensitivity20MHzDbm: -66 },
  { mcs: 6, modulation: '64-QAM', bitsPerSymbol: 6, codingRate: 3 / 4, sensitivity20MHzDbm: -65 },
  { mcs: 7, modulation: '64-QAM', bitsPerSymbol: 6, codingRate: 5 / 6, sensitivity20MHzDbm: -64 },
  { mcs: 8, modulation: '256-QAM', bitsPerSymbol: 8, codingRate: 3 / 4, sensitivity20MHzDbm: -59 },
  { mcs: 9, modulation: '256-QAM', bitsPerSymbol: 8, codingRate: 5 / 6, sensitivity20MHzDbm: -57 },
  { mcs: 10, modulation: '1024-QAM', bitsPerSymbol: 10, codingRate: 3 / 4, sensitivity20MHzDbm: -54 },
  { mcs: 11, modulation: '1024-QAM', bitsPerSymbol: 10, codingRate: 5 / 6, sensitivity20MHzDbm: -52 },
]

export function maxMcsFor(generation: Generation): number {
  switch (generation) {
    case 'ht':
      return 7
    case 'vht':
      return 9
    default:
      return 11
  }
}

/** Data subcarriers per channel width, per the standard's OFDM numerology. */
export function dataSubcarriers(generation: Generation, width: ChannelWidthMHz): number {
  if (generation === 'ht' || generation === 'vht') {
    // 64-point FFT per 20 MHz, 52 data tones.
    switch (width) {
      case 20:
        return 52
      case 40:
        return 108
      case 80:
        return 234
      case 160:
        return 468
      default:
        return 468
    }
  }
  // HE/EHT: 256-point FFT per 20 MHz, 234 data tones.
  switch (width) {
    case 20:
      return 234
    case 40:
      return 468
    case 80:
      return 980
    case 160:
      return 1960
    case 320:
      return 3920
  }
}

/** OFDM symbol duration including the guard interval, seconds. */
export function symbolDuration(generation: Generation, guardIntervalUs: number): number {
  const fftDurationUs = generation === 'ht' || generation === 'vht' ? 3.2 : 12.8
  return (fftDurationUs + guardIntervalUs) * 1e-6
}

/** PHY data rate, bits per second. */
export function phyRateBps(
  generation: Generation,
  width: ChannelWidthMHz,
  mcs: number,
  spatialStreams: number,
  guardIntervalUs: number,
): number {
  const entry = MCS_TABLE[mcs]
  if (!entry) return 0
  const nsd = dataSubcarriers(generation, width)
  return (
    (spatialStreams * nsd * entry.bitsPerSymbol * entry.codingRate) /
    symbolDuration(generation, guardIntervalUs)
  )
}

/** Thermal noise power in the channel, dBm. */
export function noiseFloorDbm(widthMHz: number, noiseFigureDb: number): number {
  return THERMAL_NOISE_DBM_PER_HZ + 10 * Math.log10(widthMHz * 1e6) + noiseFigureDb
}

/**
 * SNR each MCS needs, derived from the standard's minimum sensitivity.
 *
 * The standard's sensitivity is specified against a reference receiver with
 * `referenceNoiseFigureDb` noise figure and `implementationMarginDb` margin, so
 * subtracting that reference noise floor recovers a bandwidth-independent
 * required SNR — sensitivity and noise both scale with bandwidth.
 */
export function requiredSnrDb(
  mcs: number,
  referenceNoiseFigureDb = 5,
  implementationMarginDb = 5,
): number {
  const entry = MCS_TABLE[mcs]
  if (!entry) return Infinity
  const referenceNoise = noiseFloorDbm(20, referenceNoiseFigureDb) + implementationMarginDb
  return entry.sensitivity20MHzDbm - referenceNoise
}

export interface RateSelection {
  mcs: number
  entry: ModulationEntry | null
  phyRateBps: number
  requiredSnrDb: number
  spatialStreams: number
}

/** Highest MCS the given SINR supports, and the resulting PHY rate. */
export function selectRate(
  sinrDb: number,
  generation: Generation,
  width: ChannelWidthMHz,
  spatialStreams: number,
  guardIntervalUs: number,
  implementationMarginDb: number,
): RateSelection {
  const limit = maxMcsFor(generation)
  for (let mcs = limit; mcs >= 0; mcs--) {
    const need = requiredSnrDb(mcs, 5, implementationMarginDb)
    if (sinrDb >= need) {
      return {
        mcs,
        entry: MCS_TABLE[mcs],
        phyRateBps: phyRateBps(generation, width, mcs, spatialStreams, guardIntervalUs),
        requiredSnrDb: need,
        spatialStreams,
      }
    }
  }
  return {
    mcs: -1,
    entry: null,
    phyRateBps: 0,
    requiredSnrDb: requiredSnrDb(0, 5, implementationMarginDb),
    spatialStreams,
  }
}

// ---------------------------------------------------------------------------
// MAC efficiency
// ---------------------------------------------------------------------------

export interface MacParameters {
  /** PHY preamble + signalling, microseconds. */
  preambleUs: number
  /** Short interframe space, microseconds. 16 us for OFDM PHYs. */
  sifsUs: number
  slotUs: number
  /** Contention window minimum for best-effort access, in slots. */
  cwMin: number
  /** Target A-MPDU on-air duration, microseconds. */
  targetPpduUs: number
  /** MPDU payload size, octets. */
  mpduOctets: number
  /** Block acknowledgement airtime including its own preamble, microseconds. */
  blockAckUs: number
}

/**
 * Defaults for a single HE link on 5/6 GHz. The preamble figure is the HE SU
 * PPDU pre-HE portion (L-STF/L-LTF/L-SIG/RL-SIG/HE-SIG-A = 32 us) plus HE-STF
 * and two HE-LTF symbols; DIFS is derived as SIFS + 2 slots.
 */
export const DEFAULT_MAC: MacParameters = {
  preambleUs: 52,
  sifsUs: 16,
  slotUs: 9,
  cwMin: 15,
  targetPpduUs: 4000,
  mpduOctets: 1500,
  blockAckUs: 68,
}

export interface ThroughputResult {
  throughputBps: number
  efficiency: number
  mpdusPerAggregate: number
  airtimeUs: number
}

/**
 * Single-link goodput: how much payload actually fits through, once the
 * preamble, the interframe spaces, the average backoff and the block ack are
 * paid for once per aggregate.
 *
 * This is a single-station model. It does not represent several clients sharing
 * the channel, OFDMA scheduling or MU-MIMO, so treat it as the ceiling one
 * device can reach on an otherwise idle channel.
 */
export function throughput(phyRateBps: number, mac: MacParameters): ThroughputResult {
  if (phyRateBps <= 0) {
    return { throughputBps: 0, efficiency: 0, mpdusPerAggregate: 0, airtimeUs: 0 }
  }
  const mpduBits = mac.mpduOctets * 8
  const bitsPerTarget = phyRateBps * (mac.targetPpduUs * 1e-6)
  const mpdus = Math.max(1, Math.floor(bitsPerTarget / mpduBits))

  const dataUs = ((mpdus * mpduBits) / phyRateBps) * 1e6
  const difsUs = mac.sifsUs + 2 * mac.slotUs
  const backoffUs = (mac.cwMin / 2) * mac.slotUs
  const airtimeUs =
    difsUs + backoffUs + mac.preambleUs + dataUs + mac.sifsUs + mac.blockAckUs

  const throughputBps = (mpdus * mpduBits) / (airtimeUs * 1e-6)
  return {
    throughputBps,
    efficiency: throughputBps / phyRateBps,
    mpdusPerAggregate: mpdus,
    airtimeUs,
  }
}

// ---------------------------------------------------------------------------
// Regulatory limits
// ---------------------------------------------------------------------------

export type RegulatoryDomain = 'etsi' | 'fcc'

export interface PowerLimit {
  band: Band
  fromMHz: number
  toMHz: number
  maxEirpDbm: number
  /** Power spectral density limit, dBm/MHz. null when none applies. */
  maxPsdDbmPerMHz: number | null
  indoorOnly: boolean
  requiresDfs: boolean
  citation: string
  note?: string
}

export const POWER_LIMITS: Record<RegulatoryDomain, PowerLimit[]> = {
  etsi: [
    {
      band: '2.4',
      fromMHz: 2400,
      toMHz: 2483.5,
      maxEirpDbm: 20,
      maxPsdDbmPerMHz: 10,
      indoorOnly: false,
      requiresDfs: false,
      citation: 'ETSI EN 300 328 V2.2.2, clause 4.3.2.2',
    },
    {
      band: '5',
      fromMHz: 5150,
      toMHz: 5350,
      maxEirpDbm: 23,
      maxPsdDbmPerMHz: 10,
      indoorOnly: true,
      requiresDfs: true,
      citation: 'ETSI EN 301 893 / EC Decision 2005/513/EC',
      note: '5150-5250 MHz indoor only; 5250-5350 MHz requires DFS and TPC.',
    },
    {
      band: '5',
      fromMHz: 5470,
      toMHz: 5725,
      maxEirpDbm: 30,
      maxPsdDbmPerMHz: 7,
      indoorOnly: false,
      requiresDfs: true,
      citation: 'ETSI EN 301 893, DFS and TPC mandatory',
    },
    {
      band: '6',
      fromMHz: 5925,
      toMHz: 6425,
      maxEirpDbm: 23,
      maxPsdDbmPerMHz: 10,
      indoorOnly: true,
      requiresDfs: false,
      citation: 'EC Implementing Decision (EU) 2021/1067, low-power indoor',
    },
  ],
  fcc: [
    {
      band: '2.4',
      fromMHz: 2400,
      toMHz: 2483.5,
      maxEirpDbm: 36,
      maxPsdDbmPerMHz: null,
      indoorOnly: false,
      requiresDfs: false,
      citation: '47 CFR 15.247',
      note: '30 dBm conducted with a 6 dBi antenna; higher gain requires a matching power reduction.',
    },
    {
      band: '5',
      fromMHz: 5150,
      toMHz: 5250,
      maxEirpDbm: 30,
      maxPsdDbmPerMHz: 11,
      indoorOnly: true,
      requiresDfs: false,
      citation: '47 CFR 15.407(a)(1)',
    },
    {
      band: '5',
      fromMHz: 5250,
      toMHz: 5725,
      maxEirpDbm: 30,
      maxPsdDbmPerMHz: 11,
      indoorOnly: false,
      requiresDfs: true,
      citation: '47 CFR 15.407(a)(2)-(3)',
    },
    {
      band: '5',
      fromMHz: 5725,
      toMHz: 5850,
      maxEirpDbm: 36,
      maxPsdDbmPerMHz: 30,
      indoorOnly: false,
      requiresDfs: false,
      citation: '47 CFR 15.407(a)(4)',
    },
    {
      band: '6',
      fromMHz: 5925,
      toMHz: 7125,
      maxEirpDbm: 30,
      maxPsdDbmPerMHz: 5,
      indoorOnly: true,
      requiresDfs: false,
      citation: '47 CFR 15.407, low-power indoor access point',
    },
  ],
}

export interface ComplianceCheck {
  limit: PowerLimit | null
  maxEirpDbm: number
  /** Limit implied by the power spectral density cap over the channel width. */
  psdLimitedEirpDbm: number | null
  compliant: boolean
  exceedanceDb: number
  messages: string[]
}

/** Check a configured EIRP against the applicable limit for its channel. */
export function checkCompliance(
  domain: RegulatoryDomain,
  centreFreqMHz: number,
  widthMHz: number,
  eirpDbm: number,
): ComplianceCheck {
  const limit =
    POWER_LIMITS[domain].find(
      (l) => centreFreqMHz >= l.fromMHz - widthMHz / 2 && centreFreqMHz <= l.toMHz + widthMHz / 2,
    ) ?? null

  if (!limit) {
    return {
      limit: null,
      maxEirpDbm: Infinity,
      psdLimitedEirpDbm: null,
      compliant: false,
      exceedanceDb: 0,
      messages: [
        `No ${domain.toUpperCase()} allocation covers ${centreFreqMHz} MHz — this channel is not usable in that domain.`,
      ],
    }
  }

  const psdLimited =
    limit.maxPsdDbmPerMHz === null
      ? null
      : limit.maxPsdDbmPerMHz + 10 * Math.log10(widthMHz)
  const effective = psdLimited === null ? limit.maxEirpDbm : Math.min(limit.maxEirpDbm, psdLimited)

  const messages: string[] = []
  if (limit.indoorOnly) messages.push('Indoor use only.')
  if (limit.requiresDfs) messages.push('DFS (radar detection) required.')
  if (psdLimited !== null && psdLimited < limit.maxEirpDbm) {
    messages.push(
      `Power spectral density is the binding limit at ${widthMHz} MHz: ${limit.maxPsdDbmPerMHz} dBm/MHz caps EIRP at ${psdLimited.toFixed(1)} dBm.`,
    )
  }

  return {
    limit,
    maxEirpDbm: effective,
    psdLimitedEirpDbm: psdLimited,
    compliant: eirpDbm <= effective + 1e-9,
    exceedanceDb: Math.max(0, eirpDbm - effective),
    messages,
  }
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

export interface ChannelDefinition {
  band: Band
  channel: number
  centreMHz: number
  widths: ChannelWidthMHz[]
}

/** Channel centre frequency, MHz. */
export function channelCentreMHz(band: Band, channel: number): number {
  if (band === '2.4') return 2407 + 5 * channel
  if (band === '5') return 5000 + 5 * channel
  return 5950 + 5 * channel // 6 GHz, per 802.11ax Annex E
}

export const CHANNELS_24 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]
export const CHANNELS_5 = [
  36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 149, 153,
  157, 161, 165,
]
export const CHANNELS_6 = [
  1, 5, 9, 13, 17, 21, 25, 29, 33, 37, 41, 45, 49, 53, 57, 61, 65, 69, 73, 77, 81, 85, 89, 93,
]

export function channelsFor(band: Band): number[] {
  return band === '2.4' ? CHANNELS_24 : band === '5' ? CHANNELS_5 : CHANNELS_6
}

/**
 * Fraction of an interferer's transmitted power that lands inside a victim
 * channel. Both occupancies are treated as rectangular, and the overlap is
 * normalised by the interferer's own width — the standard first-order
 * adjacent-channel model. Two 20 MHz channels three apart on 2.4 GHz overlap
 * partially; channel 1 against channel 11 does not overlap at all.
 */
export function channelOverlapFraction(
  victimCentreMHz: number,
  victimWidthMHz: number,
  interfererCentreMHz: number,
  interfererWidthMHz: number,
): number {
  const overlap =
    Math.min(victimCentreMHz + victimWidthMHz / 2, interfererCentreMHz + interfererWidthMHz / 2) -
    Math.max(victimCentreMHz - victimWidthMHz / 2, interfererCentreMHz - interfererWidthMHz / 2)
  if (overlap <= 0) return 0
  return Math.min(1, overlap / interfererWidthMHz)
}
