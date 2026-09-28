import { createRoot, type Root as ReactRoot } from 'react-dom/client'
import css from '../ui/styles.css?inline'
import { Root } from '../ui/HistoryPanel'
import type { HistoryApp } from './app'

export const ROOT_ID = 'chatgpt-history-plus-root'

export interface MountedPanel {
  host: HTMLElement
  /** Re-attach if ChatGPT's renderer removed our host from <body>. */
  ensureAttached(): void
  hasFocus(): boolean
  destroy(): void
}

export function mountPanel(app: HistoryApp): MountedPanel {
  document.getElementById(ROOT_ID)?.remove()
  const host = document.createElement('div')
  host.id = ROOT_ID
  const shadow = host.attachShadow({ mode: 'open' })
  const style = document.createElement('style')
  style.textContent = css
  const container = document.createElement('div')
  shadow.append(style, container)

  // Keep keystrokes typed into History+ away from ChatGPT's global shortcuts
  // (and its "start typing to focus the composer" behaviour).
  for (const type of ['keydown', 'keyup', 'keypress'] as const) {
    host.addEventListener(type, (e) => e.stopPropagation())
  }

  document.body.append(host)
  const root: ReactRoot = createRoot(container)
  root.render(<Root app={app} />)

  return {
    host,
    ensureAttached() {
      if (!host.isConnected) document.body.append(host)
    },
    hasFocus: () => shadow.activeElement != null,
    destroy() {
      root.unmount()
      host.remove()
    },
  }
}
