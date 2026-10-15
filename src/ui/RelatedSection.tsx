// "Related to this chat": a reusable trio of rows (header, items, show-more).
// They are ordinary list rows with the same density and type as the history
// below; only the header icon and the date + time on the right set them apart.

import { memo } from 'react'
import type { RelatedHeaderRow, RelatedItemRow, RelatedMoreRow } from '../history/grouping'
import { formatDateTime, formatFull, type DateStyle } from '../utils/dates'
import { ChevronIcon, RelatedIcon } from './icons'
import { ConversationLink, conversationTooltip } from './Rows'

export const RelatedHeader = memo(function RelatedHeader({ row, id, onToggle }: { row: RelatedHeaderRow; id?: string; onToggle(row: RelatedHeaderRow): void }) {
  return (
    <button type="button" id={id} className="group related-head" role="treeitem" aria-level={1} aria-expanded={row.expanded} data-level={0} tabIndex={-1} onClick={() => onToggle(row)}>
      <ChevronIcon />
      <RelatedIcon className="rel-ico" />
      <span className="label">Related to this chat</span>
      <span className="n">{row.count}</span>
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
  locale?: string
  current: boolean
  onOpen(id: string): void
}

/** Related rows carry date and time, because no group header names the day. */
export const RelatedItem = memo(function RelatedItem({ row, id, now, dateStyle, locale, current, onOpen }: ItemProps) {
  const { conv, ts } = row.entry
  const when = ts == null ? 'No date' : dateStyle === 'absolute' ? formatFull(ts, locale) : formatDateTime(ts, now, locale)
  return (
    <ConversationLink conv={conv} id={id} ariaLevel={2} level={0} when={when} tooltip={conversationTooltip(conv, locale, row.reason)} current={current} related onOpen={onOpen} />
  )
})
