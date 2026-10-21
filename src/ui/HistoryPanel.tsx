import { Component, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react'
import type { HistoryApp } from '../content/app'
import type { AppState } from '../content/store'
import type { GroupRow, RelatedHeaderRow, RelatedMoreRow, Row } from '../history/grouping'
import { isMac, SHORTCUT_LABEL } from '../shared/platform'
import { formatRelativeAgo, getWeekStartsOn } from '../utils/dates'
import { filterDef } from './categories'
import { CategoryFilters } from './CategoryFilters'
import { DateFilterMenu } from './DateFilterMenu'
import { EmptyState, Skeleton } from './EmptyState'
import { AlertIcon, BackIcon, CloseIcon, HistoryIcon, LockIcon, SearchIcon, SlidersIcon, SyncIcon } from './icons'
import { RelatedHeader, RelatedItem, RelatedMore } from './RelatedSection'
import { ConversationItem, Divider, GroupHeader } from './Rows'
import { useRelated } from './related'
import { SettingsView } from './Settings'
import { SortMenu } from './SortMenu'
import { ERROR_COPY, StatusBar } from './StatusBar'
import { gapAbove, ruleAbove, VirtualList } from './VirtualList'
import { useDateContext, useHistoryView } from './view'

const LIST_ID = 'chp-list'
const locale = typeof navigator !== 'undefined' ? navigator.language : undefined
const weekStartsOn = getWeekStartsOn(locale)
const rowId = (i: number) => `chp-row-${i}`

/** Matches the `slide-out` animation in styles.css. */
const EXIT_MS = 170

/** Keeps the panel mounted for `EXIT_MS` after it closes, so it can slide back instead of vanishing. */
function usePresence(open: boolean): { mounted: boolean; closing: boolean } {
  const [lingering, setLingering] = useState(open)
  if (open && !lingering) setLingering(true)
  useEffect(() => {
    if (open) return
    const t = setTimeout(() => setLingering(false), EXIT_MS)
    return () => clearTimeout(t)
  }, [open])
  return { mounted: open || lingering, closing: !open }
}

export function Root({ app }: { app: HistoryApp }) {
  const state = useSyncExternalStore(app.store.subscribe, app.store.get)
  const { mounted, closing } = usePresence(state.open)
  if (!mounted) return null
  return (
    <ErrorBoundary onClose={() => app.close()}>
      <HistoryPanel app={app} state={state} closing={closing} />
    </ErrorBoundary>
  )
}

function useNow(ms: number): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}

function HistoryPanel({ app, state, closing }: { app: HistoryApp; state: AppState; closing: boolean }) {
  const now = useNow(60_000)
  const ctx = useDateContext(now, weekStartsOn, locale)
  const inputRef = useRef<HTMLInputElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [transientCollapsed, setTransientCollapsed] = useState<Record<string, boolean>>({})
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const [reveal, setReveal] = useState(0)
  const [toast, setToast] = useState<string | null>(null)

  const related = useRelated(app, state)
  const view = useHistoryView({ ...state, transientCollapsed, ctx, related })
  const { rows, parsed } = view

  // Search box focus on open / shortcut, and give focus back to ChatGPT on close.
  useEffect(() => {
    if (state.view === 'list') inputRef.current?.focus()
  }, [state.focusRequest, state.view])
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    return () => {
      if (previous?.isConnected && previous !== document.body) previous.focus({ preventScroll: true })
    }
  }, [])

  // New query or filter: reset temporary collapse state and point at the first result.
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  useEffect(() => {
    setTransientCollapsed({})
    const first = view.filtering ? rowsRef.current.find((r) => r.type === 'conversation') : undefined
    setActiveKey(first?.key ?? null)
    if (first) setReveal((r) => r + 1)
  }, [state.query, state.literal, state.dateFilter, state.category, view.filtering])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2200)
    return () => clearTimeout(t)
  }, [toast])

  const keyToIndex = useMemo(() => new Map(rows.map((r, i) => [r.key, i])), [rows])
  const activeIndex = activeKey ? (keyToIndex.get(activeKey) ?? -1) : -1

  const toggleGroup = useCallback(
    (row: GroupRow) => {
      if (view.filtering) setTransientCollapsed((c) => ({ ...c, [row.key]: row.expanded }))
      else app.toggleCollapsed(row.key, row.expanded)
      setActiveKey(row.key)
      setReveal((r) => r + 1)
    },
    [app, view.filtering],
  )

  // "Related" header and "Show more" persist like date groups: same map, same save.
  const toggleRelated = useCallback(
    (row: RelatedHeaderRow | RelatedMoreRow) => {
      app.toggleCollapsed(row.key, row.expanded)
      setActiveKey(row.key)
      setReveal((r) => r + 1)
    },
    [app],
  )

  const openConversation = useCallback((id: string, newTab = false) => app.openConversation(id, { newTab }), [app])

  const move = (delta: number) => {
    const nav: number[] = []
    for (let i = 0; i < rows.length; i++) if (rows[i]!.type !== 'divider') nav.push(i)
    if (!nav.length) return
    let pos = activeIndex >= 0 ? nav.indexOf(activeIndex) : -1
    pos = pos === -1 ? (delta > 0 ? 0 : nav.length - 1) : Math.max(0, Math.min(nav.length - 1, pos + delta))
    setActiveKey(rows[nav[pos]!]!.key)
    setReveal((r) => r + 1)
  }

  const activate = (newTab: boolean) => {
    const row: Row | undefined = activeIndex >= 0 ? rows[activeIndex] : rows.find((r) => r.type === 'conversation')
    if (!row) return
    if (row.type === 'conversation' || row.type === 'related') openConversation(row.entry.conv.id, newTab)
    else if (row.type === 'group') {
      if (row.collapsible) toggleGroup(row)
    } else if (row.type === 'related-header' || row.type === 'related-more') toggleRelated(row)
  }

  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        move(1)
        break
      case 'ArrowUp':
        e.preventDefault()
        move(-1)
        break
      case 'PageDown':
        e.preventDefault()
        move(10)
        break
      case 'PageUp':
        e.preventDefault()
        move(-10)
        break
      case 'Enter':
        e.preventDefault()
        activate(isMac ? e.metaKey : e.ctrlKey)
        break
      case 'Escape':
        e.preventDefault()
        if (state.query) app.setQuery('')
        else app.close()
        break
    }
  }

  const onPanelKey = (e: KeyboardEvent) => {
    if (e.target === inputRef.current) return
    const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement
    if (e.key === 'Escape') {
      e.preventDefault()
      if (state.view === 'settings') app.setView('list')
      else app.close()
    } else if (e.key === '/' && !typing && state.view === 'list') {
      e.preventDefault()
      inputRef.current?.focus()
    } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !typing && state.view === 'list') {
      e.preventDefault()
      inputRef.current?.focus()
      move(e.key === 'ArrowDown' ? 1 : -1)
    }
  }

  const syncing = state.sync.running
  const count = view.total

  return (
    <div className="panel" ref={panelRef} role="dialog" aria-label="History+" onKeyDown={onPanelKey} data-closing={closing || undefined} inert={closing || undefined}>
      {state.view === 'settings' ? (
        <>
          <div className="header">
            <button className="icon-btn" onClick={() => app.setView('list')} aria-label="Back to history" title="Back">
              <BackIcon />
            </button>
            <span className="header-title">Settings</span>
            <span className="spacer" />
            <button className="icon-btn" onClick={() => app.close()} aria-label="Close History+" title="Close (esc)">
              <CloseIcon />
            </button>
          </div>
          <SettingsView app={app} state={state} onToast={setToast} />
        </>
      ) : (
        <>
          <div className="header">
            <span className="brand">
              <HistoryIcon />
              <span>
                History<span className="plus">+</span>
              </span>
            </span>
            <span className="spacer" />
            <button
              className="icon-btn"
              onClick={() => void app.syncNow()}
              aria-busy={syncing}
              disabled={syncing || state.account === 'signed-out'}
              aria-label={syncing ? 'Syncing' : 'Sync now'}
              title={syncing ? 'Syncing…' : 'Sync now'}
            >
              <SyncIcon />
            </button>
            <button className="icon-btn" onClick={() => app.setView('settings')} aria-label="Settings" title="Settings">
              <SlidersIcon />
            </button>
            <button className="icon-btn" onClick={() => app.close()} aria-label="Close History+" title="Close (esc)">
              <CloseIcon />
            </button>
          </div>

          <label className="search">
            <SearchIcon size={15} />
            <span className="sr-only">Search conversations</span>
            <input
              ref={inputRef}
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls={LIST_ID}
              aria-activedescendant={activeIndex >= 0 ? rowId(activeIndex) : undefined}
              aria-autocomplete="list"
              placeholder="Search your conversations…"
              value={state.query}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => app.setQuery(e.target.value)}
              onKeyDown={onSearchKey}
            />
            {state.query ? (
              <button type="button" className="clear" aria-label="Clear search" onClick={() => (app.setQuery(''), inputRef.current?.focus())}>
                <CloseIcon size={14} />
              </button>
            ) : (
              <kbd className="search-key" title="Open History+ from anywhere on ChatGPT. Try “last week” or “in:aug” to search by date.">
                {SHORTCUT_LABEL}
              </kbd>
            )}
          </label>

          <CategoryFilters value={state.category} counts={view.categoryCounts} onChange={(id) => app.setCategory(id)} />

          <div className="toolbar">
            <SortMenu value={state.settings.timestampMode} onChange={(timestampMode) => void app.updateSettings({ timestampMode })} />
            <DateFilterMenu value={state.dateFilter} label={view.filterRange?.label ?? null} sorted={view.sorted} now={now} locale={locale} onChange={(v) => app.setDateFilter(v)} />
            <span className="count-wrap" aria-live="polite">
              <span className="count">{view.narrowed ? `${view.matchCount.toLocaleString()} of ${count.toLocaleString()}` : count ? `${count.toLocaleString()}` : ''}</span>
              {!view.narrowed && count > 0 && (count === 1 ? ' chat' : ' chats')}
            </span>
          </div>

          <Notes app={app} state={state} parsed={parsed} />
          <div className="notes" style={{ paddingBottom: 0 }}>
            <StatusBar sync={state.sync} index={state.index} onRetry={() => void app.syncNow()} />
          </div>

          <ListArea
            app={app}
            state={state}
            view={view}
            now={now}
            activeIndex={activeIndex}
            reveal={reveal}
            onToggle={toggleGroup}
            onToggleRelated={toggleRelated}
            onOpen={openConversation}
          />

          <div className="footer">
            <span className="synced" data-busy={syncing || undefined}>
              {footerSyncText(state)}
            </span>
          </div>
        </>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  )
}

function footerSyncText(state: AppState): string {
  if (state.sync.running) return 'Syncing…'
  const at = state.index?.lastIncrementalSyncAt
  return at ? `Synced ${formatRelativeAgo(at, Date.now())}` : ''
}

function Notes({ app, state, parsed }: { app: HistoryApp; state: AppState; parsed: ReturnType<typeof useHistoryView>['parsed'] }) {
  const canUnliteral = state.literal && state.query.trim()
  if (!parsed.ranges.length && !parsed.warnings.length && !canUnliteral) return null
  return (
    <div className="notes">
      {parsed.ranges.length > 0 && (
        <div className="interpretation">
          <span>Showing</span>
          {parsed.ranges.map((r, i) => (
            <span className="tag" key={i}>
              {r.label}
            </span>
          ))}
          {parsed.inferredDate && (
            <button type="button" className="link-btn" onClick={() => app.setLiteral(true)}>
              Search “{parsed.inferredDate}” in titles instead
            </button>
          )}
        </div>
      )}
      {canUnliteral && !parsed.ranges.length && (
        <div className="interpretation">
          <span>Searching titles only.</span>
          <button type="button" className="link-btn" onClick={() => app.setLiteral(false)}>
            Read dates in my search
          </button>
        </div>
      )}
      {parsed.warnings.map((w) => (
        <div className="warning" key={w}>
          {w}
        </div>
      ))}
    </div>
  )
}

interface ListAreaProps {
  app: HistoryApp
  state: AppState
  view: ReturnType<typeof useHistoryView>
  now: Date
  activeIndex: number
  reveal: number
  onToggle(row: GroupRow): void
  onToggleRelated(row: RelatedHeaderRow | RelatedMoreRow): void
  onOpen(id: string): void
}

function ListArea({ app, state, view, now, activeIndex, reveal, onToggle, onToggleRelated, onOpen }: ListAreaProps) {
  const { rows, parsed } = view
  const { index, sync, account } = state

  if (state.paused && !index) {
    return (
      <EmptyState
        title="Local data cleared"
        actions={
          <button className="btn btn-primary" onClick={() => void app.syncNow()}>
            Sync history again
          </button>
        }
      >
        History+ won’t sync again on this page until you ask it to.
      </EmptyState>
    )
  }
  if (account === 'signed-out') {
    return (
      <EmptyState
        icon={<LockIcon />}
        title="History+ needs an active ChatGPT session."
        actions={
          <button className="btn" onClick={() => void app.open()}>
            Try again
          </button>
        }
      >
        Log in to ChatGPT in this tab, then reopen History+.
      </EmptyState>
    )
  }
  if (!index || (view.total === 0 && sync.running)) {
    if (sync.error && !sync.running) {
      const copy = ERROR_COPY[sync.error]
      return (
        <EmptyState
          icon={<AlertIcon />}
          title={copy.title}
          actions={
            <button className="btn" onClick={() => void app.syncNow()}>
              Retry
            </button>
          }
        >
          {copy.body}
        </EmptyState>
      )
    }
    return <Skeleton />
  }
  if (view.total === 0) {
    return (
      <EmptyState
        icon={<HistoryIcon size={20} />}
        title="No conversations found."
        actions={
          <button className="btn" onClick={() => void app.syncNow()}>
            Sync again
          </button>
        }
      >
        Start a chat in ChatGPT and it will appear here.
      </EmptyState>
    )
  }
  if (rows.length === 0) {
    const hasDate = parsed.ranges.length > 0 || state.dateFilter
    const categoryOnly = state.category !== 'all' && !state.query && !hasDate
    return (
      <EmptyState
        icon={<SearchIcon size={20} />}
        title="No matching conversations"
        actions={
          <>
            {state.dateFilter && (
              <button className="btn" onClick={() => app.setDateFilter(null)}>
                Clear date filter
              </button>
            )}
            {parsed.inferredDate && (
              <button className="btn" onClick={() => app.setLiteral(true)}>
                Search titles instead
              </button>
            )}
            {state.query && (
              <button className="btn" onClick={() => app.setQuery('')}>
                Clear search
              </button>
            )}
            {state.category !== 'all' && (
              <button className="btn" onClick={() => app.setCategory('all')}>
                Show all categories
              </button>
            )}
          </>
        }
      >
        {categoryOnly
          ? `No conversations are filed under ${filterDef(state.category).label}${index.backfillComplete ? '.' : ' yet, and history is still syncing.'}`
          : `${hasDate ? 'Nothing in that period matches. ' : ''}${state.category !== 'all' ? `Only ${filterDef(state.category).label} is showing. ` : ''}Search looks at titles only${index.backfillComplete ? '.' : ', and history is still syncing.'}`}
      </EmptyState>
    )
  }

  const { dateFormat: dateStyle, timeFormat } = state.settings
  return (
    <VirtualList
      id={LIST_ID}
      label="Conversations by date"
      rows={rows}
      activeIndex={activeIndex}
      revealToken={reveal}
      initialScrollTop={state.initialScrollTop}
      onScroll={(top) => app.rememberScroll(top)}
      renderSticky={(row) => <GroupHeader row={row} onToggle={onToggle} />}
      renderRow={(row, i) => {
        switch (row.type) {
          case 'group':
            return <GroupHeader row={row} id={rowId(i)} gap={gapAbove(row, view.rows[i - 1])} rule={ruleAbove(row, view.rows[i - 1])} onToggle={onToggle} />
          case 'divider':
            return <Divider row={row} />
          case 'related-header':
            return <RelatedHeader row={row} id={rowId(i)} gap={gapAbove(row, view.rows[i - 1])} onToggle={onToggleRelated} />
          case 'related-more':
            return <RelatedMore row={row} id={rowId(i)} onToggle={onToggleRelated} />
          case 'related':
            return <RelatedItem row={row} id={rowId(i)} now={now} dateStyle={dateStyle} timeFormat={timeFormat} locale={locale} current={row.entry.conv.id === state.currentId} onOpen={onOpen} />
          default:
            return (
              <ConversationItem
                row={row}
                id={rowId(i)}
                now={now}
                dateStyle={dateStyle}
                timeFormat={timeFormat}
                locale={locale}
                terms={parsed.terms}
                current={row.entry.conv.id === state.currentId}
                onOpen={onOpen}
              />
            )
        }
      }}
    />
  )
}

class ErrorBoundary extends Component<{ children: ReactNode; onClose(): void }, { failed: boolean }> {
  override state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  override render() {
    if (!this.state.failed) return this.props.children
    return (
      <div className="panel" role="dialog" aria-label="History+">
        <div className="header">
          <span className="brand">
            <HistoryIcon />
            History+
          </span>
          <span className="spacer" />
          <button className="icon-btn" onClick={this.props.onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>
        <div className="crash">
          <p>History+ ran into a problem. ChatGPT itself is unaffected.</p>
          <button className="btn" onClick={() => this.setState({ failed: false })}>
            Reload History+
          </button>
        </div>
      </div>
    )
  }
}

