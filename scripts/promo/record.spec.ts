// Records the promo storyboard against the real History+ build: the actual
// panel, search, category chips, date groups and "Related to this chat",
// running on synthetic history. Run with `npm run promo:record`; then
// `npm run promo:build` turns the frames into the videos. See README.md.

import { chromium, expect, test, type Page } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { CURSOR_SCRIPT, DemoChatGPT, demoExtension, Pointer, Screencast, sleep, WORK } from './harness'
import { DEMO_LOCALE, DEMO_TZ, STORY } from './fixtures/conversations'

/** CSS px. The build scales this into the browser frame (16:9) and crops the panel (9:16). */
const VIEWPORT = { width: 1040, height: 780 }
const DPR = 2
const OUT = resolve(WORK, 'recording')

const panel = (page: Page) => page.locator('#chatgpt-history-plus-root .panel')
const search = (page: Page) => panel(page).getByRole('combobox')
const row = (page: Page, title: string) => panel(page).locator('.conv', { hasText: title }).first()
const group = (page: Page, label: string) => panel(page).locator('button.group', { has: page.locator('.label', { hasText: new RegExp(`^${label}$`) }) }).first()
const chip = (page: Page, label: string) => panel(page).getByRole('group', { name: 'Filter by category' }).getByRole('button', { name: label, exact: true })
const titles = (page: Page) => panel(page).locator('.conv .title')
const chatTitle = (page: Page) => page.locator('#title')

test('record promo storyboard', async () => {
  const server = new DemoChatGPT()
  const extension = await demoExtension()
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: !process.env.HEADED,
    viewport: VIEWPORT,
    deviceScaleFactor: DPR,
    timezoneId: DEMO_TZ,
    locale: DEMO_LOCALE,
    colorScheme: 'dark',
    // Headless screencasts come at CSS-pixel size unless the device scale is forced.
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, `--force-device-scale-factor=${DPR}`],
  })
  const errors: string[] = []
  try {
    await context.route('https://chatgpt.com/**', (route) => server.handle(route))
    await context.addInitScript(CURSOR_SCRIPT)
    const page = context.pages()[0] ?? (await context.newPage())
    page.on('pageerror', (e) => errors.push(e.message))

    // --- Setup (not recorded): sync the history once, then close the panel.
    await page.goto(`https://chatgpt.com/c/${server.byTitle(STORY.start).id}`)
    await page.evaluate(() => document.fonts.ready)
    // History+'s icon in ChatGPT's always-visible icon rail.
    const entry = page.locator('[data-chp-rail-entry]').getByRole('button')
    await entry.click()
    await expect(panel(page)).toBeVisible()
    const total = server.conversations.length
    await expect(panel(page).locator('.count')).toHaveText(total.toLocaleString('en-US'), { timeout: 60_000 })
    await expect(panel(page).locator('.footer .synced')).toContainText('Synced')
    await page.keyboard.press('Escape')
    await expect(panel(page)).toBeHidden()
    await expect(chatTitle(page)).toHaveText(STORY.start)

    const pointer = new Pointer(page, { x: 760, y: 610 })
    await pointer.place()
    await sleep(600)

    // --- Recording.
    const cast = new Screencast(page, resolve(OUT, 'frames'), { width: VIEWPORT.width * DPR, height: VIEWPORT.height * DPR })
    const marks: Record<string, number> = {}
    const mark = (name: string) => (marks[name] = Date.now() / 1000)
    // Voice-over pacing (npm run promo:voice): a scene lasts at least as long as its line, plus a breath.
    const voice = (await readFile(resolve(WORK, 'voice/voice.json'), 'utf8').then(JSON.parse, () => null)) as { lines: Array<{ mark: string; offset: number; duration: number }> } | null
    const settle = async (scene: string) => {
      const line = voice?.lines.find((l) => l.mark === scene)
      if (line) await sleep((marks[scene]! + line.offset + line.duration + 0.45) * 1000 - Date.now())
    }
    await cast.start()
    await pointer.glide(758, 608, 200) // a first repaint, so the recording starts on a frame
    mark('start')

    // Scene 1, hook: ChatGPT's own list is long and flat. History+ opens from its sidebar entry.
    await sleep(500)
    const nativeList = page.locator('#history')
    await pointer.to(nativeList, { fx: 0.5, fy: 0.45, ms: 700 })
    await pointer.scroll(420, 900)
    mark('hook:open')
    await pointer.click(entry, { ms: 700 })
    await expect(panel(page)).toBeVisible()
    await expect(panel(page).locator('.count')).toHaveText(total.toLocaleString('en-US'))
    await sleep(900)
    await settle('start')

    // Scene 2, live search: type into the real search box; the list narrows to matching titles.
    mark('search')
    await pointer.click(search(page), { fx: 0.3, ms: 650 })
    await expect(search(page)).toBeFocused()
    await search(page).pressSequentially(STORY.query, { delay: 150 })
    await expect(search(page)).toHaveValue(STORY.query)
    await expect(titles(page).first()).toBeVisible()
    for (const t of await titles(page).allTextContents()) expect(t.toLowerCase()).toContain(STORY.query)
    await expect(row(page, STORY.searchPick)).toBeVisible()
    mark('search:results')
    await sleep(2300)
    await pointer.click(row(page, STORY.searchPick), { fx: 0.4 })
    await expect(chatTitle(page)).toHaveText(STORY.searchPick)
    await expect(row(page, STORY.searchPick)).toHaveAttribute('aria-current', 'page')
    mark('search:opened')
    await sleep(1100)
    await settle('search')

    // Scene 3, categories: a filter from the bar (chosen from this history), then any category from More.
    mark('category')
    await pointer.click(panel(page).getByRole('button', { name: 'Clear search' }))
    await expect(search(page)).toHaveValue('')
    await sleep(500)
    const { chip: barPick, more: morePick } = STORY.categories
    await pointer.click(chip(page, barPick.label))
    await expect(chip(page, barPick.label)).toHaveAttribute('aria-pressed', 'true')
    await expect(row(page, barPick.shows)).toBeVisible()
    await expect(row(page, morePick.shows)).toBeHidden()
    mark('category:bar')
    await sleep(1500)
    // More lists every category, grouped, with counts; the one picked joins the bar while selected.
    await pointer.click(panel(page).locator('.cat-more'))
    const menu = panel(page).locator('.cat-menu')
    await expect(menu).toBeVisible()
    mark('category:more')
    await sleep(1200)
    // More's own search box has focus; a few letters find any category.
    await expect(menu.getByPlaceholder('Find a category')).toBeFocused()
    await menu.getByPlaceholder('Find a category').pressSequentially(morePick.find, { delay: 130 })
    await sleep(700)
    await pointer.click(menu.locator(`.cat-item[data-id="${morePick.id}"]`), { fx: 0.3 })
    await expect(menu).toBeHidden()
    await expect(chip(page, morePick.label)).toHaveAttribute('aria-pressed', 'true')
    await expect(row(page, morePick.shows)).toBeVisible()
    await expect(row(page, barPick.shows)).toBeHidden()
    mark('category:picked')
    await sleep(1600)
    await settle('category')

    // Scene 4, dates: back to everything, open the date groups, jump to an older chat.
    mark('dates')
    // Clicking the selected filter again clears it (the row has scrolled to keep that filter in view).
    await pointer.click(chip(page, STORY.categories.more.label))
    await expect(chip(page, 'All')).toHaveAttribute('aria-pressed', 'true')
    // The row shifts as that filter leaves it; move off so the pointer isn't left on another chip.
    await pointer.glide(pointer.x - 30, pointer.y + 110, 380)
    await sleep(250)
    // Today and Yesterday are in view; open an older week, then scroll (a real wheel scroll) to its chats.
    await pointer.click(group(page, STORY.group), { fx: 0.25 })
    await expect(group(page, STORY.group)).toHaveAttribute('aria-expanded', 'true')
    mark('dates:expanded')
    await sleep(1100)
    const list = panel(page).locator('#chp-list')
    await expect(row(page, STORY.datePick)).toBeAttached()
    const at = (await row(page, STORY.datePick).boundingBox())!.y
    await pointer.glide(pointer.x + 40, pointer.y + 30, 300)
    await pointer.scroll(at - 400, 700)
    await sleep(300)
    await pointer.click(row(page, STORY.datePick), { fx: 0.4 })
    await expect(chatTitle(page)).toHaveText(STORY.datePick)
    await expect(row(page, STORY.datePick)).toHaveAttribute('aria-current', 'page')
    mark('dates:opened')
    await sleep(900)
    await settle('dates')

    // Scene 5, related: chats about the same PR, surfaced locally from titles.
    mark('related')
    await pointer.scroll(-900, 700)
    await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(0)
    await expect(panel(page).locator('.related-head')).toBeVisible()
    await sleep(700)
    await pointer.click(panel(page).locator('.related-more'), { fx: 0.3 })
    await expect(panel(page).locator('.conv.related')).toHaveCount(3)
    await sleep(1200)
    await pointer.click(panel(page).locator('.conv.related', { hasText: STORY.relatedPick }), { fx: 0.4 })
    await expect(chatTitle(page)).toHaveText(STORY.relatedPick)
    mark('related:opened')
    await sleep(1600)
    await settle('related')
    mark('end')
    await cast.stop()

    // --- Stills for the thumbnail (lossless, not part of the video).
    await page.evaluate(() => (window as unknown as { __promoCursor(show: boolean): void }).__promoCursor(false))
    await search(page).fill(STORY.query)
    await expect(row(page, STORY.searchPick)).toBeVisible()
    await page.mouse.move(900, 700)
    await sleep(400)
    await panel(page).screenshot({ path: resolve(OUT, 'still-search-panel.png') })
    await page.screenshot({ path: resolve(OUT, 'still-search-page.png') })

    const box = (await panel(page).boundingBox())!
    expect(errors).toEqual([])
    const t0 = marks.start!
    await mkdir(OUT, { recursive: true })
    await writeFile(
      resolve(OUT, 'timeline.json'),
      JSON.stringify(
        {
          viewport: VIEWPORT,
          dpr: DPR,
          panel: box,
          total,
          marks: Object.fromEntries(Object.entries(marks).map(([k, v]) => [k, +(v - t0).toFixed(3)])),
          frames: cast.frames.map((f) => ({ file: f.file, t: +(f.t - t0).toFixed(4) })),
        },
        null,
        1,
      ),
    )
  } finally {
    await context.close()
  }
})
