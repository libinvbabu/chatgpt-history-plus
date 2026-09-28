// Minimal virtual list for fixed-height row types. Renders only what is in
// view (plus overscan), and pins the current top-level group header.

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { GroupRow, Row } from '../history/grouping'

export const ROW_HEIGHT = { group0: 36, group1: 32, divider: 28, conversation: 54 } as const

export function heightOf(row: Row): number {
  if (row.type === 'group') return row.level === 0 ? ROW_HEIGHT.group0 : ROW_HEIGHT.group1
  return row.type === 'divider' ? ROW_HEIGHT.divider : ROW_HEIGHT.conversation
}

const OVERSCAN_PX = 400

interface Props {
  rows: Row[]
  activeIndex: number
  /** Changes whenever the active row should be scrolled into view. */
  revealToken: number
  initialScrollTop: number | null
  onScroll(top: number): void
  renderRow(row: Row, index: number): ReactNode
  renderSticky(row: GroupRow, index: number): ReactNode
  id: string
  label: string
}

export function VirtualList({ rows, activeIndex, revealToken, initialScrollTop, onScroll, renderRow, renderSticky, id, label }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewport, setViewport] = useState(600)

  const layout = useMemo(() => {
    const offsets = new Float64Array(rows.length + 1)
    const topGroup = new Int32Array(rows.length)
    const nextTopGroup = new Int32Array(rows.length).fill(-1)
    let lastTop = -1
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i]!
      offsets[i + 1] = offsets[i]! + heightOf(r)
      if (r.type === 'group' && r.level === 0) {
        if (lastTop >= 0) nextTopGroup[lastTop] = i
        lastTop = i
      }
      topGroup[i] = lastTop
    }
    return { offsets, topGroup, nextTopGroup, total: offsets[rows.length]! }
  }, [rows])

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setViewport(el.clientHeight))
    ro.observe(el)
    setViewport(el.clientHeight)
    return () => ro.disconnect()
  }, [])

  useLayoutEffect(() => {
    if (initialScrollTop != null && ref.current) {
      ref.current.scrollTop = initialScrollTop
      setScrollTop(ref.current.scrollTop)
    }
    // Only on mount / restore.
  }, [initialScrollTop])

  // Keep the active row visible (below the sticky header) when it moves.
  useEffect(() => {
    const el = ref.current
    if (!el || activeIndex < 0 || activeIndex >= rows.length) return
    const top = layout.offsets[activeIndex]!
    const bottom = layout.offsets[activeIndex + 1]!
    const row = rows[activeIndex]!
    const pinned = row.type === 'group' && row.level === 0 ? 0 : ROW_HEIGHT.group0
    if (top < el.scrollTop + pinned) el.scrollTop = Math.max(0, top - pinned)
    else if (bottom > el.scrollTop + el.clientHeight) el.scrollTop = bottom - el.clientHeight
  }, [revealToken]) // Only when asked to reveal, not on every scroll.

  const { offsets, topGroup, nextTopGroup, total } = layout
  const start = Math.max(0, upperBound(offsets, scrollTop - OVERSCAN_PX) - 1)
  const end = Math.min(rows.length, upperBound(offsets, scrollTop + viewport + OVERSCAN_PX))

  const slots: ReactNode[] = []
  for (let i = start; i < end; i++) {
    const row = rows[i]!
    slots.push(
      <div key={row.key} className="slot" style={{ top: offsets[i], height: heightOf(row) }} data-active={i === activeIndex || undefined}>
        {renderRow(row, i)}
      </div>,
    )
  }

  // Sticky header for the top-level group the viewport is currently inside.
  let sticky: ReactNode = null
  const first = Math.min(rows.length - 1, Math.max(0, upperBound(offsets, scrollTop) - 1))
  const g = rows.length ? topGroup[first]! : -1
  if (g >= 0 && offsets[g]! < scrollTop) {
    const next = nextTopGroup[g]!
    const push = next >= 0 ? Math.min(0, offsets[next]! - scrollTop - ROW_HEIGHT.group0) : 0
    sticky = (
      <div className="sticky" aria-hidden="true">
        <div style={{ transform: `translateY(${push}px)` }} data-active={g === activeIndex || undefined} className="slot-sticky">
          {renderSticky(rows[g] as GroupRow, g)}
        </div>
      </div>
    )
  }

  return (
    <div
      ref={ref}
      className="list"
      id={id}
      role="tree"
      aria-label={label}
      tabIndex={-1}
      onScroll={(e) => {
        const top = e.currentTarget.scrollTop
        setScrollTop(top)
        onScroll(top)
      }}
    >
      {sticky}
      <div className="list-inner" style={{ height: total }}>
        {slots}
      </div>
    </div>
  )
}

/** First index i with offsets[i] > value. */
function upperBound(offsets: Float64Array, value: number): number {
  let lo = 0
  let hi = offsets.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (offsets[mid]! <= value) lo = mid + 1
    else hi = mid
  }
  return lo
}
