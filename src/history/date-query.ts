// Natural date phrases → half-open local-time ranges [start, end).
//
//   today, yesterday, this/last week, this/last month, this/last year
//   last 30 days, past 2 weeks, past month
//   tuesday, last tuesday            (most recent one before today)
//   sep, september, sep 2026, 2026 sep
//   sep 23, 23 sep, sep 23 2026, 23rd of september
//   2026, 2026-09, 2026-09-23, 2026/9/23
//   early / mid / late aug           (1–10, 11–20, 21–end)
//   around sep 14                    (± 3 days)
//   week of sep 14
//   sep 20 - 27, aug 17 to aug 23, 2026-08-01 to 2026-08-15

import {
  DAY_MS,
  addDays,
  addMonths,
  daysInMonth,
  formatDayRange,
  formatters,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from '../utils/dates'

export interface DateRange {
  start: number
  end: number
}

export type Granularity = 'day' | 'week' | 'month' | 'year' | 'span'

export interface ParsedDate {
  range: DateRange
  granularity: Granularity
  label: string
}

export interface DateContext {
  now: Date
  weekStartsOn: number
  locale?: string
}

export const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
}

const WEEKDAYS: Record<string, number> = {
  sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2,
  wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5, sat: 6, saturday: 6,
}

const MIN_YEAR = 1990
const MAX_YEAR = 2100

/** Phrases that are unambiguously dates even as a single word inside a title search. */
export const RELATIVE_KEYWORDS = new Set(['today', 'yesterday'])

export function cleanPhrase(input: string): string {
  return input
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/,/g, ' ')
    .replace(/\b(\d{1,2})(st|nd|rd|th)\b/g, '$1')
    .replace(/\bof\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseDatePhrase(input: string, ctx: DateContext): ParsedDate | null {
  const s = cleanPhrase(input)
  if (!s) return null

  // "week of sep 14"
  const weekOf = /^week (.+)$/.exec(s) // "of" was stripped by cleanPhrase
  if (weekOf?.[1]) {
    const inner = parseSingle(weekOf[1], ctx)
    if (inner?.granularity === 'day') {
      const start = startOfWeek(inner.range.start, ctx.weekStartsOn)
      return make(start, addDays(start, 7), 'week', ctx)
    }
  }

  const range = parseRange(s, ctx)
  if (range) return range
  return parseSingle(s, ctx)
}

function parseRange(s: string, ctx: DateContext): ParsedDate | null {
  // "sep 20-27", "sep 20 - 27 2026"
  const dayRun = /^([a-z]+) (\d{1,2}) ?- ?(\d{1,2})(?: (\d{4}))?$/.exec(s)
  if (dayRun) {
    const [, m, d1, d2, y] = dayRun
    const left = parseSingle(`${m} ${d1}${y ? ` ${y}` : ''}`, ctx)
    const right = parseSingle(`${m} ${d2}${y ? ` ${y}` : ''}`, ctx)
    if (left && right) return span(left, right, ctx)
  }

  const m = /^(.+?) (?:-|to|until|through|thru) (.+)$/.exec(s)
  if (!m?.[1] || !m[2]) return null
  const left = parseSingle(m[1], ctx)
  if (!left) return null
  let right: ParsedDate | null
  if (/^\d{1,2}$/.test(m[2]) && left.granularity === 'day') {
    const d = new Date(left.range.start)
    right = dayOf(d.getFullYear(), d.getMonth(), Number(m[2]), ctx)
  } else {
    right = parseSingle(m[2], ctx)
  }
  return right ? span(left, right, ctx) : null
}

function span(a: ParsedDate, b: ParsedDate, ctx: DateContext): ParsedDate {
  const [first, second] = a.range.start <= b.range.start ? [a, b] : [b, a]
  return make(new Date(first.range.start), new Date(Math.max(first.range.end, second.range.end)), 'span', ctx)
}

function parseSingle(s: string, ctx: DateContext): ParsedDate | null {
  const { now, weekStartsOn } = ctx
  const today = startOfDay(now)

  switch (s) {
    case 'today':
      return make(today, addDays(today, 1), 'day', ctx, 'Today')
    case 'yesterday':
      return make(addDays(today, -1), today, 'day', ctx, 'Yesterday')
    case 'this week':
    case 'current week': {
      const start = startOfWeek(now, weekStartsOn)
      return make(start, addDays(start, 7), 'week', ctx, 'This week')
    }
    case 'last week':
    case 'previous week': {
      const end = startOfWeek(now, weekStartsOn)
      return make(addDays(end, -7), end, 'week', ctx, 'Last week')
    }
    case 'this month':
    case 'current month': {
      const start = startOfMonth(now)
      return make(start, addMonths(start, 1), 'month', ctx)
    }
    case 'last month':
    case 'previous month': {
      const end = startOfMonth(now)
      return make(addMonths(end, -1), end, 'month', ctx)
    }
    case 'this year':
      return yearOf(now.getFullYear(), ctx)
    case 'last year':
    case 'previous year':
      return yearOf(now.getFullYear() - 1, ctx)
  }

  // Rolling windows ending today: "last 30 days", "past 2 weeks", "past month".
  const rolling = /^(?:last|past|previous) (?:(\d{1,4}) )?(day|week|month|year)s?$/.exec(s)
  if (rolling && (rolling[1] || s.startsWith('past'))) {
    const n = Math.max(1, Number(rolling[1] ?? 1))
    const end = addDays(today, 1)
    let start: Date
    switch (rolling[2]) {
      case 'day': start = addDays(end, -n); break
      case 'week': start = addDays(end, -7 * n); break
      case 'month': start = new Date(today.getFullYear(), today.getMonth() - n, today.getDate() + 1); break
      default: start = new Date(today.getFullYear() - n, today.getMonth(), today.getDate() + 1)
    }
    const unit = rolling[2]!
    return make(start, end, 'span', ctx, rolling[1] ? `Last ${n} ${unit}${n === 1 ? '' : 's'}` : `Past ${unit}`)
  }

  // Weekdays: most recent occurrence strictly before today.
  const wd = /^(?:last |this |on )?([a-z]+)$/.exec(s)
  if (wd?.[1] && wd[1] in WEEKDAYS) {
    const target = WEEKDAYS[wd[1]]!
    let back = (today.getDay() - target + 7) % 7
    if (back === 0) back = 7
    const day = addDays(today, -back)
    return make(day, addDays(day, 1), 'day', ctx)
  }

  // "around sep 14" → ± 3 days
  const around = /^(?:around|about|circa|approx|approximately|~) ?(.+)$/.exec(s)
  if (around?.[1]) {
    const inner = parseSingle(around[1], ctx)
    if (inner?.granularity === 'day') {
      const d = new Date(inner.range.start)
      return make(addDays(d, -3), addDays(d, 4), 'span', ctx)
    }
    return inner
  }

  // "early aug", "mid september 2025", "late jan"
  const part = /^(early|mid|middle|late|end) (.+)$/.exec(s)
  if (part?.[1] && part[2]) {
    const inner = parseSingle(part[2], ctx)
    if (inner?.granularity !== 'month') return null
    const first = new Date(inner.range.start)
    const y = first.getFullYear()
    const mo = first.getMonth()
    const [from, to] = part[1] === 'early' ? [1, 10] : part[1] === 'mid' || part[1] === 'middle' ? [11, 20] : [21, daysInMonth(y, mo)]
    return make(new Date(y, mo, from), new Date(y, mo, to + 1), 'span', ctx)
  }

  // ISO-ish numeric forms.
  let m = /^(\d{4})$/.exec(s)
  if (m) return yearOf(Number(m[1]), ctx)
  m = /^(\d{4})[-/](\d{1,2})$/.exec(s)
  if (m) return monthOf(Number(m[1]), Number(m[2]) - 1, ctx)
  m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s)
  if (m) return dayOf(Number(m[1]), Number(m[2]) - 1, Number(m[3]), ctx)

  // Month names with optional day and year, in either order.
  const tokens = s.split(' ')
  if (tokens.length > 3) return null
  let month: number | undefined
  let day: number | undefined
  let year: number | undefined
  for (const t of tokens) {
    if (t in MONTHS && month === undefined) month = MONTHS[t]
    else if (/^\d{4}$/.test(t) && year === undefined) year = Number(t)
    else if (/^\d{1,2}$/.test(t) && day === undefined) day = Number(t)
    else return null
  }
  if (month === undefined) return null

  if (day === undefined) {
    if (year !== undefined) return monthOf(year, month, ctx)
    // Most recent occurrence of that month, including the current one.
    const y = month > now.getMonth() ? now.getFullYear() - 1 : now.getFullYear()
    return monthOf(y, month, ctx)
  }
  if (year !== undefined) return dayOf(year, month, day, ctx)
  // Most recent occurrence of that day, including today.
  const thisYear = dayOf(now.getFullYear(), month, day, ctx)
  if (thisYear && thisYear.range.start <= today.getTime()) return thisYear
  return dayOf(now.getFullYear() - 1, month, day, ctx)
}

function yearOf(y: number, ctx: DateContext): ParsedDate | null {
  if (y < MIN_YEAR || y > MAX_YEAR) return null
  return make(new Date(y, 0, 1), new Date(y + 1, 0, 1), 'year', ctx)
}

function monthOf(y: number, m: number, ctx: DateContext): ParsedDate | null {
  if (y < MIN_YEAR || y > MAX_YEAR || m < 0 || m > 11) return null
  return make(new Date(y, m, 1), new Date(y, m + 1, 1), 'month', ctx)
}

function dayOf(y: number, m: number, d: number, ctx: DateContext): ParsedDate | null {
  if (y < MIN_YEAR || y > MAX_YEAR || m < 0 || m > 11 || d < 1 || d > daysInMonth(y, m)) return null
  const start = new Date(y, m, d)
  return make(start, addDays(start, 1), 'day', ctx)
}

function make(start: Date, end: Date, granularity: Granularity, ctx: DateContext, prefix?: string): ParsedDate {
  const range = { start: start.getTime(), end: end.getTime() }
  const described = describeRange(range, granularity, ctx)
  const label = prefix && prefix !== described ? `${prefix} · ${described}` : described
  return { range, granularity, label }
}

export function describeRange(range: DateRange, granularity: Granularity, ctx: DateContext): string {
  const f = formatters(ctx.locale)
  const start = new Date(range.start)
  const lastDay = new Date(range.end - DAY_MS / 2)
  switch (granularity) {
    case 'year':
      return String(start.getFullYear())
    case 'month':
      return f.monthYear.format(start)
    case 'day':
      return f.weekdayMonthDayYear.format(start)
    default:
      return formatDayRange(start, startOfDay(lastDay), ctx.now, ctx.locale)
  }
}

export function rangeForYear(y: number, ctx: DateContext): ParsedDate | null {
  return yearOf(y, ctx)
}

export function rangeForMonth(y: number, m: number, ctx: DateContext): ParsedDate | null {
  return monthOf(y, m, ctx)
}
