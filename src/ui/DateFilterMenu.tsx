import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { DateFilter } from '../content/store'
import type { Entry } from '../history/grouping'
import { formatters } from '../utils/dates'
import { PRESETS } from './view'
import { CalendarIcon, CheckIcon, ChevronIcon } from './icons'

interface Props {
  value: DateFilter | null
  label: string | null
  sorted: readonly Entry[]
  now: Date
  locale?: string
  onChange(value: DateFilter | null): void
}

const RECENT_MONTHS = 18

export function DateFilterMenu({ value, label, sorted, now, locale, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const root = anchor.current?.getRootNode() as ShadowRoot | Document | undefined
    const onDown = (e: Event) => {
      if (!anchor.current?.contains(e.target as Node)) setOpen(false)
    }
    root?.addEventListener('pointerdown', onDown)
    // Clicks in the ChatGPT page are retargeted to our host; close on those too.
    const onDocDown = (e: Event) => {
      if (e.target !== (root as ShadowRoot | undefined)?.host) setOpen(false)
    }
    document.addEventListener('pointerdown', onDocDown)
    anchor.current?.querySelector<HTMLElement>('.popover .item')?.focus()
    return () => {
      root?.removeEventListener('pointerdown', onDown)
      document.removeEventListener('pointerdown', onDocDown)
    }
  }, [open])

  const periods = useMemo(() => (open ? countPeriods(sorted, now) : null), [open, sorted, now])
  const f = formatters(locale)

  const pick = (v: DateFilter | null) => {
    onChange(v)
    setOpen(false)
  }
  const is = (v: DateFilter) => JSON.stringify(v) === JSON.stringify(value)

  return (
    <div
      className="popover-anchor"
      ref={anchor}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation()
          setOpen(false)
          anchor.current?.querySelector<HTMLElement>('.chip')?.focus()
        }
      }}
    >
      <button type="button" className="chip" data-on={!!value} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} title={label ?? 'Filter by date'}>
        <CalendarIcon />
        <span className="chip-label">{value ? label : 'All dates'}</span>
        <ChevronIcon size={12} />
      </button>
      {open && periods && (
        <div className="popover" role="menu" aria-label="Filter by date">
          <Item checked={!value} onClick={() => pick(null)}>
            All dates
          </Item>
          <div className="grid2">
            {PRESETS.map((p) => (
              <Item key={p.id} checked={is({ kind: 'preset', id: p.id })} onClick={() => pick({ kind: 'preset', id: p.id })}>
                {p.label}
              </Item>
            ))}
          </div>
          {periods.months.length > 0 && (
            <>
              <div className="sep" />
              <div className="section">Months</div>
              {periods.months.map(({ year, month, count }) => (
                <Item key={`${year}-${month}`} count={count} checked={is({ kind: 'month', year, month })} onClick={() => pick({ kind: 'month', year, month })}>
                  {f.monthYear.format(new Date(year, month, 1))}
                </Item>
              ))}
            </>
          )}
          {periods.years.length > 0 && (
            <>
              <div className="sep" />
              <div className="section">Earlier</div>
              {periods.years.map(({ year, count }) => (
                <Item key={year} count={count} checked={is({ kind: 'year', year })} onClick={() => pick({ kind: 'year', year })}>
                  {year}
                </Item>
              ))}
            </>
          )}
          <div className="sep" />
          <div className="section">Custom range</div>
          <CustomRange value={value?.kind === 'custom' ? value : null} onApply={(from, to) => pick({ kind: 'custom', from, to })} />
        </div>
      )}
    </div>
  )
}

function Item({ checked, count, onClick, children }: { checked: boolean; count?: number; onClick(): void; children: ReactNode }) {
  return (
    <button type="button" className="item" role="menuitemradio" aria-checked={checked} onClick={onClick}>
      <span className="check">{checked && <CheckIcon />}</span>
      <span>{children}</span>
      {count !== undefined && <span className="n">{count.toLocaleString()}</span>}
    </button>
  )
}

function CustomRange({ value, onApply }: { value: { from: string; to: string } | null; onApply(from: string, to: string): void }) {
  const [from, setFrom] = useState(value?.from ?? '')
  const [to, setTo] = useState(value?.to ?? '')
  return (
    <form
      className="custom-range"
      onSubmit={(e) => {
        e.preventDefault()
        if (!from && !to) return
        const a = from || to
        const b = to || from
        onApply(a <= b ? a : b, a <= b ? b : a)
      }}
    >
      <label>
        From
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
      </label>
      <label>
        To
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </label>
      <button className="btn btn-sm" type="submit" disabled={!from && !to}>
        Apply range
      </button>
    </form>
  )
}

function countPeriods(sorted: readonly Entry[], now: Date) {
  const monthCounts = new Map<string, { year: number; month: number; count: number }>()
  const yearCounts = new Map<number, number>()
  const cutoff = new Date(now.getFullYear(), now.getMonth() - (RECENT_MONTHS - 1), 1).getTime()
  for (const e of sorted) {
    if (e.ts == null) continue
    const d = new Date(e.ts)
    if (e.ts >= cutoff) {
      const k = `${d.getFullYear()}-${d.getMonth()}`
      const m = monthCounts.get(k)
      if (m) m.count++
      else monthCounts.set(k, { year: d.getFullYear(), month: d.getMonth(), count: 1 })
    } else {
      yearCounts.set(d.getFullYear(), (yearCounts.get(d.getFullYear()) ?? 0) + 1)
    }
  }
  return {
    months: [...monthCounts.values()].sort((a, b) => b.year - a.year || b.month - a.month),
    years: [...yearCounts.entries()].sort((a, b) => b[0] - a[0]).map(([year, count]) => ({ year, count })),
  }
}
