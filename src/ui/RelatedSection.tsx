// "Related to this chat": a reusable trio of rows (header, items, show-more).
// They are ordinary list rows with the same density and type as the history
// below; only the header icon and the date + time on the right set them apart.

import { memo } from 'react'
import type { RelatedHeaderRow, RelatedItemRow, RelatedMoreRow } from '../history/grouping'
import { formatDateTime, formatFull, type DateStyle, type TimeFormat } from '../utils/dates'
import { ChevronIcon } from './icons'
import { ConversationLink, conversationTooltip, gapStyle } from './Rows'

export const RelatedHeader = memo(function RelatedHeader({ row, id, gap = 0, onToggle }: { row: RelatedHeaderRow; id?: string; gap?: number; onToggle(row: RelatedHeaderRow): void }) {
  return (
    <button type="button" id={id} className="group related-head" role="treeitem" aria-level={1} aria-expanded={row.expanded} data-level={0} style={gapStyle(gap)} tabIndex={-1} onClick={() => onToggle(row)}>
      <ChevronIcon />
      <span className="label">Related to this chat</span>
      <span className="n sublabel">{row.count}</span>
    </button>
  )
})

export const RelatedMore = memo(function RelatedMore({ row, id, onToggle }: { row: RelatedMoreRow; id?: string; onToggle(row: RelatedMoreRow): void }) {
  return (
    <button type="button" id={id} className="related-more" role="treeitem" aria-level={2} aria-expanded={row.expanded} tabIndex={-1} onClick={() => onToggle(row)}>
      {row.expanded ? 'Show less' : `Show ${row.hidden} more`}
    </button>
  )
})

interface ItemProps {
  row: RelatedItemRow
  id?: string
  now: Date
  dateStyle: DateStyle
  timeFormat: TimeFormat
  locale?: string
  current: boolean
  onOpen(id: string): void
}

/** Related rows carry date and time, because no group header names the day. */
export const RelatedItem = memo(function RelatedItem({ row, id, now, dateStyle, timeFormat, locale, current, onOpen }: ItemProps) {
  const { conv, ts } = row.entry
  const when = ts == null ? 'No date' : dateStyle === 'absolute' ? formatFull(ts, locale, timeFormat) : formatDateTime(ts, now, locale, timeFormat)
  return (
    <ConversationLink conv={conv} id={id} ariaLevel={2} level={0} when={when} tooltip={conversationTooltip(conv, locale, row.reason, timeFormat)} current={current} related onOpen={onOpen} />
  )
})
