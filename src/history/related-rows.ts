// The "Related to this chat" block as list rows, placed above Today.
//
// Presentation only: the engine decides *what* is related (src/related); this
// decides what the block shows. Two strongest by default, "Show more" up to
// the engine's limit, and the section collapses. Both choices live in the same
// persisted `collapsed` map as the date groups (a missing key = the default).

import type { Entry, Row } from './grouping'

export const RELATED_INITIAL = 2
export const RELATED_MAX = 10
export const RELATED_KEY = 'related'
export const RELATED_MORE_KEY = 'related:more'

export interface RelatedEntry {
  entry: Entry
  /** Why it matched, from the signals that actually matched. */
  reasons: string[]
}

export function buildRelatedRows(items: readonly RelatedEntry[], collapsed: Readonly<Record<string, boolean>>): Row[] {
  if (!items.length) return []
  const open = collapsed[RELATED_KEY] === undefined ? true : !collapsed[RELATED_KEY]
  // "Show more" is opt-in, so an explicit `false` ("not collapsed") is what turns it on.
  const showMore = collapsed[RELATED_MORE_KEY] === false
  const rows: Row[] = [{ type: 'related-header', key: RELATED_KEY, count: items.length, expanded: open }]
  if (!open) return rows
  for (const item of showMore ? items : items.slice(0, RELATED_INITIAL)) {
    rows.push({ type: 'related', key: `r:${item.entry.conv.id}`, entry: item.entry, reason: item.reasons.join(' · ') })
  }
  if (items.length > RELATED_INITIAL) {
    rows.push({ type: 'related-more', key: RELATED_MORE_KEY, hidden: items.length - RELATED_INITIAL, expanded: showMore })
  }
  return rows
}
