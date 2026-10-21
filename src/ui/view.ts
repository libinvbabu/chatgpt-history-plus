// Derives what the list shows from app state: sort → filter → group.
// Everything here is memoised on the inputs that matter, so typing in the
// search box only re-runs the filter and grouping over cached, sorted data.

import { useMemo, useRef } from 'react'
import { parseDatePhrase, rangeForMonth, rangeForYear, type DateContext } from '../history/date-query'
import { buildRows, sortEntries, type Entry, type Row } from '../history/grouping'
import { buildRelatedRows, type RelatedEntry } from '../history/related-rows'
import { inRanges, makeSearchDoc, matches, parseQuery, type FieldRange, type ParsedQuery, type SearchDoc } from '../history/search'
import { effectiveTime, type HistoryIndex, type Settings, type StoredConversation } from '../history/types'
import type { DateFilter, PresetId } from '../content/store'
import { filterFor, FILTERS, type CategoryFilterId, type FilterId } from './categories'

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

export type CategoryCounts = Record<FilterId, number>

export interface HistoryView {
  rows: Row[]
  sorted: Entry[]
  parsed: ParsedQuery
  filterRange: FieldRange | null
  /** A search or date filter is narrowing the list. (A category alone is not: groups keep the user's collapse state.) */
  filtering: boolean
  /** Anything at all is narrowing the list, category included. */
  narrowed: boolean
  /** Per chip, how many conversations pass the search and date filters. Independent of the selected chip, so it says what picking one would show. */
  categoryCounts: CategoryCounts
  matchCount: number
  total: number
}

export function countByCategory(entries: readonly Entry[]): CategoryCounts {
  const counts = Object.fromEntries(FILTERS.map((f) => [f.id, 0])) as CategoryCounts
  counts.all = entries.length
  for (const e of entries) counts[filterFor(e.conv)]++
  return counts
}

export function useHistoryView(args: {
  index: HistoryIndex | null
  indexRev: number
  settings: Settings
  query: string
  literal: boolean
  dateFilter: DateFilter | null
  category: FilterId
  collapsed: Record<string, boolean>
  transientCollapsed: Record<string, boolean>
  ctx: DateContext
  /** Chats related to the open one; shown above Today when not searching. */
  related: readonly RelatedEntry[]
}): HistoryView {
  const { index, indexRev, settings, query, literal, dateFilter, category, collapsed, transientCollapsed, ctx, related } = args
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

  // Search and date first; the category chip narrows what is left. Counts per chip come from the step before it.
  const scoped = useMemo(() => {
    if (!filtering) return sorted
    const extra = filterRange ? [filterRange] : []
    return sorted.filter((e) => matches(e.conv, docFor(e.conv), parsed, mode) && inRanges(e.conv, extra, mode))
  }, [sorted, parsed, filterRange, filtering, mode])
  const categoryCounts = useMemo(() => countByCategory(scoped), [scoped])
  const entries = useMemo(() => (category === 'all' ? scoped : scoped.filter((e) => filterFor(e.conv) === category)), [scoped, category])

  const chronological = useMemo(
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

  // Searching shows matches only; the related block steps aside. A chip keeps it, narrowed to the same category.
  const relatedRows = useMemo(() => {
    if (filtering) return []
    const items = category === 'all' ? related : related.filter((r) => filterFor(r.entry.conv) === (category as CategoryFilterId))
    return buildRelatedRows(items, collapsed)
  }, [filtering, related, category, collapsed])
  const rows = useMemo(() => (relatedRows.length ? [...relatedRows, ...chronological] : chronological), [relatedRows, chronological])

  return { rows, sorted, parsed, filterRange, filtering, narrowed: filtering || category !== 'all', categoryCounts, matchCount: entries.length, total: sorted.length }
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
