// Watches ChatGPT's sidebar without observing the whole document.
//
// A cheap poll re-discovers the sidebar when React replaces it; a
// MutationObserver scoped to the sidebar reports changes, debounced.

import { findSidebar } from '../chatgpt/selectors'

export interface SidebarWatcher {
  stop(): void
  /** Run the callback now, e.g. after settings change. */
  refresh(): void
}

export function watchSidebar(onChange: (nav: HTMLElement | null) => void, opts: { pollMs?: number; debounceMs?: number } = {}): SidebarWatcher {
  const pollMs = opts.pollMs ?? 1500
  const debounceMs = opts.debounceMs ?? 75
  let nav: HTMLElement | null = null
  let observer: MutationObserver | null = null
  let timer: ReturnType<typeof setTimeout> | undefined

  const fire = () => {
    timer = undefined
    try {
      onChange(nav)
    } catch {
      // Sidebar augmentation is best-effort; never let it throw into the page.
    }
  }
  const schedule = () => {
    if (timer === undefined) timer = setTimeout(fire, debounceMs)
  }

  const discover = () => {
    if (nav?.isConnected) return
    observer?.disconnect()
    observer = null
    nav = findSidebar()
    if (nav) {
      observer = new MutationObserver(schedule)
      observer.observe(nav, { childList: true, subtree: true })
    }
    schedule()
  }

  discover()
  const poll = setInterval(discover, pollMs)
  return {
    stop() {
      clearInterval(poll)
      clearTimeout(timer)
      observer?.disconnect()
    },
    refresh: schedule,
  }
}
