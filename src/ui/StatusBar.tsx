import { useEffect, useState } from 'react'
import type { SyncState } from '../content/store'
import type { HistoryIndex, ProviderStatus } from '../history/types'

export const ERROR_COPY: Record<Exclude<ProviderStatus, 'available'>, { title: string; body: string }> = {
  'auth-failed': { title: 'Unable to refresh history.', body: 'ChatGPT rejected the request. Reloading the page usually fixes this.' },
  'schema-changed': { title: 'Unable to refresh history.', body: 'ChatGPT may have changed how history loads.' },
  'rate-limited': { title: 'Sync paused temporarily.', body: 'ChatGPT is limiting requests.' },
  'network-error': { title: 'Unable to refresh history.', body: 'Couldn’t reach ChatGPT.' },
}

/** "0:42", "1:05", "4 min" */
export function formatWait(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  if (s < 120) return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  return `${Math.ceil(s / 60)} min`
}

function useTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])
  return now
}

export function StatusBar({ sync, index, onRetry }: { sync: SyncState; index: HistoryIndex | null; onRetry(): void }) {
  const indexed = index ? Object.keys(index.conversations).length : 0
  const now = useTick(!!(sync.pausedUntil || sync.resumeAt))

  if (sync.running && sync.pausedUntil) {
    const total = sync.total
    const pct = total ? Math.min(100, (indexed / Math.max(total, 1)) * 100) : null
    return (
      <div className="status" role="status" aria-live="polite">
        <div className="status-row">
          <strong>Waiting on ChatGPT’s rate limit…</strong>
          <span className="grow" />
          <span>resuming in {formatWait(sync.pausedUntil - now)}</span>
        </div>
        <div className="progress" data-indeterminate={pct === null}>
          <div style={{ width: `${pct ?? 30}%` }} />
        </div>
        <div>
          {indexed.toLocaleString()}
          {total ? ` of ${total.toLocaleString()}` : ''} indexed. History+ slows down automatically so ChatGPT stays responsive.
        </div>
      </div>
    )
  }
  if (sync.error === 'rate-limited' && index && !sync.running) {
    const copy = ERROR_COPY['rate-limited']
    const left = sync.resumeAt ? sync.resumeAt - now : 0
    return (
      <div className="status" role="status">
        <div className="status-row">
          <strong>{copy.title}</strong>
          <span className="grow" />
          <button className="btn btn-sm" onClick={onRetry}>
            Retry now
          </button>
        </div>
        <div>
          {copy.body} {left > 0 ? `History+ will continue automatically in ${formatWait(left)}. ` : 'History+ will continue automatically. '}
          Your {indexed.toLocaleString()} previously indexed conversations are still available.
        </div>
      </div>
    )
  }

  // Routine "anything new?" checks are shown only as a spinning sync icon.
  if (sync.running && (sync.mode === 'full' || !index?.backfillComplete)) {
    const total = sync.total
    const pct = total ? Math.min(100, (indexed / Math.max(total, 1)) * 100) : null
    return (
      <div className="status" role="status" aria-live="polite">
        <div className="status-row">
          <strong>{sync.mode === 'full' ? 'Resyncing history…' : 'Syncing history…'}</strong>
          <span className="grow" />
          <span>
            {indexed.toLocaleString()}
            {total ? ` of ${total.toLocaleString()}` : ''} indexed
          </span>
        </div>
        <div className="progress" data-indeterminate={pct === null}>
          <div style={{ width: `${pct ?? 30}%` }} />
        </div>
      </div>
    )
  }
  if (sync.otherTab) {
    return (
      <div className="status" role="status">
        <div className="status-row">Syncing in another ChatGPT tab…</div>
      </div>
    )
  }
  if (sync.error && sync.error !== 'auth-failed' && index) {
    const copy = ERROR_COPY[sync.error]
    return (
      <div className="status" data-tone="error" role="alert">
        <div className="status-row">
          <strong>{copy.title}</strong>
          <span className="grow" />
          <button className="btn btn-sm" onClick={onRetry}>
            Retry
          </button>
        </div>
        <div>
          {copy.body} Your {indexed.toLocaleString()} previously indexed conversations are still available.
        </div>
      </div>
    )
  }
  if (sync.error === 'auth-failed' && index && indexed) {
    const copy = ERROR_COPY['auth-failed']
    return (
      <div className="status" data-tone="error" role="alert">
        <div className="status-row">
          <strong>{copy.title}</strong>
          <span className="grow" />
          <button className="btn btn-sm" onClick={onRetry}>
            Retry
          </button>
        </div>
        <div>{copy.body}</div>
      </div>
    )
  }
  if (sync.incomplete) {
    return (
      <div className="status" role="status">
        <div className="status-row">
          <strong>{indexed.toLocaleString()} conversations indexed</strong>
          <span>· Sync incomplete</span>
          <span className="grow" />
          <button className="btn btn-sm" onClick={onRetry}>
            Retry
          </button>
        </div>
        <div>{sync.incomplete}</div>
      </div>
    )
  }
  return null
}
