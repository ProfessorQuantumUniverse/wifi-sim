/**
 * Uniform Theory of Diffraction, wedge diffraction coefficient.
 *
 * Kouyoumjian, R. G. and Pathak, P. H., "A uniform geometrical theory of
 * diffraction for an edge in a perfectly conducting surface", Proc. IEEE 62(11),
 * 1974, 1448-1461. Dielectric faces are handled with Luebbers' heuristic
 * (IEEE Trans. AP-32(1), 1984, 70-76): the perfectly-conducting reflection
 * coefficients -1 / +1 are replaced by the actual Fresnel coefficients of the
 * two wedge faces.
 *
 * Because the engine models walls as zero-thickness surfaces carrying a
 * multilayer stack, every free edge is a half-plane (screen) edge, i.e. the
 * wedge parameter n = 2. That is the self-consistent choice for this geometry
 * model, not an approximation bolted on top of it.
 *
 * This term is what puts energy into the shadow region behind a corner. Without
 * it a ray model predicts an abrupt, unphysical cliff at the shadow boundary.
 */

import { cAdd, cMul, cScale, C, type Complex } from './complex'

/**
 * Fresnel transition function F(X) = 2j*sqrt(X)*exp(jX) * integral_sqrt(X)^inf exp(-j*tau^2) dtau.
 *
 * Below X = 5 the integral is evaluated with the Abramowitz & Stegun 7.3.32
 * rational approximation of the auxiliary Fresnel functions; above it the
 * asymptotic series is both simpler and more accurate, since A&S loses relative
 * precision once the auxiliary functions become small.
 */
export function fresnelTransition(x: number): Complex {
  if (x <= 0) return C(0, 0)

  if (x > 5) {
    // F(X) ~ 1 + j/(2X) - 3/(4X^2) - j*15/(8X^3) + 75/(16X^4)
    const x2 = x * x
    const x3 = x2 * x
    const x4 = x2 * x2
    return C(1 - 3 / (4 * x2) + 75 / (16 * x4), 1 / (2 * x) - 15 / (8 * x3))
  }

  // With u = sqrt(2X/pi) the argument of the Fresnel integrals, pi*u^2/2 = X.
  const u = Math.sqrt((2 * x) / Math.PI)
  const f = (1 + 0.926 * u) / (2 + 1.792 * u + 3.104 * u * u)
  const g = 1 / (2 + 4.142 * u + 3.492 * u * u + 6.67 * u * u * u)
  const c = Math.cos(x)
  const s = Math.sin(x)

  // integral = sqrt(pi/2) * [(1/2 - C(u)) - j(1/2 - S(u))]
  const integral = cScale(C(-f * s + g * c, -(f * c + g * s)), Math.sqrt(Math.PI / 2))
  // F = 2j*sqrt(X)*exp(jX) * integral
  const pre = cMul(C(0, 2 * Math.sqrt(x)), C(c, s))
  return cMul(pre, integral)
}

/** a^{+/-}(beta) = 2 cos^2( (2*pi*n*N - beta) / 2 ) with N the nearest integer. */
function aFactor(beta: number, n: number, sign: 1 | -1): number {
  // Solve 2*pi*n*N - beta = sign*pi for the nearest integer N.
  const nInt = Math.round((sign * Math.PI + beta) / (2 * Math.PI * n))
  const inner = (2 * Math.PI * n * nInt - beta) / 2
  return 2 * Math.cos(inner) * Math.cos(inner)
}

/**
 * How close the cotangent argument may get to a multiple of pi before the
 * limiting form below is used instead of the product.
 *
 * The product cot(arg) * F(k*L*a) is finite everywhere, but each factor alone
 * is not: on a shadow or reflection boundary the cotangent diverges while the
 * transition function goes to zero. Evaluating them separately there gives
 * Infinity * 0, so the term that is supposed to cancel the geometrical-optics
 * discontinuity silently disappears and the field collapses. That is not an
 * exotic case: a straight wall end and a regular evaluation grid put receiver
 * points exactly on the boundary routinely.
 */
const SINGULARITY_TOLERANCE = 1e-6

export interface UtdInput {
  /** Wavenumber 2*pi/lambda, 1/m. */
  k: number
  /** Source-to-edge and edge-to-field-point distances, m. */
  sPrime: number
  s: number
  /** Angle between the incident ray and the edge, radians (Keller cone angle). */
  beta0: number
  /** Incidence and diffraction angles measured from face 0, radians. */
  phiPrime: number
  phi: number
  /** Wedge parameter: exterior angle / pi. 2 = half-plane. */
  n: number
  /** Face reflection coefficients (Luebbers). Use -1/+1 for a conductor. */
  r0: Complex
  rN: Complex
}

/**
 * Diffraction coefficient D. Multiply the incident field at the edge by
 * D * sqrt(s'/(s*(s'+s))) * exp(-jks) to get the diffracted field.
 */
export function utdDiffractionCoefficient(input: UtdInput): Complex {
  const { k, sPrime, s, beta0, phiPrime, phi, n, r0, rN } = input
  const sinBeta0 = Math.sin(beta0)
  if (Math.abs(sinBeta0) < 1e-6) return C(0, 0)

  // Distance parameter for spherical-wave incidence.
  const L = ((sPrime * s) / (sPrime + s)) * sinBeta0 * sinBeta0

  const minus = phi - phiPrime
  const plus = phi + phiPrime

  const term = (beta: number, sign: 1 | -1, coeff: Complex | null): Complex => {
    const arg = (Math.PI + sign * beta) / (2 * n)
    const offset = arg - Math.round(arg / Math.PI) * Math.PI

    let base: Complex
    if (Math.abs(offset) < SINGULARITY_TOLERANCE) {
      // On the boundary the product has the finite limit
      //   cot(arg) * F(k*L*a)  ->  sgn(offset) * n * sqrt(2*pi*k*L) * exp(j*pi/4),
      // which follows from a -> 2*sin^2(n*offset) and F(X) -> sqrt(pi*X)*exp(j*pi/4).
      // The two sides of the boundary differ only in this sign, so either
      // branch gives the same half-strength magnitude exactly on it. That is
      // the physically right answer either way: a ray that grazes the edge is
      // treated as blocked, so the diffracted term alone has to carry the
      // half-strength field the boundary is defined by.
      const side = offset < 0 ? -1 : 1
      base = cScale(
        C(Math.SQRT1_2, Math.SQRT1_2),
        side * n * Math.sqrt(2 * Math.PI * k * L),
      )
    } else {
      const cot = Math.cos(arg) / Math.sin(arg)
      const f = fresnelTransition(k * L * aFactor(beta, n, sign))
      base = cScale(f, cot)
    }
    return coeff ? cMul(base, coeff) : base
  }

  // The two incident-shadow terms, then the two reflection-boundary terms.
  const sum = cAdd(
    cAdd(term(minus, 1, null), term(minus, -1, null)),
    cAdd(term(plus, -1, rN), term(plus, 1, r0)),
  )

  // Prefactor -exp(-j*pi/4) / (2n * sqrt(2*pi*k) * sin(beta0))
  const mag = -1 / (2 * n * Math.sqrt(2 * Math.PI * k) * sinBeta0)
  const phase = C(Math.cos(-Math.PI / 4), Math.sin(-Math.PI / 4))
  return cMul(cScale(phase, mag), sum)
}
