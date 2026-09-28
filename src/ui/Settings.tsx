import { useState } from 'react'
import type { HistoryApp } from '../content/app'
import type { AppState } from '../content/store'
import type { Settings as SettingsT } from '../history/types'
import { SHORTCUT_LABEL, isMac } from '../shared/platform'
import { formatFull, formatRelativeAgo } from '../utils/dates'

export function SettingsView({ app, state, onToast }: { app: HistoryApp; state: AppState; onToast(msg: string): void }) {
  const { settings, index, sync } = state
  const [confirming, setConfirming] = useState(false)
  const set = (patch: Partial<SettingsT>) => void app.updateSettings(patch)
  const count = index ? Object.keys(index.conversations).length : 0
  const now = Date.now()
  const mod = isMac ? '⌘' : 'Ctrl'

  return (
    <div className="settings">
      <section>
        <h4>Date shown</h4>
        <Radio name="ts" checked={settings.timestampMode === 'updated'} onChange={() => set({ timestampMode: 'updated' })} title="Last active" desc="When you last used the conversation. Best for “what was I working on last Tuesday?”" />
        <Radio name="ts" checked={settings.timestampMode === 'created'} onChange={() => set({ timestampMode: 'created' })} title="Created" desc="When the conversation started. Best for “when did I first discuss this?”" />
      </section>

      <section>
        <h4>Date format</h4>
        <Radio name="fmt" checked={settings.dateFormat === 'relative'} onChange={() => set({ dateFormat: 'relative' })} title="Smart" desc="10:05 AM · Thu, Sep 18 · Dec 14, 2025" />
        <Radio name="fmt" checked={settings.dateFormat === 'absolute'} onChange={() => set({ dateFormat: 'absolute' })} title="Absolute" desc="Sep 18, 2026 · 3:42 PM" />
      </section>

      <section>
        <h4>Grouping</h4>
        <Radio name="grp" checked={settings.grouping === 'smart'} onChange={() => set({ grouping: 'smart' })} title="Smart" desc="Today, yesterday, this week, last week, then months and years" />
        <Radio name="grp" checked={settings.grouping === 'month'} onChange={() => set({ grouping: 'month' })} title="By month" desc="Every month as its own group" />
      </section>

      <section>
        <h4>ChatGPT sidebar</h4>
        <label className="option">
          <input type="checkbox" checked={settings.showNativeDates} onChange={(e) => set({ showNativeDates: e.target.checked })} />
          <span>
            <div className="o-title">Show dates in the native sidebar</div>
            <div className="o-desc">Adds a small date beside each conversation ChatGPT lists. Best-effort: turns itself off if ChatGPT’s layout changes.</div>
          </span>
        </label>
      </section>

      <section>
        <h4>Sync</h4>
        <dl className="stats">
          <dt>Indexed</dt>
          <dd>
            {count.toLocaleString()} conversations
            {index?.totalReported != null && index.totalReported !== count ? ` (ChatGPT reports ${index.totalReported.toLocaleString()})` : ''}
          </dd>
          <dt>Last sync</dt>
          <dd title={index?.lastIncrementalSyncAt ? formatFull(index.lastIncrementalSyncAt) : undefined}>
            {sync.running ? 'Syncing now…' : index?.lastIncrementalSyncAt ? formatRelativeAgo(index.lastIncrementalSyncAt, now) : 'Never'}
          </dd>
          <dt>Last full sync</dt>
          <dd>{index?.lastFullSyncAt ? formatRelativeAgo(index.lastFullSyncAt, now) : 'Never'}</dd>
        </dl>
        <p>Full resync re-reads your whole history and removes conversations you have deleted in ChatGPT.</p>
        <div className="row-btns">
          <button className="btn" disabled={sync.running} onClick={() => void app.syncNow()}>
            Sync now
          </button>
          <button className="btn" disabled={sync.running} onClick={() => void app.syncNow('full')}>
            Full resync
          </button>
          {sync.running && (
            <button className="btn" onClick={() => app.cancelSync()}>
              Stop
            </button>
          )}
        </div>
      </section>

      <section>
        <h4>Keyboard</h4>
        <div className="keys">
          <span>
            <kbd>{SHORTCUT_LABEL}</kbd>
          </span>
          <span>Open History+ on chatgpt.com</span>
          <span>
            <kbd>/</kbd>
          </span>
          <span>Focus search</span>
          <span>
            <kbd>↑</kbd>
            <kbd>↓</kbd>
          </span>
          <span>Move through results</span>
          <span>
            <kbd>↵</kbd>
          </span>
          <span>Open conversation (or expand a group)</span>
          <span>
            <kbd>{mod}</kbd>
            <kbd>↵</kbd>
          </span>
          <span>Open in a new tab</span>
          <span>
            <kbd>esc</kbd>
          </span>
          <span>Clear search, then close</span>
        </div>
        <p style={{ marginTop: 10 }}>To use a shortcut from any site, assign one to History+ at chrome://extensions/shortcuts.</p>
      </section>

      <section>
        <h4>Privacy</h4>
        <p>
          History+ stores conversation titles, ids and dates only in this browser’s extension storage. It talks to nothing but chatgpt.com, with the same requests ChatGPT’s own web app makes. No
          message content is read. Nothing is sent to the developer or anyone else.
        </p>
      </section>

      <section>
        <h4>Data</h4>
        <div className="row-btns">
          <button
            className="btn"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(app.diagnosticsReport())
                onToast('Diagnostics copied (no titles or ids)')
              } catch {
                onToast('Couldn’t access the clipboard')
              }
            }}
          >
            Copy diagnostics
          </button>
          <button className="btn btn-danger" onClick={() => setConfirming(true)}>
            Clear local data
          </button>
        </div>
        {confirming && (
          <div className="confirm" role="alertdialog" aria-label="Confirm clearing local data">
            Delete the local index, settings and collapse state for every account on this browser? Your ChatGPT conversations are not affected.
            <div className="row-btns">
              <button className="btn btn-sm" onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button
                className="btn btn-sm btn-danger"
                onClick={async () => {
                  setConfirming(false)
                  await app.clearAllData()
                  onToast('Local History+ data cleared')
                }}
              >
                Delete local data
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}

function Radio({ name, checked, onChange, title, desc }: { name: string; checked: boolean; onChange(): void; title: string; desc: string }) {
  return (
    <label className="option">
      <input type="radio" name={name} checked={checked} onChange={onChange} />
      <span>
        <div className="o-title">{title}</div>
        <div className="o-desc">{desc}</div>
      </span>
    </label>
  )
}
