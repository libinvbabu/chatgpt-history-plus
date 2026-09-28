import { describe, expect, it } from 'vitest'
import { parseTimestamp, timestampFormat } from '../../src/utils/time'

describe('parseTimestamp', () => {
  it('reads unix seconds (float) and milliseconds', () => {
    expect(parseTimestamp(1790494800.52)).toBe(1790494800520)
    expect(parseTimestamp(1790494800520)).toBe(1790494800520)
    expect(parseTimestamp('1790494800')).toBe(1790494800000)
  })
  it('reads ISO strings, treating offset-less ones as UTC', () => {
    expect(parseTimestamp('2026-09-28T04:59:40.000000Z')).toBe(Date.UTC(2026, 8, 28, 4, 59, 40))
    expect(parseTimestamp('2026-09-27T06:34:00')).toBe(Date.UTC(2026, 8, 27, 6, 34))
    expect(parseTimestamp('2026-09-28T04:55:12.123456Z')).toBe(Date.UTC(2026, 8, 28, 4, 55, 12, 123))
    expect(parseTimestamp('2025-12-14T10:00:00+05:30')).toBe(Date.UTC(2025, 11, 14, 4, 30))
  })
  it('rejects junk', () => {
    for (const v of [null, undefined, '', '  ', 'not a date', 0, -5, NaN, Infinity, {}, [], true]) {
      expect(parseTimestamp(v)).toBeNull()
    }
  })
  it('classifies formats for diagnostics', () => {
    expect(timestampFormat(1790494800.5)).toBe('number')
    expect(timestampFormat('2026-09-28T04:59:40Z')).toBe('iso')
    expect(timestampFormat(null)).toBe('missing')
    expect(timestampFormat('nope')).toBe('invalid')
  })
})
