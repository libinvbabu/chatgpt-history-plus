// Chronological grouping, flattened into rows for a virtual list.
//
// Smart grouping (default):
//   Today · Yesterday · Earlier this week · Last week
//   <each month of the current year>
//   <each earlier year>  →  <its months>
// Large month groups get week dividers ("Aug 17 – 23") and large week groups
// get day dividers ("Sat, Sep 26"), so "third week of August" is one expand
// and a short scroll away.

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

export type Row = GroupRow | DividerRow | ConversationRow

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
      today: { key: 'today', label: 'Today', defaultExpanded: true, timeOnly: true },
      yesterday: { key: 'yesterday', label: 'Yesterday', sublabel: f.weekdayMonthDay.format(yesterdayD), defaultExpanded: true, timeOnly: true },
      thisWeek:
        thisWeek < yesterday
          ? { key: 'this-week', label: 'Earlier this week', sublabel: formatDayRange(thisWeekD, addDays(yesterdayD, -1), now, locale), defaultExpanded: true, split: 'days' }
          : undefined,
      lastWeek: { key: 'last-week', label: 'Last week', sublabel: formatDayRange(lastWeekD, addDays(recentEnd, -1), now, locale), defaultExpanded: true, split: 'days' },
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
      defaultExpanded: isCurrent,
      split: 'weeks',
    }
    ctx.monthBuckets.set(key, b)
  }
  return b
}

function yearBucket(ctx: Context, year: number): Bucket {
  let b = ctx.yearBuckets.get(year)
  if (!b) {
    b = { key: `y:${year}`, label: String(year), defaultExpanded: false }
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
  const threshold = opts.weekDividerThreshold ?? 8
  const paths = new Array<Path>(entries.length)
  const counts = new Map<string, number>()
  const bump = (k: string) => counts.set(k, (counts.get(k) ?? 0) + 1)

  for (let i = 0; i < entries.length; i++) {
    const p = pathFor(ctx, entries[i]!.ts)
    paths[i] = p
    bump(p.top.key)
    if (p.sub) bump(p.sub.key)
    if (p.splitKey) bump(p.splitKey)
  }

  const isExpanded = (b: Bucket) => {
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
      rows.push({ type: 'group', key: p.top.key, label: p.top.label, sublabel: p.top.sublabel, count: counts.get(p.top.key)!, level: 0, expanded: topOpen })
    }
    if (!topOpen) continue
    if (p.sub && p.sub.key !== subKey) {
      subKey = p.sub.key
      splitKey = null
      subOpen = isExpanded(p.sub)
      rows.push({ type: 'group', key: p.sub.key, label: p.sub.label, count: counts.get(p.sub.key)!, level: 1, expanded: subOpen })
    }
    if (p.sub && !subOpen) continue
    const host = p.sub ?? p.top
    const split = !!p.splitKey && counts.get(host.key)! >= threshold
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
