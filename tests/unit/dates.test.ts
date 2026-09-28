import { describe, expect, it } from 'vitest'
import { addDays, formatCompact, formatDayRange, formatRowTime, getWeekStartsOn, startOfWeek } from '../../src/utils/dates'
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

describe('formatting', () => {
  it('formats row times by context', () => {
    expect(formatRowTime(at(2026, 9, 28, 10, 5), true, 'relative', NOW, 'en-US')).toBe('10:05 AM')
    expect(formatRowTime(at(2026, 9, 25, 15, 42), false, 'relative', NOW, 'en-US')).toBe('Fri, Sep 25 · 3:42 PM')
    expect(formatRowTime(at(2025, 12, 14, 9, 0), false, 'relative', NOW, 'en-US')).toBe('Sun, Dec 14, 2025 · 9:00 AM')
    expect(formatRowTime(at(2026, 9, 25, 15, 42), true, 'absolute', NOW, 'en-US')).toBe('Sep 25, 2026 · 3:42 PM')
  })
  it('formats compact sidebar dates', () => {
    expect(formatCompact(at(2026, 9, 28, 10, 5), NOW, 'en-US')).toBe('10:05 AM')
    expect(formatCompact(at(2026, 9, 24), NOW, 'en-US')).toBe('Sep 24')
    expect(formatCompact(at(2025, 12, 14), NOW, 'en-US')).toBe('Dec 2025')
  })
  it('formats day ranges', () => {
    expect(formatDayRange(new Date(2026, 8, 21), new Date(2026, 8, 26), NOW, 'en-US')).toMatch(/^Sep 21\s*–\s*26$/)
    expect(formatDayRange(new Date(2026, 7, 31), new Date(2026, 8, 6), NOW, 'en-US')).toMatch(/^Aug 31\s*–\s*Sep 6$/)
    expect(formatDayRange(new Date(2025, 11, 28), new Date(2026, 0, 3), NOW, 'en-US')).toMatch(/^Dec 28, 2025\s*–\s*Jan 3, 2026$/)
  })
})
