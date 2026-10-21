// Recording-only plumbing: a demo copy of the built extension with its clock
// set to the fixture's "now", the e2e mock of chatgpt.com in dark mode with the
// demo history, a visible cursor, and a CDP screencast recorder. Nothing here
// ships: production code and dist/ are untouched.

import { expect, type CDPSession, type Locator, type Page } from '@playwright/test'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { MockChatGPT } from '../../tests/e2e/mock-chatgpt'
import { DEMO_NOW, demoConversations } from './fixtures/conversations'

export const ROOT = resolve(import.meta.dirname, '../..')
export const WORK = resolve(ROOT, '.promo')

/**
 * Copies dist/ and prepends a clock shift to the content script, so History+
 * believes it is DEMO_NOW (time still runs). Content scripts live in an isolated
 * world, which Playwright's page clock cannot reach.
 */
export async function demoExtension(): Promise<string> {
  const dist = resolve(ROOT, 'dist')
  const out = resolve(WORK, 'extension')
  await rm(out, { recursive: true, force: true })
  await cp(dist, out, { recursive: true })
  const shim =
    `;(() => { const R = Date, off = ${DEMO_NOW} - R.now();` +
    ` function D(...a) { if (!new.target) return new R(R.now() + off).toString(); return a.length ? new R(...a) : new R(R.now() + off) }` +
    ` D.prototype = R.prototype; D.now = () => R.now() + off; D.parse = R.parse; D.UTC = R.UTC; globalThis.Date = D })();\n`
  const file = resolve(out, 'content.js')
  await writeFile(file, shim + (await readFile(file, 'utf8')))
  return out
}

/** The e2e mock of chatgpt.com, dark, with the demo history and room for the chat beside the panel. */
export class DemoChatGPT extends MockChatGPT {
  constructor() {
    super(0)
    this.useShowcase()
    this.conversations = demoConversations()
  }

  override page(): string {
    // ChatGPT's real sidebar is a 52px rail plus ~260px of list; the mock's is narrower.
    const css = `<style>
      aside{width:312px}
      .thread{max-width:none;margin:0;padding:0 56px 0 160px}
      .bubble{max-width:80%}
      .row .actions button{all:unset;padding:2px 6px;border-radius:6px;color:#b4b4b4}
    </style>`
    return super.page().replace('<html class="light">', '<html class="dark">').replace('</head>', `${css}</head>`)
  }
}

/** A visible pointer (the headless browser draws none), with a soft ring on each click. */
export const CURSOR_SCRIPT = `(() => {
  if (window.top !== window) return
  const install = () => {
    if (document.getElementById('promo-cursor')) return
    const el = document.createElement('div')
    el.id = 'promo-cursor'
    el.innerHTML = \`<style>
      #promo-cursor{position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none;opacity:0;will-change:transform}
      #promo-cursor .arrow{position:absolute;left:-3px;top:-2px;width:22px;height:28px;transform-origin:3px 2px;transition:transform 110ms ease-out;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5))}
      #promo-cursor.down .arrow{transform:scale(.84)}
      #promo-cursor .ring{position:absolute;left:-21px;top:-21px;width:42px;height:42px;box-sizing:border-box;border-radius:50%;border:2px solid rgba(141,164,239,.95);background:rgba(141,164,239,.2);opacity:0}
      #promo-cursor .ring.go{animation:promo-ring 560ms cubic-bezier(.2,.7,.3,1) forwards}
      @keyframes promo-ring{0%{opacity:.9;transform:scale(.3)}100%{opacity:0;transform:scale(1.2)}}
    </style><div class="ring"></div><svg class="arrow" viewBox="0 0 22 28"><path d="M3 2v20.5l5.2-5 3.6 8.2 3.4-1.5-3.6-8h7.2z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>\`
    document.documentElement.append(el)
    const ring = el.querySelector('.ring')
    addEventListener('mousemove', (e) => { el.style.opacity = '1'; el.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)' }, { capture: true, passive: true })
    addEventListener('mousedown', () => { el.classList.add('down'); ring.classList.remove('go'); void ring.offsetWidth; ring.classList.add('go') }, true)
    addEventListener('mouseup', () => el.classList.remove('down'), true)
    window.__promoCursor = (show) => { el.style.visibility = show ? 'visible' : 'hidden' }
  }
  if (document.documentElement) install()
  else addEventListener('DOMContentLoaded', install)
})()`

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
export { sleep }

/** Smooth, slightly curved pointer movement and deliberate clicks, through real input events. */
export class Pointer {
  x: number
  y: number
  constructor(
    private page: Page,
    start: { x: number; y: number },
  ) {
    this.x = start.x
    this.y = start.y
  }

  async place() {
    await this.page.mouse.move(this.x, this.y)
  }

  async glide(x: number, y: number, ms?: number) {
    const fx = this.x
    const fy = this.y
    const dist = Math.hypot(x - fx, y - fy)
    if (dist < 1) return
    const dur = ms ?? Math.min(820, Math.max(380, 300 + dist * 0.7))
    // A gentle arc, perpendicular to the path, like a hand on a trackpad.
    const bow = Math.min(40, dist * 0.08)
    const nx = -(y - fy) / dist
    const ny = (x - fx) / dist
    const t0 = Date.now()
    for (;;) {
      const p = Math.min(1, (Date.now() - t0) / dur)
      const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2
      const arc = Math.sin(Math.PI * e) * bow
      await this.page.mouse.move(fx + (x - fx) * e + nx * arc, fy + (y - fy) * e + ny * arc)
      if (p >= 1) break
      await sleep(10)
    }
    this.x = x
    this.y = y
  }

  /** Point at an element: `fx`/`fy` are fractions of its box (default: centre). */
  async to(target: Locator, at: { fx?: number; fy?: number; ms?: number } = {}) {
    await expect(target).toBeVisible()
    // Visible is not enough: an item scrolled out of its list is "visible" but off screen.
    await expect(target).toBeInViewport()
    const box = (await target.boundingBox())!
    await this.glide(box.x + box.width * (at.fx ?? 0.5), box.y + box.height * (at.fy ?? 0.5), at.ms)
  }

  async click(target?: Locator, at: { fx?: number; fy?: number; ms?: number } = {}) {
    if (target) await this.to(target, at)
    await sleep(150)
    await this.page.mouse.down()
    await sleep(90)
    await this.page.mouse.up()
  }

  /** Scroll whatever is under the pointer, in small steps so it reads as a smooth scroll. */
  async scroll(dy: number, ms = 600) {
    const steps = Math.max(6, Math.round(ms / 30))
    for (let i = 0; i < steps; i++) {
      await this.page.mouse.wheel(0, dy / steps)
      await sleep(ms / steps)
    }
  }
}

export interface Frame {
  file: string
  /** Seconds, wall clock (same clock as marks). */
  t: number
}

/** Records the page through CDP's screencast: device-pixel JPEG frames, sent whenever the page repaints. */
export class Screencast {
  frames: Frame[] = []
  private writes: Promise<unknown>[] = []
  private cdp!: CDPSession

  constructor(
    private page: Page,
    private dir: string,
    /** Device pixels; without a maximum the screencast sends CSS-pixel frames. */
    private size: { width: number; height: number },
  ) {}

  async start() {
    await rm(this.dir, { recursive: true, force: true })
    await mkdir(this.dir, { recursive: true })
    this.cdp = await this.page.context().newCDPSession(this.page)
    this.cdp.on('Page.screencastFrame', (f) => {
      const file = `${String(this.frames.length).padStart(6, '0')}.jpg`
      this.frames.push({ file, t: f.metadata.timestamp ?? Date.now() / 1000 })
      this.writes.push(writeFile(resolve(this.dir, file), Buffer.from(f.data, 'base64')))
      void this.cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {})
    })
    await this.cdp.send('Page.startScreencast', { format: 'jpeg', quality: 94, everyNthFrame: 1, maxWidth: this.size.width, maxHeight: this.size.height })
  }

  async stop() {
    await this.cdp.send('Page.stopScreencast')
    await Promise.all(this.writes)
    await this.cdp.detach()
  }
}
