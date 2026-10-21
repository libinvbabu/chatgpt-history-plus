// The category chips under the search box: one row that scrolls sideways and
// never wraps. No numbers on the chips (the count for the current search and
// dates is the hover text). An edge fades while more chips lie beyond it.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { FILTERS, type FilterId } from './categories'
import { Glyph } from './CategoryIcon'
import type { CategoryCounts } from './view'

interface Props {
  value: FilterId
  /** Per chip, under the current search and date filters: what picking it would show. */
  counts: CategoryCounts
  onChange(id: FilterId): void
}

/** Room kept between a chip scrolled into view and the scroller's edge (it sits clear of the fade). */
const EDGE_PX = 28

const chats = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'chat' : 'chats'}`

export function CategoryFilters({ value, counts, onChange }: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const [fade, setFade] = useState({ start: false, end: false })

  const measure = useCallback(() => {
    const el = scroller.current
    if (!el) return
    const start = el.scrollLeft > 1
    const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
    setFade((f) => (f.start === start && f.end === end ? f : { start, end }))
  }, [])

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    // A mouse wheel scrolls the row sideways. Over the chips the wheel belongs to
    // them, so it never scrolls the list or ChatGPT's page behind the panel.
    // Needs a non-passive listener: React's onWheel cannot preventDefault.
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return
      e.preventDefault()
      el.scrollLeft += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      ro.disconnect()
      el.removeEventListener('wheel', onWheel)
    }
  }, [measure])

  /** Scroll a chip fully into view, clear of the faded edges. */
  const reveal = useCallback(
    (chip: HTMLElement | null | undefined) => {
      const el = scroller.current
      if (!el || !chip) return
      const left = chip.offsetLeft
      const right = left + chip.offsetWidth
      if (left < el.scrollLeft + EDGE_PX) el.scrollLeft = Math.max(0, left - EDGE_PX)
      else if (right > el.scrollLeft + el.clientWidth - EDGE_PX) el.scrollLeft = right - el.clientWidth + EDGE_PX
      measure()
    },
    [measure],
  )

  // Keep the selected chip in view: when the panel opens, and whenever the selection changes.
  useEffect(() => reveal(scroller.current?.querySelector<HTMLElement>('[aria-pressed="true"]')), [value, reveal])

  // One tab stop for the row; arrows move between chips (scrolling them into view), Enter or Space picks.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
    const chips = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')]
    const at = chips.indexOf(e.target as HTMLButtonElement)
    if (at < 0) return
    e.preventDefault()
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? chips.length - 1 : Math.max(0, Math.min(chips.length - 1, at + (e.key === 'ArrowRight' ? 1 : -1)))
    chips[next]!.focus({ preventScroll: true })
    reveal(chips[next])
  }

  return (
    <div className="cats" data-fade-start={fade.start || undefined} data-fade-end={fade.end || undefined}>
      <div ref={scroller} className="cats-scroll" role="group" aria-label="Filter by category" onScroll={measure} onKeyDown={onKeyDown}>
        {FILTERS.map((f) => {
          const selected = f.id === value
          const count = counts[f.id]
          return (
            <button
              key={f.id}
              type="button"
              className="cat-chip"
              aria-pressed={selected}
              data-empty={(f.id !== 'all' && count === 0) || undefined}
              tabIndex={selected ? 0 : -1}
              title={chats(count)}
              // Picking the selected chip again clears the filter.
              onClick={() => onChange(selected ? 'all' : f.id)}
            >
              <Glyph name={f.icon} size={14} />
              <span>{f.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
