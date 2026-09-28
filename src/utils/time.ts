// Timestamp parsing for undocumented API payloads.
//
// The ChatGPT web API has returned conversation times both as Unix seconds
// (floats) and as ISO-8601 strings, depending on endpoint and era. Accept
// either, and normalise everything to epoch milliseconds.

const ISO_NO_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/
const LONG_FRACTION = /(\.\d{3})\d+/

export type TimestampFormat = 'number' | 'iso' | 'missing' | 'invalid'

export function parseTimestamp(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return null
    // Below 1e11 it must be seconds (1e11 ms is 1973; 1e11 s is year 5138).
    return Math.round(value < 1e11 ? value * 1000 : value)
  }
  if (typeof value === 'string') {
    const s = value.trim()
    if (!s) return null
    if (/^\d+(\.\d+)?$/.test(s)) return parseTimestamp(Number(s))
    // Server timestamps without an offset are UTC, not local time.
    let iso = ISO_NO_OFFSET.test(s) ? `${s}Z` : s
    iso = iso.replace(LONG_FRACTION, '$1')
    const ms = Date.parse(iso)
    return Number.isNaN(ms) || ms <= 0 ? null : ms
  }
  return null
}

export function timestampFormat(value: unknown): TimestampFormat {
  if (value == null || value === '') return 'missing'
  const parsed = parseTimestamp(value)
  if (parsed == null) return 'invalid'
  return typeof value === 'number' || /^\d+(\.\d+)?$/.test(String(value).trim()) ? 'number' : 'iso'
}
