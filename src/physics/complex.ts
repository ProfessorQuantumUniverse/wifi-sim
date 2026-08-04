/** Minimal complex arithmetic. Values are plain objects so they stay debuggable. */

export interface Complex {
  re: number
  im: number
}

export const C = (re: number, im = 0): Complex => ({ re, im })

export const cAdd = (a: Complex, b: Complex): Complex => ({
  re: a.re + b.re,
  im: a.im + b.im,
})

export const cSub = (a: Complex, b: Complex): Complex => ({
  re: a.re - b.re,
  im: a.im - b.im,
})

export const cMul = (a: Complex, b: Complex): Complex => ({
  re: a.re * b.re - a.im * b.im,
  im: a.re * b.im + a.im * b.re,
})

export const cScale = (a: Complex, k: number): Complex => ({ re: a.re * k, im: a.im * k })

export function cDiv(a: Complex, b: Complex): Complex {
  const d = b.re * b.re + b.im * b.im
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d }
}

export const cAbs = (a: Complex): number => Math.hypot(a.re, a.im)

export const cAbs2 = (a: Complex): number => a.re * a.re + a.im * a.im

/**
 * Principal square root. For a passive medium the physical branch is the one
 * with non-negative real part, which is what the principal root gives.
 */
export function cSqrt(a: Complex): Complex {
  const r = Math.hypot(a.re, a.im)
  const re = Math.sqrt(Math.max(0, (r + a.re) / 2))
  let im = Math.sqrt(Math.max(0, (r - a.re) / 2))
  if (a.im < 0) im = -im
  return { re, im }
}

/** exp(i*z) for complex z. */
export function cExpI(z: Complex): Complex {
  const m = Math.exp(-z.im)
  return { re: m * Math.cos(z.re), im: m * Math.sin(z.re) }
}

export function cCos(z: Complex): Complex {
  // cos(x + iy) = cos x cosh y - i sin x sinh y
  return {
    re: Math.cos(z.re) * Math.cosh(z.im),
    im: -Math.sin(z.re) * Math.sinh(z.im),
  }
}

export function cSin(z: Complex): Complex {
  // sin(x + iy) = sin x cosh y + i cos x sinh y
  return {
    re: Math.sin(z.re) * Math.cosh(z.im),
    im: Math.cos(z.re) * Math.sinh(z.im),
  }
}
