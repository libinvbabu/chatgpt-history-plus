// Local title search with lightweight date understanding.
//
// Plain words match titles (AND, substring). Date syntax narrows by time:
//   operators   after:2026-08-01  before:sep-20  in:sep  on:2026-09-23
//               created:2026-09   updated:last-week  year:2025 month:dec
//   phrases     "last week", "aug 2026", "around sep 14" — as the whole
//               query, or attached to text: "paytm last week", "paytm in aug"
// Quoted text is always literal: "march madness" is a title search.

import { fold, normalize } from '../utils/normalize'
import { MONTHS, RELATIVE_KEYWORDS, parseDatePhrase, rangeForMonth, type DateContext, type ParsedDate } from './date-query'
import { effectiveTime, type ConversationMetadata, type TimestampMode } from './types'

export type RangeField = 'active' | 'created' | 'updated'

export interface FieldRange {
  field: RangeField
  start: number
  end: number
  label: string
}

export interface SearchTerm {
  raw: string
  folded: string
  normalized: string
}

export interface ParsedQuery {
  terms: SearchTerm[]
  ranges: FieldRange[]
  /** Free text that was read as a date rather than as title words. */
  inferredDate: string | null
  warnings: string[]
}

const OPERATORS = new Set(['after', 'since', 'before', 'until', 'in', 'on', 'date', 'during', 'created', 'updated', 'year', 'month'])
const CONNECTORS = new Set(['in', 'on', 'during', 'from', 'since', 'after', 'before'])
const TOKEN = /(\w+):"([^"]*)"?|"([^"]*)"?|(\S+)/g

export function parseQuery(input: string, ctx: DateContext, opts: { literal?: boolean } = {}): ParsedQuery {
  const result: ParsedQuery = { terms: [], ranges: [], inferredDate: null, warnings: [] }
  const free: string[] = []
  const phrases: string[] = []
  let yearOp: number | null = null
  let monthOp: number | null = null

  for (const m of input.matchAll(TOKEN)) {
    let key: string | undefined
    let value: string | undefined
    if (m[1] !== undefined) {
      key = m[1].toLowerCase()
      value = m[2]
    } else if (m[3] !== undefined) {
      if (m[3].trim()) phrases.push(m[3])
      continue
    } else if (m[4]) {
      const op = /^([a-z]+):(.+)$/i.exec(m[4])
      if (op && OPERATORS.has(op[1]!.toLowerCase())) {
        key = op[1]!.toLowerCase()
        value = op[2]
      } else {
        free.push(m[4])
        continue
      }
    }
    if (!key || !OPERATORS.has(key)) {
      if (m[0].trim()) free.push(m[0])
      continue
    }
    if (!value?.trim()) continue

    if (key === 'year') {
      const y = /^\d{4}$/.test(value) ? Number(value) : NaN
      if (Number.isNaN(y)) result.warnings.push(`Couldn’t read year “${value}”`)
      else yearOp = y
      continue
    }
    if (key === 'month') {
      const mo = MONTHS[value.toLowerCase()] ?? (/^\d{1,2}$/.test(value) ? Number(value) - 1 : undefined)
      if (mo === undefined || mo < 0 || mo > 11) result.warnings.push(`Couldn’t read month “${value}”`)
      else monthOp = mo
      continue
    }

    const date = parseOperatorValue(value, ctx)
    if (!date) {
      result.warnings.push(`Couldn’t read date “${value}”`)
      continue
    }
    result.ranges.push(operatorRange(key, date))
  }

  if (yearOp !== null || monthOp !== null) {
    const date =
      monthOp === null
        ? parseDatePhrase(String(yearOp), ctx)
        : yearOp === null
          ? parseDatePhrase(Object.keys(MONTHS).find((k) => MONTHS[k] === monthOp)!, ctx)
          : rangeForMonth(yearOp, monthOp, ctx)
    if (date) result.ranges.push({ field: 'active', ...date.range, label: date.label })
  }

  let words = free
  if (!opts.literal && words.length) {
    const inferred = inferDate(words, ctx)
    if (inferred) {
      result.ranges.push(inferred.range)
      result.inferredDate = inferred.text
      words = inferred.rest
    }
  }

  for (const w of words) pushTerm(result.terms, w)
  for (const p of phrases) pushTerm(result.terms, p)
  return result
}

function pushTerm(terms: SearchTerm[], raw: string) {
  const t = { raw, folded: fold(raw), normalized: normalize(raw) }
  if (t.folded || t.normalized) terms.push(t)
}

function parseOperatorValue(value: string, ctx: DateContext): ParsedDate | null {
  return parseDatePhrase(value, ctx) ?? parseDatePhrase(value.replace(/[-_.]/g, ' '), ctx)
}

function operatorRange(key: string, date: ParsedDate): FieldRange {
  const { start, end } = date.range
  switch (key) {
    case 'after':
    case 'since':
      return { field: 'active', start, end: Infinity, label: `After ${date.label}` }
    case 'before':
      return { field: 'active', start: -Infinity, end: start, label: `Before ${date.label}` }
    case 'until':
      return { field: 'active', start: -Infinity, end, label: `Until ${date.label}` }
    case 'created':
      return { field: 'created', start, end, label: `Created ${date.label}` }
    case 'updated':
      return { field: 'updated', start, end, label: `Active ${date.label}` }
    default:
      return { field: 'active', start, end, label: date.label }
  }
}

interface Inferred {
  range: FieldRange
  text: string
  rest: string[]
}

/**
 * Finds a date phrase that is the whole free text, or its leading/trailing
 * part. A partial match must be unambiguous: several words ("sep 2026",
 * "last week"), a keyword ("yesterday"), or introduced by a connector
 * ("in aug"). A lone "august" next to other words stays a title word.
 */
function inferDate(words: string[], ctx: DateContext): Inferred | null {
  const whole = parseDatePhrase(words.join(' '), ctx)
  if (whole) return { range: { field: 'active', ...whole.range, label: whole.label }, text: words.join(' '), rest: [] }
  if (words.length < 2) return null

  // Longest trailing phrase first, then longest leading phrase.
  for (let k = 1; k < words.length; k++) {
    const hit = tryPart(words.slice(k), words.slice(0, k), 'suffix', ctx)
    if (hit) return hit
  }
  for (let k = words.length - 1; k >= 1; k--) {
    const hit = tryPart(words.slice(0, k), words.slice(k), 'prefix', ctx)
    if (hit) return hit
  }
  return null
}

function tryPart(part: string[], rest: string[], where: 'suffix' | 'prefix', ctx: DateContext): Inferred | null {
  let connector: string | null = null
  let restWords = rest
  let phraseWords = part
  if (where === 'suffix') {
    const last = rest[rest.length - 1]?.toLowerCase()
    if (last && CONNECTORS.has(last)) {
      connector = last
      restWords = rest.slice(0, -1)
    }
  } else {
    const first = part[0]?.toLowerCase()
    if (first && CONNECTORS.has(first)) {
      connector = first
      phraseWords = part.slice(1)
    }
  }
  if (!restWords.length || !phraseWords.length) return null

  const text = phraseWords.join(' ')
  const unambiguous = connector !== null || phraseWords.length >= 2 || RELATIVE_KEYWORDS.has(text.toLowerCase()) || /^\d{4}-\d{1,2}(-\d{1,2})?$/.test(text)
  if (!unambiguous) return null
  const date = parseDatePhrase(text, ctx)
  if (!date) return null

  const range: FieldRange =
    connector === 'since' || connector === 'after'
      ? { field: 'active', start: date.range.start, end: Infinity, label: `After ${date.label}` }
      : connector === 'before'
        ? { field: 'active', start: -Infinity, end: date.range.start, label: `Before ${date.label}` }
        : { field: 'active', ...date.range, label: date.label }
  return { range, text: (connector ? `${connector} ` : '') + text, rest: restWords }
}

// ---------------------------------------------------------------------------
// Matching

export interface SearchDoc {
  title: string
  folded: string
  normalized: string
}

export function makeSearchDoc(title: string): SearchDoc {
  return { title, folded: fold(title), normalized: normalize(title) }
}

export function termMatches(t: SearchTerm, doc: SearchDoc): boolean {
  if (t.folded && doc.folded.includes(t.folded)) return true
  // Punctuation-insensitive fallback ("pr#997" ↔ "PR #997"), but never for a
  // single character left over from something like "c++".
  return t.normalized.length >= 2 && doc.normalized.includes(t.normalized)
}

export function inRanges(c: ConversationMetadata, ranges: readonly FieldRange[], mode: TimestampMode): boolean {
  for (const r of ranges) {
    const ts = r.field === 'active' ? effectiveTime(c, mode) : r.field === 'created' ? c.createdAt : c.updatedAt
    if (ts == null || ts < r.start || ts >= r.end) return false
  }
  return true
}

export function matches(c: ConversationMetadata, doc: SearchDoc, q: ParsedQuery, mode: TimestampMode): boolean {
  for (const t of q.terms) if (!termMatches(t, doc)) return false
  return inRanges(c, q.ranges, mode)
}

/** Character ranges in `title` to highlight for the given terms, merged and sorted. */
export function highlightRanges(title: string, terms: readonly SearchTerm[]): Array<[number, number]> {
  if (!terms.length) return []
  const lower = title.toLowerCase()
  const out: Array<[number, number]> = []
  const mark = (needle: string) => {
    if (!needle) return false
    let found = false
    let i = lower.indexOf(needle)
    while (i !== -1) {
      out.push([i, i + needle.length])
      found = true
      i = lower.indexOf(needle, i + needle.length)
    }
    return found
  }
  for (const t of terms) {
    if (!mark(t.raw.toLowerCase())) for (const part of t.normalized.split(' ')) mark(part)
  }
  out.sort((a, b) => a[0] - b[0])
  const merged: Array<[number, number]> = []
  for (const r of out) {
    const last = merged[merged.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push([r[0], r[1]])
  }
  return merged
}
