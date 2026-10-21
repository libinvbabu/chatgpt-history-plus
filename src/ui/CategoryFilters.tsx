// The category filters under the search box: All, the filters chosen for this
// history (ui/personalize.ts), and More, which lists every category.
//
// The row scrolls sideways and never wraps. No numbers on the chips (the count
// for the current search and dates is the hover text). An edge fades while
// more chips lie beyond it. A filter picked from More that is not in the row
// joins the end of the row while it is selected, so the selection is always
// visible. More stays put at the right edge, outside the scrolling part.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ALL_FILTER, filterDef, menuItems, type FilterDef, type FilterId } from './categories'
import { Glyph } from './CategoryIcon'
import { usePopover } from './DateFilterMenu'
import { CheckIcon, ChevronIcon, SearchIcon } from './icons'
import type { FilterPrefs } from './personalize'
import type { CategoryCounts } from './view'

interface Props {
  value: FilterId
  /** The filters in the row between All and More, in order. */
  visible: readonly FilterId[]
  /** Per filter, under the current search and date filters: what picking it would show. */
  counts: CategoryCounts
  /** Per filter, across the whole history: which subcategories More lists. */
  historyCounts: CategoryCounts
  prefs: Pick<FilterPrefs, 'pinned' | 'hidden'>
  onChange(id: FilterId): void
  onPin(id: FilterId, pinned: boolean): void
  onHide(id: FilterId, hidden: boolean): void
  onReset(): void
}

/** Room kept between a chip scrolled into view and the scroller's edge (it sits clear of the fade). */
const EDGE_PX = 28

const chats = (n: number) => `${n.toLocaleString()} ${n === 1 ? 'chat' : 'chats'}`

export function CategoryFilters({ value, visible, counts, historyCounts, prefs, onChange, onPin, onHide, onReset }: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  const [fade, setFade] = useState({ start: false, end: false })
  const count = (id: FilterId) => counts.get(id) ?? 0

  // The selected filter is always in the row: picked from More, it joins the end while selected.
  const row = useMemo(() => {
    const ids = [ALL_FILTER.id, ...visible]
    if (!ids.includes(value)) ids.push(value)
    return ids.map(filterDef)
  }, [visible, value])

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

  // The row's width changes when filters come and go.
  useLayoutEffect(measure, [row, measure])

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
  useEffect(() => reveal(scroller.current?.querySelector<HTMLElement>('[aria-pressed="true"]')), [value, row, reveal])

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
        {row.map((f) => {
          const selected = f.id === value
          return (
            <button
              key={f.id}
              type="button"
              className="cat-chip"
              aria-pressed={selected}
              data-id={f.id}
              data-empty={(f.id !== 'all' && count(f.id) === 0) || undefined}
              data-extra={(f.id !== 'all' && !visible.includes(f.id)) || undefined}
              tabIndex={selected ? 0 : -1}
              title={chats(count(f.id))}
              // Picking the selected chip again clears the filter.
              onClick={() => onChange(selected ? 'all' : f.id)}
            >
              <Glyph name={f.icon} size={14} />
              <span>{f.label}</span>
            </button>
          )
        })}
      </div>
      <MoreMenu value={value} visible={visible} counts={counts} historyCounts={historyCounts} prefs={prefs} onChange={onChange} onPin={onPin} onHide={onHide} onReset={onReset} />
    </div>
  )
}

/** Every category, grouped by primary, with counts; and the place to pin, hide or reset filters. */
function MoreMenu({ value, visible, counts, historyCounts, prefs, onChange, onPin, onHide, onReset }: Props) {
  const { open, setOpen, anchor } = usePopover()
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) {
      setQuery('')
      setEditing(false)
      return
    }
    search.current?.focus()
    // Open at the selected category, not at the top of the list (scrolling only the list, never the page).
    const el = list.current
    const item = el?.querySelector<HTMLElement>('[aria-pressed="true"]')
    if (el && item) el.scrollTop = Math.max(0, item.offsetTop - el.offsetTop - (el.clientHeight - item.offsetHeight) / 2)
  }, [open])

  const pinned = useMemo(() => new Set(prefs.pinned), [prefs.pinned])
  const hidden = useMemo(() => new Set(prefs.hidden), [prefs.hidden])
  const inRow = new Set(visible)

  const items = useMemo(() => menuItems(historyCounts, new Set([...pinned, ...hidden, value]), query), [query, historyCounts, pinned, hidden, value])

  const pick = (id: FilterId) => {
    onChange(id)
    setOpen(false)
    button.current?.focus()
  }

  // Arrows move through the search box and the menu's buttons; Escape closes (only the menu) and returns to More.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && open) {
      e.stopPropagation()
      e.preventDefault()
      setOpen(false)
      button.current?.focus()
      return
    }
    if (!open || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')) return
    const stops = [...e.currentTarget.querySelectorAll<HTMLElement>('.cat-menu input, .cat-menu button')]
    const at = stops.indexOf(e.target as HTMLElement)
    if (at < 0) return
    // The panel moves through the list on arrows; inside the menu they are the menu's.
    e.stopPropagation()
    e.preventDefault()
    stops[Math.max(0, Math.min(stops.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))]!.focus()
  }

  const customised = prefs.pinned.length > 0 || prefs.hidden.length > 0

  return (
    <div className="popover-anchor more-anchor" ref={anchor} onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className="cat-chip cat-more"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-on={(value !== 'all' && !visible.includes(value)) || undefined}
        title="All categories"
        onClick={() => setOpen(!open)}
      >
        <span>More</span>
        <ChevronIcon size={12} />
      </button>
      {open && (
        <div className="popover cat-menu" role="dialog" aria-label={editing ? 'Customize filters' : 'All categories'}>
          <label className="cat-menu-search">
            <SearchIcon size={14} />
            <span className="sr-only">Find a category</span>
            <input ref={search} type="text" placeholder="Find a category" value={query} spellCheck={false} autoComplete="off" onChange={(e) => setQuery(e.target.value)} />
          </label>
          {editing && <p className="cat-menu-note">Pin keeps a filter in the bar. Hide leaves it out of the automatic choice.</p>}
          <div ref={list} className="cat-menu-list" role="group" aria-label="Categories">
            {items.length === 0 && <div className="cat-menu-empty">No category matches “{query.trim()}”</div>}
            {items.map((f) =>
              editing ? (
                <EditRow key={f.id} f={f} nested={!query.trim()} pinned={pinned.has(f.id)} hidden={hidden.has(f.id)} shown={inRow.has(f.id)} onPin={onPin} onHide={onHide} />
              ) : (
                <button
                  key={f.id}
                  type="button"
                  className="item cat-item"
                  data-level={f.parent && !query.trim() ? 1 : 0}
                  data-id={f.id}
                  aria-pressed={f.id === value}
                  data-empty={(counts.get(f.id) ?? 0) === 0 || undefined}
                  onClick={() => pick(f.id === value ? 'all' : f.id)}
                >
                  <span className="check">{f.id === value && <CheckIcon />}</span>
                  <Glyph name={f.icon} size={14} />
                  <span className="label">{f.label}</span>
                  {f.parent && query.trim() && <span className="in">{filterDef(f.parent).label}</span>}
                  <span className="n">{(counts.get(f.id) ?? 0).toLocaleString()}</span>
                </button>
              ),
            )}
          </div>
          <div className="sep" />
          <div className="cat-menu-foot">
            {editing ? (
              <>
                <button type="button" className="link-btn" disabled={!customised} onClick={onReset}>
                  <Glyph name="rotate-ccw" size={13} />
                  Reset to automatic
                </button>
                <button type="button" className="btn btn-sm" onClick={() => setEditing(false)}>
                  Done
                </button>
              </>
            ) : (
              <button type="button" className="link-btn" onClick={() => setEditing(true)}>
                Customize filters
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function EditRow({ f, nested, pinned, hidden, shown, onPin, onHide }: { f: FilterDef; nested: boolean; pinned: boolean; hidden: boolean; shown: boolean; onPin: Props['onPin']; onHide: Props['onHide'] }) {
  const status = pinned ? 'Pinned' : hidden ? 'Hidden' : shown ? 'In the bar' : ''
  return (
    <div className="item cat-item editing" data-level={f.parent && nested ? 1 : 0} data-id={f.id}>
      <span className="check" />
      <Glyph name={f.icon} size={14} />
      <span className="label">{f.label}</span>
      <span className="cat-status">{status}</span>
      <button type="button" className="toggle" aria-pressed={pinned} aria-label={`${pinned ? 'Unpin' : 'Pin'} ${f.label}`} title={pinned ? 'Unpin' : 'Pin to the bar'} onClick={() => onPin(f.id, !pinned)}>
        <Glyph name="pin" size={14} />
      </button>
      <button type="button" className="toggle" aria-pressed={hidden} aria-label={`${hidden ? 'Show' : 'Hide'} ${f.label}`} title={hidden ? 'Let it back into the bar' : 'Hide from the bar'} onClick={() => onHide(f.id, !hidden)}>
        <Glyph name="eye-off" size={14} />
      </button>
    </div>
  )
}
