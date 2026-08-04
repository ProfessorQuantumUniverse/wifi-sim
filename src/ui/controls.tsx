import { useState, type ReactNode } from 'react'

export function Section({
  title,
  subtitle,
  children,
  defaultOpen = true,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="border-b border-slate-800">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-slate-800/40"
      >
        <span>
          <span className="text-sm font-semibold text-slate-100">{title}</span>
          {subtitle && (
            <span className="block text-xs text-slate-500">{subtitle}</span>
          )}
        </span>
        <span className="text-slate-500">{open ? '−' : '+'}</span>
      </button>
      {open && <div className="space-y-4 px-4 pb-4">{children}</div>}
    </section>
  )
}

export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  help,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  unit?: string
  help?: string
  onChange: (v: number) => void
}) {
  return (
    <label className="block">
      <span className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-slate-300">{label}</span>
        <span className="font-mono text-xs text-slate-400">
          {Number.isInteger(step) ? value : value.toFixed(2)}
          {unit ? ` ${unit}` : ''}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1.5 w-full accent-sky-400"
      />
      {help && <span className="mt-1 block text-[11px] leading-snug text-slate-500">{help}</span>}
    </label>
  )
}

export function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  unit,
  help,
  onChange,
}: {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  unit?: string
  help?: string
  onChange: (v: number) => void
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-300">{label}</span>
      <span className="mt-1.5 flex items-center gap-2">
        <input
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-sm text-slate-100 outline-none focus:border-sky-500"
        />
        {unit && <span className="text-xs text-slate-500">{unit}</span>}
      </span>
      {help && <span className="mt-1 block text-[11px] leading-snug text-slate-500">{help}</span>}
    </label>
  )
}

export function SelectField<T extends string>({
  label,
  value,
  options,
  help,
  onChange,
}: {
  label: string
  value: T
  options: Array<{ value: T; label: string }>
  help?: string
  onChange: (v: T) => void
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-slate-300">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="mt-1.5 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-100 outline-none focus:border-sky-500"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {help && <span className="mt-1 block text-[11px] leading-snug text-slate-500">{help}</span>}
    </label>
  )
}

export function Toggle({
  label,
  checked,
  help,
  onChange,
}: {
  label: string
  checked: boolean
  help?: string
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 accent-sky-400"
      />
      <span>
        <span className="text-xs font-medium text-slate-300">{label}</span>
        {help && <span className="block text-[11px] leading-snug text-slate-500">{help}</span>}
      </span>
    </label>
  )
}

export function Button({
  children,
  onClick,
  variant = 'default',
  disabled,
  title,
}: {
  children: ReactNode
  onClick: () => void
  variant?: 'default' | 'primary' | 'ghost'
  disabled?: boolean
  title?: string
}) {
  const styles = {
    default:
      'border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700 disabled:opacity-40',
    primary:
      'border border-sky-500 bg-sky-600 text-white hover:bg-sky-500 disabled:opacity-40',
    ghost: 'border border-transparent text-slate-400 hover:bg-slate-800 disabled:opacity-40',
  }[variant]
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`rounded px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed ${styles}`}
    >
      {children}
    </button>
  )
}
