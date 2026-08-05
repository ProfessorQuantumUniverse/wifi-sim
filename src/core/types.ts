export interface Vec2 {
  x: number
  y: number
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

/**
 * Where a numeric value in the model came from. Every physical constant in the
 * simulator carries one of these so a report can state its origin instead of
 * presenting a guess as a measurement.
 */
export type Provenance =
  | { kind: 'standard'; citation: string }
  | { kind: 'literature'; citation: string }
  | { kind: 'derived'; from: string }
  | { kind: 'user'; note?: string }
  | { kind: 'measured'; note?: string }

export function provenanceLabel(p: Provenance): string {
  switch (p.kind) {
    case 'standard':
      return `Standard: ${p.citation}`
    case 'literature':
      return `Literature: ${p.citation}`
    case 'derived':
      return `Derived from ${p.from}`
    case 'user':
      return p.note ? `User input: ${p.note}` : 'User input'
    case 'measured':
      return p.note ? `Measured: ${p.note}` : 'Measured'
  }
}
