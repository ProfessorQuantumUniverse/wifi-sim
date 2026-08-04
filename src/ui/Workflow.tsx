import type { ReactNode } from 'react'

export interface Step {
  label: string
  /** Done, ready to do now, or still blocked by an earlier step. */
  state: 'done' | 'current' | 'blocked'
  hint: string
}

/**
 * The five things that have to happen in order, shown at the top of every
 * panel. Each panel passes the same list, so wherever you are you can see what
 * is already satisfied and what the next action is — the tool has enough steps
 * that "why is this button greyed out" is otherwise a real question.
 */
export function WorkflowSteps({ steps }: { steps: Step[] }) {
  return (
    <ol className="space-y-1 border-b border-slate-800 bg-slate-950/60 px-4 py-3">
      {steps.map((step, i) => (
        <li key={step.label} className="flex items-start gap-2">
          <span
            className={`mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${
              step.state === 'done'
                ? 'bg-emerald-600 text-white'
                : step.state === 'current'
                  ? 'bg-sky-500 text-white'
                  : 'bg-slate-800 text-slate-500'
            }`}
          >
            {step.state === 'done' ? '✓' : i + 1}
          </span>
          <span className="min-w-0">
            <span
              className={`text-[11px] font-medium ${
                step.state === 'blocked' ? 'text-slate-600' : 'text-slate-200'
              }`}
            >
              {step.label}
            </span>
            {step.state === 'current' && (
              <span className="block text-[10px] leading-snug text-sky-400">{step.hint}</span>
            )}
          </span>
        </li>
      ))}
    </ol>
  )
}

/**
 * A short explanation of what a panel section is for and where its numbers come
 * from, shown above the controls rather than buried in per-field tooltips.
 */
export function Explainer({ children }: { children: ReactNode }) {
  return (
    <p className="rounded border-l-2 border-slate-600 bg-slate-800/50 px-2 py-1.5 text-[10px] leading-relaxed text-slate-400">
      {children}
    </p>
  )
}
