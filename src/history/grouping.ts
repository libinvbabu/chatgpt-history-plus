// Chronological grouping, flattened into rows for a virtual list.
//
// Smart grouping (default):
//   Today · Yesterday · Earlier this week · Last week
//   <each month of the current year>
//   <each earlier year>  →  <its months>
// Today is always open. Every other group starts collapsed, and only the
// user's own choice (or a search) opens it. Week groups carry a day divider
// per day, so their rows need only a time; large month groups get week
// dividers ("Aug 17 – 23"), so "third week of August" is one expand and a
// short scroll away.

import { addDays, formatDayRange, formatters, monthKey, startOfDay, startOfMonth, startOfWeek, startOfYear } from '../utils/dates'
import type { StoredConversation } from './types'

export interface Entry {
  conv: StoredConversation
  ts: number | null
}

export type GroupRow = {
  type: 'group'
  key: string
  label: string
  sublabel?: string
  count: number
  level: 0 | 1
  expanded: boolean
  /** False for Today, which is always open and has nothing to toggle. */
  collapsible: boolean
}

export type DividerRow = {
  type: 'divider'
  key: string
  label: string
  count: number
}

export type ConversationRow = {
  type: 'conversation'
  key: string
  entry: Entry
  level: 0 | 1
  /** Row shows only a time, because the group already names the day. */
  timeOnly: boolean
}

/** "Related to this chat": built from the related engine, not from dates (see related-rows.ts). */
export type RelatedHeaderRow = { type: 'related-header'; key: 'related'; count: number; expanded: boolean }
export type RelatedItemRow = { type: 'related'; key: string; entry: Entry; /** Why it matched, for hover text. */ reason: string }
export type RelatedMoreRow = { type: 'related-more'; key: 'related:more'; hidden: number; expanded: boolean }

export type Row = GroupRow | DividerRow | ConversationRow | RelatedHeaderRow | RelatedItemRow | RelatedMoreRow

export interface GroupOptions {
  now: Date
  grouping: 'smart' | 'month'
  weekStartsOn: number
  locale?: string
  /** Persisted user overrides; keys absent from the map use the group's default. */
  collapsed: Readonly<Record<string, boolean>>
  /** Every group defaults to expanded (search results); overrides still apply. */
  expandAll?: boolean
  /** Minimum group size before week dividers appear. */
  weekDividerThreshold?: number
}

interface Bucket {
  key: string
  label: string
  sublabel?: string
  defaultExpanded: boolean
  /** Always open and not collapsible (Today). */
  fixedOpen?: boolean
  /** Label the header with the span of days its conversations actually fall on. */
  showRange?: boolean
  timeOnly?: boolean
  /** Subdivide into weeks (month groups) or days (week groups) when large. */
  split?: 'weeks' | 'days'
}

interface Path {
  top: Bucket
  sub?: Bucket
  /** Key and start time of the week/day divider this row falls under. */
  splitKey?: string
  splitStart?: number
}

interface Context {
  opts: GroupOptions
  today: number
  yesterday: number
  thisWeek: number
  lastWeek: number
  currentMonth: number
  currentYear: number
  f: ReturnType<typeof formatters>
  recent: {
    today: Bucket
    yesterday: Bucket
    thisWeek?: Bucket
    lastWeek: Bucket
  }
  monthBuckets: Map<string, Bucket>
  yearBuckets: Map<number, Bucket>
  unknown: Bucket
}

function makeContext(opts: GroupOptions): Context {
  const { now, weekStartsOn, locale } = opts
  const f = formatters(locale)
  const todayD = startOfDay(now)
  const yesterdayD = addDays(todayD, -1)
  const thisWeekD = startOfWeek(now, weekStartsOn)
  const lastWeekD = addDays(thisWeekD, -7)
  const recentEnd = thisWeekD < yesterdayD ? thisWeekD : yesterdayD
  const today = todayD.getTime()
  const yesterday = yesterdayD.getTime()
  const thisWeek = thisWeekD.getTime()
  return {
    opts,
    today,
    yesterday,
    thisWeek,
    lastWeek: lastWeekD.getTime(),
    currentMonth: startOfMonth(now).getTime(),
    currentYear: startOfYear(now).getTime(),
    f,
    recent: {
      today: { key: 'today', label: 'Today', sublabel: f.weekdayMonthDay.format(todayD), defaultExpanded: true, fixedOpen: true, timeOnly: true },
      yesterday: { key: 'yesterday', label: 'Yesterday', sublabel: f.weekdayMonthDay.format(yesterdayD), defaultExpanded: false, timeOnly: true },
      thisWeek:
        thisWeek < yesterday
          ? { key: 'this-week', label: 'Earlier this week', sublabel: formatDayRange(thisWeekD, addDays(yesterdayD, -1), now, locale), defaultExpanded: false, split: 'days' }
          : undefined,
      lastWeek: { key: 'last-week', label: 'Last week', sublabel: formatDayRange(lastWeekD, addDays(recentEnd, -1), now, locale), defaultExpanded: false, split: 'days' },
    },
    monthBuckets: new Map(),
    yearBuckets: new Map(),
    unknown: { key: 'unknown', label: 'Unknown date', defaultExpanded: false },
  }
}

function monthBucket(ctx: Context, ts: number, inYear: boolean): Bucket {
  const d = new Date(ts)
  const mk = monthKey(d)
  const key = inYear ? `y:${d.getFullYear()}/m:${mk}` : `m:${mk}`
  let b = ctx.monthBuckets.get(key)
  if (!b) {
    const isCurrent = startOfMonth(d).getTime() === ctx.currentMonth
    b = {
      key,
      label: inYear ? ctx.f.month.format(d) : ctx.f.monthYear.format(d),
      // Month grouping has no Today group, so the current month (which holds today) starts open there.
      defaultExpanded: isCurrent && ctx.opts.grouping === 'month',
      showRange: true,
      split: 'weeks',
    }
    ctx.monthBuckets.set(key, b)
  }
  return b
}

function yearBucket(ctx: Context, year: number): Bucket {
  let b = ctx.yearBuckets.get(year)
  if (!b) {
    b = { key: `y:${year}`, label: String(year), defaultExpanded: false, showRange: true }
    ctx.yearBuckets.set(year, b)
  }
  return b
}

function pathFor(ctx: Context, ts: number | null): Path {
  if (ts == null) return { top: ctx.unknown }
  let path: Path
  if (ctx.opts.grouping === 'month') {
    path = { top: monthBucket(ctx, ts, false) }
  } else if (ts >= ctx.today) {
    path = { top: ctx.recent.today }
  } else if (ts >= ctx.yesterday) {
    path = { top: ctx.recent.yesterday }
  } else if (ctx.recent.thisWeek && ts >= ctx.thisWeek) {
    path = { top: ctx.recent.thisWeek }
  } else if (ts >= ctx.lastWeek) {
    path = { top: ctx.recent.lastWeek }
  } else if (ts >= ctx.currentYear) {
    path = { top: monthBucket(ctx, ts, false) }
  } else {
    path = { top: yearBucket(ctx, new Date(ts).getFullYear()), sub: monthBucket(ctx, ts, true) }
  }
  const host = path.sub ?? path.top
  if (host.split) {
    const start = (host.split === 'weeks' ? startOfWeek(ts, ctx.opts.weekStartsOn) : startOfDay(ts)).getTime()
    path.splitKey = `${host.key}/${host.split === 'weeks' ? 'w' : 'd'}:${start}`
    path.splitStart = start
  }
  return path
}

/** Entries must already be sorted newest first. */
export function buildRows(entries: readonly Entry[], opts: GroupOptions): Row[] {
  const ctx = makeContext(opts)
  const monthThreshold = opts.weekDividerThreshold ?? 8
  const paths = new Array<Path>(entries.length)
  const counts = new Map<string, number>()
  const bump = (k: string) => counts.set(k, (counts.get(k) ?? 0) + 1)
  // First and last timestamp per group, for the date span shown on month and year headers.
  const span = new Map<string, [number, number]>()
  const widen = (k: string, ts: number | null) => {
    if (ts == null) return
    const r = span.get(k)
    if (!r) span.set(k, [ts, ts])
    else (r[0] = Math.min(r[0], ts)), (r[1] = Math.max(r[1], ts))
  }
  const spanLabel = (b: Bucket) => {
    const r = b.showRange ? span.get(b.key) : undefined
    return r ? formatDayRange(startOfDay(r[0]), startOfDay(r[1]), opts.now, opts.locale) : undefined
  }

  for (let i = 0; i < entries.length; i++) {
    const p = pathFor(ctx, entries[i]!.ts)
    paths[i] = p
    bump(p.top.key)
    widen(p.top.key, entries[i]!.ts)
    if (p.sub) (bump(p.sub.key), widen(p.sub.key, entries[i]!.ts))
    if (p.splitKey) bump(p.splitKey)
  }

  const isExpanded = (b: Bucket) => {
    if (b.fixedOpen) return true
    const override = opts.collapsed[b.key]
    return override === undefined ? !!opts.expandAll || b.defaultExpanded : !override
  }
  const rows: Row[] = []
  let topKey: string | null = null
  let subKey: string | null = null
  let splitKey: string | null = null
  let topOpen = false
  let subOpen = false

  for (let i = 0; i < entries.length; i++) {
    const p = paths[i]!
    if (p.top.key !== topKey) {
      topKey = p.top.key
      subKey = null
      splitKey = null
      topOpen = isExpanded(p.top)
      rows.push({ type: 'group', key: p.top.key, label: p.top.label, sublabel: p.top.sublabel ?? spanLabel(p.top), count: counts.get(p.top.key)!, level: 0, expanded: topOpen, collapsible: !p.top.fixedOpen })
    }
    if (!topOpen) continue
    if (p.sub && p.sub.key !== subKey) {
      subKey = p.sub.key
      splitKey = null
      subOpen = isExpanded(p.sub)
      rows.push({ type: 'group', key: p.sub.key, label: p.sub.label, sublabel: spanLabel(p.sub), count: counts.get(p.sub.key)!, level: 1, expanded: subOpen, collapsible: true })
    }
    if (p.sub && !subOpen) continue
    const host = p.sub ?? p.top
    // Week groups always get a divider per day, so their rows can show just a time.
    const split = !!p.splitKey && counts.get(host.key)! >= (host.split === 'days' ? 1 : monthThreshold)
    if (split && p.splitKey !== splitKey) {
      splitKey = p.splitKey!
      const start = new Date(p.splitStart!)
      const label = host.split === 'weeks' ? formatDayRange(start, addDays(start, 6), opts.now, opts.locale) : ctx.f.weekdayMonthDay.format(start)
      rows.push({ type: 'divider', key: splitKey, label, count: counts.get(splitKey)! })
    }
    const entry = entries[i]!
    // Under a day divider, the row only needs its time.
    const timeOnly = !!p.top.timeOnly || (split && host.split === 'days')
    rows.push({ type: 'conversation', key: `c:${entry.conv.id}`, entry, level: p.sub ? 1 : 0, timeOnly })
  }
  return rows
}

/** Sort newest first; conversations without a timestamp go last, by title. */
export function sortEntries(entries: Entry[]): Entry[] {
  return entries.sort((a, b) => {
    if (a.ts === b.ts) return a.conv.title.localeCompare(b.conv.title)
    if (a.ts == null) return 1
    if (b.ts == null) return -1
    return b.ts - a.ts
  })
}
