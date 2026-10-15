// Watches ChatGPT's sidebar without observing the whole document.
//
// A cheap poll re-discovers the sidebar and the icon rail when React replaces
// them; a MutationObserver scoped to them reports changes, debounced.

import { findRail, findSidebar } from '../chatgpt/selectors'

export interface SidebarTargets {
  /** The conversation panel; null when collapsed away or not found. */
  nav: HTMLElement | null
  /** The always-visible icon rail, in layouts that have one. */
  rail: HTMLElement | null
}

export interface SidebarWatcher {
  stop(): void
  /** Run the callback now, e.g. after settings change. */
  refresh(): void
}

export function watchSidebar(onChange: (targets: SidebarTargets) => void, opts: { pollMs?: number; debounceMs?: number } = {}): SidebarWatcher {
  const pollMs = opts.pollMs ?? 1500
  const debounceMs = opts.debounceMs ?? 75
  let nav: HTMLElement | null = null
  let rail: HTMLElement | null = null
  let observer: MutationObserver | null = null
  let timer: ReturnType<typeof setTimeout> | undefined

  const fire = () => {
    timer = undefined
    try {
      onChange({ nav, rail })
    } catch {
      // Sidebar augmentation is best-effort; never let it throw into the page.
    }
  }
  const schedule = () => {
    if (timer === undefined) timer = setTimeout(fire, debounceMs)
  }

  const discover = () => {
    const nextNav = nav?.isConnected ? nav : findSidebar()
    const nextRail = findRail()
    const changed = nextNav !== nav || nextRail !== rail
    nav = nextNav
    rail = nextRail
    if (changed) {
      observer?.disconnect()
      observer = null
      if (nav || rail) {
        observer = new MutationObserver(schedule)
        for (const el of [nav, rail]) if (el) observer.observe(el, { childList: true, subtree: true })
      }
    }
    // With nothing to watch, keep reporting so the callback can notice and retry.
    if (changed || (!nav && !rail)) schedule()
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
