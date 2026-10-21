// "Last active ▾": which date drives the timeline. A quiet text button, like the date menu beside it.

import type { TimestampMode } from '../history/types'
import { Item, usePopover } from './DateFilterMenu'
import { ChevronIcon } from './icons'

const LABELS: Record<TimestampMode, string> = { updated: 'Last active', created: 'Created' }

export function SortMenu({ value, onChange }: { value: TimestampMode; onChange(value: TimestampMode): void }) {
  const { open, setOpen, anchor, onKeyDown } = usePopover()
  const pick = (v: TimestampMode) => {
    onChange(v)
    setOpen(false)
  }
  return (
    <div className="popover-anchor" ref={anchor} onKeyDown={onKeyDown}>
      <button type="button" className="chip sort-chip" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)} title="Sort and group by">
        <span className="chip-label">{LABELS[value]}</span>
        <ChevronIcon size={12} />
      </button>
      {open && (
        <div className="popover narrow" role="menu" aria-label="Sort and group by">
          <Item checked={value === 'updated'} onClick={() => pick('updated')}>
            Last active
          </Item>
          <Item checked={value === 'created'} onClick={() => pick('created')}>
            Created
          </Item>
        </div>
      )}
    </div>
  )
}
