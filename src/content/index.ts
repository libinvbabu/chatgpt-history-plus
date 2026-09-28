// Content script entry. Runs in Chrome's isolated world on chatgpt.com.
//
// Two independent products live here (see the spec's key decision):
//   A. the native sidebar enhancer  — best-effort, may break with ChatGPT's DOM
//   B. the History+ engine + panel  — owns its own UI and data
// A failure in A must never affect B, and neither may break ChatGPT.

import { createChatGPTProvider } from '../chatgpt/adapter'
import { isToggleMessage } from '../shared/messages'
import { extensionAlive } from '../shared/platform'
import { chromeStore } from '../storage'
import { HistoryApp } from './app'
import { mountPanel, type MountedPanel } from './mount'
import { NativeSidebar } from './native-sidebar'
import { watchSidebar, type SidebarWatcher } from './observer'
import { watchTheme } from './theme'

declare global {
  interface Window {
    __chatgptHistoryPlus?: boolean
  }
}

const TOGGLE_DEDUPE_MS = 300

async function main() {
  if (window.__chatgptHistoryPlus) return
  window.__chatgptHistoryPlus = true

  const app = new HistoryApp({ kv: chromeStore(), provider: createChatGPTProvider() })
  const cleanups: Array<() => void> = []
  let panel: MountedPanel | null = null
  let lastToggle = 0

  const toggle = () => {
    const now = Date.now()
    if (now - lastToggle < TOGGLE_DEDUPE_MS) return
    lastToggle = now
    app.toggle(panel?.hasFocus() ?? false)
  }

  // B. History+ panel.
  panel = mountPanel(app)
  cleanups.push(() => panel?.destroy())
  cleanups.push(
    watchTheme((theme) => {
      panel?.host.setAttribute('data-theme', theme)
      app.store.set({ theme })
    }),
  )

  // Cmd/Ctrl+Shift+H while on chatgpt.com.
  const onKey = (e: KeyboardEvent) => {
    if (e.shiftKey && !e.altKey && (e.metaKey || e.ctrlKey) && (e.code === 'KeyH' || e.key.toLowerCase() === 'h')) {
      e.preventDefault()
      e.stopPropagation()
      toggle()
    }
  }
  window.addEventListener('keydown', onKey, true)
  cleanups.push(() => window.removeEventListener('keydown', onKey, true))

  // Toolbar button / optional browser-wide command, via the service worker.
  const onMessage = (msg: unknown) => {
    if (isToggleMessage(msg)) toggle()
  }
  chrome.runtime.onMessage.addListener(onMessage)
  cleanups.push(() => chrome.runtime.onMessage.removeListener(onMessage))

  // Track the open conversation across ChatGPT's client-side navigations.
  const syncPath = () => app.setCurrentPath(location.pathname)
  const nav = (window as Window & { navigation?: EventTarget }).navigation
  if (nav) {
    nav.addEventListener('currententrychange', syncPath)
    cleanups.push(() => nav.removeEventListener('currententrychange', syncPath))
  } else {
    const t = setInterval(syncPath, 1000)
    cleanups.push(() => clearInterval(t))
  }
  window.addEventListener('popstate', syncPath)
  cleanups.push(() => window.removeEventListener('popstate', syncPath))

  await app.init()

  // A. Native sidebar enhancer.
  let watcher: SidebarWatcher | null = null
  try {
    const sidebar = new NativeSidebar({ onOpen: () => void app.open() })
    watcher = watchSidebar((navEl) => {
      panel?.ensureAttached()
      const s = app.state
      sidebar.update(navEl, s.index, s.settings.timestampMode, s.settings.showNativeDates)
    })
    let lastRev = -1
    let lastSettings = app.state.settings
    let lastTheme = app.state.theme
    cleanups.push(
      app.store.subscribe(() => {
        const s = app.state
        // Theme too: the entry copies ChatGPT's text colour, which changes with it.
        if (s.indexRev !== lastRev || s.settings !== lastSettings || s.theme !== lastTheme) {
          lastRev = s.indexRev
          lastSettings = s.settings
          lastTheme = s.theme
          watcher?.refresh()
        }
      }),
    )
    cleanups.push(() => watcher?.stop(), () => sidebar.destroy())
  } catch {
    // Native enhancement unavailable; History+ itself still works.
  }

  // Identify the account and refresh a stale cache once the page is idle.
  const idle = (fn: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(fn, { timeout: 4000 }) : setTimeout(fn, 1500))
  idle(() => void app.startBackground().catch(() => {}))

  // After an extension update/reload this script is orphaned: remove ourselves.
  const alive = setInterval(() => {
    if (extensionAlive()) return
    clearInterval(alive)
    app.dispose()
    for (const c of cleanups.splice(0).reverse()) {
      try {
        c()
      } catch {
        // Already gone.
      }
    }
    window.__chatgptHistoryPlus = false
  }, 5000)
}

main().catch(() => {
  // Never surface History+ failures inside ChatGPT.
})
