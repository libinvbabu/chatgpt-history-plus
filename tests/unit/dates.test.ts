import { describe, expect, it } from 'vitest'
import { addDays, formatCompact, formatDayRange, formatDateTime, formatRowTime, getWeekStartsOn, startOfWeek } from '../../src/utils/dates'
import { NOW, at } from './helpers'

describe('calendar maths', () => {
  it('computes week starts for Sunday- and Monday-first locales', () => {
    expect(startOfWeek(NOW, 0)).toEqual(new Date(2026, 8, 27))
    expect(startOfWeek(NOW, 1)).toEqual(new Date(2026, 8, 28))
    expect(startOfWeek(new Date(2026, 8, 27), 1)).toEqual(new Date(2026, 8, 21))
  })
  it('adds days across a DST change without drifting', () => {
    // US DST ends 1 Nov 2026.
    expect(addDays(new Date(2026, 9, 31), 2)).toEqual(new Date(2026, 10, 2))
  })
  it('reads week info from Intl', () => {
    expect(getWeekStartsOn('en-US')).toBe(0)
    expect(getWeekStartsOn('en-GB')).toBe(1)
  })
})

// Intl separates the time from AM/PM with a narrow no-break space in recent ICU, a plain space in older ones.
const plain = (s: string) => s.replace(/[\u202f\u00a0]/g, ' ')

describe('formatting', () => {
  it('formats row times by context', () => {
    expect(formatRowTime(at(2026, 9, 28, 10, 5), true, 'relative', NOW, 'en-US', '24h')).toBe('10:05')
    expect(formatRowTime(at(2026, 9, 25, 15, 42), false, 'relative', NOW, 'en-US', '24h')).toBe('Sep 25 · 15:42')
    expect(formatRowTime(at(2025, 12, 14, 9, 0), false, 'relative', NOW, 'en-US', '24h')).toBe('Dec 14, 2025 · 09:00')
    expect(formatRowTime(at(2026, 9, 25, 15, 42), true, 'absolute', NOW, 'en-US', '24h')).toBe('Sep 25, 2026 · 15:42')
  })
  it('uses fixed-width 24-hour times, including just after midnight', () => {
    expect(formatRowTime(at(2026, 9, 28, 0, 9), true, 'relative', NOW, 'en-US', '24h')).toBe('00:09')
    expect(formatRowTime(at(2026, 9, 28, 21, 41), true, 'relative', NOW, 'en-US', '24h')).toBe('21:41')
    expect(formatRowTime(at(2026, 9, 28, 12, 0), true, 'relative', NOW, 'de-DE', '24h')).toBe('12:00')
    expect(formatDateTime(at(2026, 10, 14, 7, 5), NOW, 'en-US', '24h')).toBe('Oct 14 · 07:05')
    expect(formatDateTime(at(2025, 10, 14, 7, 5), NOW, 'en-US', '24h')).toBe('Oct 14, 2025 · 07:05')
  })
  it('shows fixed-width 12-hour times with AM/PM, and that is the default', () => {
    expect(plain(formatRowTime(at(2026, 9, 28, 21, 41), true, 'relative', NOW, 'en-US', '12h'))).toBe('09:41 PM')
    expect(plain(formatRowTime(at(2026, 9, 28, 10, 5), true, 'relative', NOW, 'en-US'))).toBe('10:05 AM')
    expect(plain(formatRowTime(at(2026, 9, 25, 15, 42), false, 'relative', NOW, 'en-US'))).toBe('Sep 25 · 03:42 PM')
    expect(plain(formatRowTime(at(2025, 12, 14, 9, 0), false, 'relative', NOW, 'en-US'))).toBe('Dec 14, 2025 · 09:00 AM')
    expect(plain(formatRowTime(at(2026, 9, 25, 15, 42), true, 'absolute', NOW, 'en-US'))).toBe('Sep 25, 2026 · 03:42 PM')
    expect(plain(formatDateTime(at(2026, 10, 14, 7, 5), NOW, 'en-US'))).toBe('Oct 14 · 07:05 AM')
  })
  it('gets midnight and noon right in 12-hour time', () => {
    expect(plain(formatRowTime(at(2026, 9, 28, 0, 9), true, 'relative', NOW, 'en-US', '12h'))).toBe('12:09 AM')
    expect(plain(formatRowTime(at(2026, 9, 28, 12, 0), true, 'relative', NOW, 'en-US', '12h'))).toBe('12:00 PM')
    expect(plain(formatRowTime(at(2026, 9, 28, 23, 59), true, 'relative', NOW, 'en-US', '12h'))).toBe('11:59 PM')
  })
  it('formats compact sidebar dates', () => {
    expect(formatCompact(at(2026, 9, 28, 10, 5), NOW, 'en-US', '24h')).toBe('10:05')
    expect(plain(formatCompact(at(2026, 9, 28, 15, 5), NOW, 'en-US', '12h'))).toBe('03:05 PM')
    expect(formatCompact(at(2026, 9, 24), NOW, 'en-US')).toBe('Sep 24')
    expect(formatCompact(at(2025, 12, 14), NOW, 'en-US')).toBe('Dec 2025')
  })
  it('formats day ranges', () => {
    expect(formatDayRange(new Date(2026, 8, 21), new Date(2026, 8, 26), NOW, 'en-US')).toMatch(/^Sep 21\s*–\s*26$/)
    expect(formatDayRange(new Date(2026, 7, 31), new Date(2026, 8, 6), NOW, 'en-US')).toMatch(/^Aug 31\s*–\s*Sep 6$/)
    expect(formatDayRange(new Date(2025, 11, 28), new Date(2026, 0, 3), NOW, 'en-US')).toMatch(/^Dec 28, 2025\s*–\s*Jan 3, 2026$/)
  })
})
