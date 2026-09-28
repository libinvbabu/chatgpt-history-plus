import { memo, type ReactNode } from 'react'
import type { ConversationRow, DividerRow, GroupRow } from '../history/grouping'
import { highlightRanges, type SearchTerm } from '../history/search'
import { formatFull, formatRowTime, type DateStyle } from '../utils/dates'
import { ChevronIcon } from './icons'

export const GroupHeader = memo(function GroupHeader({ row, id, onToggle }: { row: GroupRow; id?: string; onToggle(row: GroupRow): void }) {
  return (
    <button
      type="button"
      id={id}
      className="group"
      role="treeitem"
      aria-level={row.level + 1}
      aria-expanded={row.expanded}
      data-level={row.level}
      tabIndex={-1}
      onClick={() => onToggle(row)}
    >
      <ChevronIcon />
      <span className="label">{row.label}</span>
      {row.sublabel && <span className="sublabel">{row.sublabel}</span>}
      <span className="n">{row.count.toLocaleString()}</span>
    </button>
  )
})

export function Divider({ row }: { row: DividerRow }) {
  return (
    <div className="divider" role="none">
      <span>{row.label}</span>
      <span className="n">{row.count}</span>
    </div>
  )
}

interface ConversationProps {
  row: ConversationRow
  id: string
  now: Date
  dateStyle: DateStyle
  locale?: string
  terms: readonly SearchTerm[]
  current: boolean
  onOpen(id: string): void
}

export const ConversationItem = memo(function ConversationItem({ row, id, now, dateStyle, locale, terms, current, onOpen }: ConversationProps) {
  const { conv, ts } = row.entry
  const title = conv.title || 'Untitled conversation'
  const when = ts == null ? 'No date' : formatRowTime(ts, row.timeOnly, dateStyle, now, locale)
  const tooltip = `${title}\nCreated: ${conv.createdAt ? formatFull(conv.createdAt, locale) : '—'}\nLast active: ${conv.updatedAt ? formatFull(conv.updatedAt, locale) : '—'}`
  return (
    <a
      id={id}
      className="conv"
      role="treeitem"
      aria-level={row.level + 2}
      aria-current={current ? 'page' : undefined}
      data-level={row.level}
      href={`/c/${conv.id}`}
      title={tooltip}
      tabIndex={-1}
      onClick={(e) => {
        // Let the browser handle new-tab/window clicks natively.
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        e.preventDefault()
        onOpen(conv.id)
      }}
    >
      <span className={conv.title ? 'title' : 'title untitled'}>{conv.title ? highlight(title, terms) : title}</span>
      <span className="meta">
        {when}
        {conv.archived && <span className="badge">Archived</span>}
      </span>
    </a>
  )
})

function highlight(title: string, terms: readonly SearchTerm[]): ReactNode {
  const ranges = highlightRanges(title, terms)
  if (!ranges.length) return title
  const out: ReactNode[] = []
  let at = 0
  for (const [s, e] of ranges) {
    if (s > at) out.push(title.slice(at, s))
    out.push(<mark key={s}>{title.slice(s, e)}</mark>)
    at = e
  }
  if (at < title.length) out.push(title.slice(at))
  return out
}
