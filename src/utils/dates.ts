// Calendar arithmetic and display formatting. Everything is local time and
// built from (year, month, day) components so DST transitions are harmless.

export const DAY_MS = 86_400_000

export function startOfDay(d: Date | number): Date {
  const x = new Date(d)
  return new Date(x.getFullYear(), x.getMonth(), x.getDate())
}

export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}

/** weekStartsOn: 0 = Sunday … 6 = Saturday. */
export function startOfWeek(d: Date | number, weekStartsOn: number): Date {
  const s = startOfDay(d)
  return addDays(s, -((s.getDay() - weekStartsOn + 7) % 7))
}

export function startOfMonth(d: Date | number): Date {
  const x = new Date(d)
  return new Date(x.getFullYear(), x.getMonth(), 1)
}

export function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1)
}

export function startOfYear(d: Date | number): Date {
  return new Date(new Date(d).getFullYear(), 0, 1)
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

export function isSameDay(a: Date | number, b: Date | number): boolean {
  return startOfDay(a).getTime() === startOfDay(b).getTime()
}

export function monthKey(d: Date | number): string {
  const x = new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`
}

export function dayKey(d: Date | number): string {
  const x = new Date(d)
  return `${monthKey(x)}-${String(x.getDate()).padStart(2, '0')}`
}

type WeekInfoLocale = Intl.Locale & {
  getWeekInfo?: () => { firstDay: number }
  weekInfo?: { firstDay: number }
}

/** First day of the week for a locale (0 = Sunday). Falls back to Sunday. */
export function getWeekStartsOn(locale?: string): number {
  try {
    const loc = new Intl.Locale(locale ?? defaultLocale() ?? 'en-US') as WeekInfoLocale
    const info = loc.getWeekInfo?.() ?? loc.weekInfo
    // Intl uses 1 = Monday … 7 = Sunday.
    if (info && info.firstDay >= 1 && info.firstDay <= 7) return info.firstDay % 7
  } catch {
    // Unknown locale; use the default below.
  }
  return 0
}

export function defaultLocale(): string | undefined {
  return typeof navigator !== 'undefined' ? navigator.language : undefined
}

// ---------------------------------------------------------------------------
// Formatting

/** Clock style for times of day: "09:41 PM" or "21:41". */
export type TimeFormat = '12h' | '24h'

export interface Formatters {
  /** 24-hour, zero-padded: "21:41". */
  time: Intl.DateTimeFormat
  /** 12-hour with AM/PM: "09:41 PM". */
  time12: Intl.DateTimeFormat
  weekdayMonthDay: Intl.DateTimeFormat
  weekdayMonthDayYear: Intl.DateTimeFormat
  monthDay: Intl.DateTimeFormat
  monthDayYear: Intl.DateTimeFormat
  monthYear: Intl.DateTimeFormat
  monthShortYear: Intl.DateTimeFormat
  month: Intl.DateTimeFormat
}

const cache = new Map<string, Formatters>()

export function formatters(locale?: string): Formatters {
  const key = locale ?? defaultLocale() ?? ''
  let f = cache.get(key)
  if (!f) {
    const l = key || undefined
    f = {
      // Both in the user's local timezone, and both zero-padded so every time in a column is the same width:
      // "21:41", "00:09"; "09:41 PM", "12:09 AM".
      time: new Intl.DateTimeFormat(l, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }),
      time12: new Intl.DateTimeFormat(l, { hour: '2-digit', minute: '2-digit', hour12: true }),
      weekdayMonthDay: new Intl.DateTimeFormat(l, { weekday: 'short', month: 'short', day: 'numeric' }),
      weekdayMonthDayYear: new Intl.DateTimeFormat(l, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }),
      monthDay: new Intl.DateTimeFormat(l, { month: 'short', day: 'numeric' }),
      monthDayYear: new Intl.DateTimeFormat(l, { month: 'short', day: 'numeric', year: 'numeric' }),
      monthYear: new Intl.DateTimeFormat(l, { month: 'long', year: 'numeric' }),
      monthShortYear: new Intl.DateTimeFormat(l, { month: 'short', year: 'numeric' }),
      month: new Intl.DateTimeFormat(l, { month: 'long' }),
    }
    cache.set(key, f)
  }
  return f
}

export type DateStyle = 'relative' | 'absolute'

/** The time-of-day formatter for a clock style. */
export function timeOf(ts: number, timeFormat: TimeFormat, locale?: string): string {
  const f = formatters(locale)
  return (timeFormat === '24h' ? f.time : f.time12).format(ts)
}

/** "Sep 21 – 26", "Aug 31 – Sep 6", "Dec 28, 2025 – Jan 3, 2026". Both ends inclusive. */
export function formatDayRange(first: Date, last: Date, now: Date, locale?: string): string {
  const f = formatters(locale)
  if (isSameDay(first, last)) {
    return (first.getFullYear() === now.getFullYear() ? f.monthDay : f.monthDayYear).format(first)
  }
  const sameYearAsNow = first.getFullYear() === now.getFullYear() && last.getFullYear() === now.getFullYear()
  return (sameYearAsNow ? f.monthDay : f.monthDayYear).formatRange(first, last)
}

/** Full date + time, used in tooltips and absolute mode: "Sep 12, 2026, 3:42 PM". */
export function formatFull(ts: number, locale?: string, timeFormat: TimeFormat = '12h'): string {
  return `${formatters(locale).monthDayYear.format(ts)} · ${timeOf(ts, timeFormat, locale)}`
}

/** "Oct 14 · 09:41 PM", with the year when it is not the current one: the compact date + time used where no header names the day. */
export function formatDateTime(ts: number, now: Date, locale?: string, timeFormat: TimeFormat = '12h'): string {
  const f = formatters(locale)
  const date = new Date(ts).getFullYear() === now.getFullYear() ? f.monthDay : f.monthDayYear
  return `${date.format(ts)} · ${timeOf(ts, timeFormat, locale)}`
}

/**
 * The time on the right of a conversation row. Rows under a header or divider
 * that already names the day only need a time ("09:41 PM"); others carry a compact
 * date as well ("Oct 14 · 09:41 PM"). Absolute mode always shows both, in full.
 */
export function formatRowTime(ts: number, timeOnly: boolean, style: DateStyle, now: Date, locale?: string, timeFormat: TimeFormat = '12h'): string {
  if (style === 'absolute') return formatFull(ts, locale, timeFormat)
  return timeOnly ? timeOf(ts, timeFormat, locale) : formatDateTime(ts, now, locale, timeFormat)
}

/** Compact label for the native ChatGPT sidebar: "10:05 AM", "Sep 24", "Dec 2025". */
export function formatCompact(ts: number, now: Date, locale?: string, timeFormat: TimeFormat = '12h'): string {
  const f = formatters(locale)
  if (isSameDay(ts, now)) return timeOf(ts, timeFormat, locale)
  if (new Date(ts).getFullYear() === now.getFullYear()) return f.monthDay.format(ts)
  return f.monthShortYear.format(ts)
}

export function formatRelativeAgo(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000))
  if (s < 45) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} hr ago`
  const d = Math.round(h / 24)
  return d === 1 ? 'yesterday' : `${d} days ago`
}
