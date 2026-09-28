// Derives what the list shows from app state: sort → filter → group.
// Everything here is memoised on the inputs that matter, so typing in the
// search box only re-runs the filter and grouping over cached, sorted data.

import { useMemo, useRef } from 'react'
import { parseDatePhrase, rangeForMonth, rangeForYear, type DateContext } from '../history/date-query'
import { buildRows, sortEntries, type Entry, type Row } from '../history/grouping'
import { inRanges, makeSearchDoc, matches, parseQuery, type FieldRange, type ParsedQuery, type SearchDoc } from '../history/search'
import { effectiveTime, type HistoryIndex, type Settings, type StoredConversation } from '../history/types'
import type { DateFilter, PresetId } from '../content/store'

export const PRESETS: Array<{ id: PresetId; label: string; phrase: string }> = [
  { id: 'today', label: 'Today', phrase: 'today' },
  { id: 'yesterday', label: 'Yesterday', phrase: 'yesterday' },
  { id: 'this-week', label: 'This week', phrase: 'this week' },
  { id: 'last-week', label: 'Last week', phrase: 'last week' },
  { id: 'last-7', label: 'Last 7 days', phrase: 'last 7 days' },
  { id: 'last-30', label: 'Last 30 days', phrase: 'last 30 days' },
  { id: 'this-month', label: 'This month', phrase: 'this month' },
  { id: 'last-month', label: 'Last month', phrase: 'last month' },
  { id: 'this-year', label: 'This year', phrase: 'this year' },
]

export function resolveDateFilter(filter: DateFilter | null, ctx: DateContext): FieldRange | null {
  if (!filter) return null
  let parsed
  switch (filter.kind) {
    case 'preset': {
      const p = PRESETS.find((x) => x.id === filter.id)
      parsed = p ? parseDatePhrase(p.phrase, ctx) : null
      if (parsed && p) return { field: 'active', ...parsed.range, label: p.label }
      return null
    }
    case 'month':
      parsed = rangeForMonth(filter.year, filter.month, ctx)
      break
    case 'year':
      parsed = rangeForYear(filter.year, ctx)
      break
    case 'custom':
      parsed = parseDatePhrase(filter.from === filter.to ? filter.from : `${filter.from} to ${filter.to}`, ctx)
      break
  }
  return parsed ? { field: 'active', ...parsed.range, label: parsed.label } : null
}

const docs = new Map<string, SearchDoc>()
function docFor(c: StoredConversation): SearchDoc {
  let d = docs.get(c.id)
  if (!d || d.title !== c.title) {
    d = makeSearchDoc(c.title)
    docs.set(c.id, d)
  }
  return d
}

export interface HistoryView {
  rows: Row[]
  sorted: Entry[]
  parsed: ParsedQuery
  filterRange: FieldRange | null
  filtering: boolean
  matchCount: number
  total: number
}

export function useHistoryView(args: {
  index: HistoryIndex | null
  indexRev: number
  settings: Settings
  query: string
  literal: boolean
  dateFilter: DateFilter | null
  collapsed: Record<string, boolean>
  transientCollapsed: Record<string, boolean>
  ctx: DateContext
}): HistoryView {
  const { index, indexRev, settings, query, literal, dateFilter, collapsed, transientCollapsed, ctx } = args
  const mode = settings.timestampMode

  const sorted = useMemo(() => {
    if (!index) return []
    const out: Entry[] = []
    for (const conv of Object.values(index.conversations)) out.push({ conv, ts: effectiveTime(conv, mode) })
    return sortEntries(out)
  }, [index, indexRev, mode]) // indexRev tracks in-place mutation of `index` during sync

  const parsed = useMemo(() => parseQuery(query, ctx, { literal }), [query, literal, ctx])
  const filterRange = useMemo(() => resolveDateFilter(dateFilter, ctx), [dateFilter, ctx])
  const filtering = parsed.terms.length > 0 || parsed.ranges.length > 0 || filterRange !== null

  const entries = useMemo(() => {
    if (!filtering) return sorted
    const extra = filterRange ? [filterRange] : []
    return sorted.filter((e) => matches(e.conv, docFor(e.conv), parsed, mode) && inRanges(e.conv, extra, mode))
  }, [sorted, parsed, filterRange, filtering, mode])

  const rows = useMemo(
    () =>
      buildRows(entries, {
        now: ctx.now,
        grouping: settings.grouping,
        weekStartsOn: ctx.weekStartsOn,
        locale: ctx.locale,
        collapsed: filtering ? transientCollapsed : collapsed,
        expandAll: filtering,
      }),
    [entries, ctx, settings.grouping, filtering, transientCollapsed, collapsed],
  )

  return { rows, sorted, parsed, filterRange, filtering, matchCount: entries.length, total: sorted.length }
}

/** A DateContext that only changes when the calendar day (or locale setup) does. */
export function useDateContext(now: Date, weekStartsOn: number, locale: string | undefined): DateContext {
  const ref = useRef<DateContext | null>(null)
  const day = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`
  const key = `${day}|${weekStartsOn}|${locale}`
  const keyRef = useRef('')
  if (!ref.current || keyRef.current !== key) {
    ref.current = { now, weekStartsOn, locale }
    keyRef.current = key
  }
  return ref.current
}
