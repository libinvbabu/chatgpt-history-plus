import type { Page, Worker } from '@playwright/test'
import { accountKey, expect, openPanel, panel, rows, search, test, waitForSync } from './fixtures'

const MOD = process.platform === 'darwin' ? 'Meta' : 'Control'

test.describe('History+', () => {
  test('adds an entry to the sidebar, syncs progressively and groups by date', async ({ page, server, errors }) => {
    await page.goto('https://chatgpt.com/')
    await expect(page.locator('[data-chp-entry]')).toBeVisible()

    await openPanel(page)
    await waitForSync(page, 650)

    // Pages were fetched sequentially with a pause between them.
    const list = server.apiRequests().filter((r) => r.path === '/backend-api/conversations')
    expect(list.map((r) => r.offset)).toEqual([0, 100, 200, 300, 400, 500, 600])
    for (let i = 1; i < list.length; i++) expect(list[i]!.at - list[i - 1]!.at).toBeGreaterThanOrEqual(300)

    const headers = panel(page).locator('.group[data-level="0"] .label')
    await expect(headers.first()).toHaveText('Today')
    await expect(headers.nth(1)).toHaveText('Yesterday')
    await expect(rows(page).first().locator('.title')).toHaveText('Investigate Meta sync failure')

    // Native sidebar items got dates once the cache existed: 28 recents + 1 pinned,
    // one each, even for rows with a second aria-hidden link.
    await expect(page.locator('nav [data-chp-date]').first()).toBeVisible()
    await expect(page.locator('nav [data-chp-date]')).toHaveCount(29)
    await expect(page.locator('a[aria-hidden="true"] [data-chp-date]')).toHaveCount(0)
    expect(errors).toEqual([])
  })

  test('30 Sep sidebar: entry starts the scroll list, is actually visible, and lines up with New chat', async ({ page }) => {
    await page.goto('https://chatgpt.com/')
    const entry = page.locator('[data-chp-entry]')
    await expect(entry).toBeVisible()
    const r = await page.evaluate(() => {
      const e = document.querySelector<HTMLElement>('[data-chp-entry]')!
      const box = e.getBoundingClientRect()
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
      const nc = document.getElementById('new-chat')!
      return {
        parentId: e.parentElement?.id,
        first: e.parentElement?.firstElementChild === e,
        inHeader: !!e.closest('.home-header'),
        inRail: !!e.closest('[data-app-navigation-rail]'),
        inSection: !!e.closest('section'),
        hitIsEntry: hit === e,
        height: Math.round(box.height),
        refHeight: Math.round(nc.getBoundingClientRect().height),
        labelLeft: Math.round(e.shadowRoot!.querySelector('.label')!.getBoundingClientRect().left),
        refLabelLeft: Math.round(nc.querySelector('.text-fade-truncate')!.getBoundingClientRect().left),
      }
    })
    expect(r).toMatchObject({ parentId: 'home-scroll', first: true, inHeader: false, inRail: false, inSection: false, hitIsEntry: true })
    expect(Math.abs(r.height - r.refHeight)).toBeLessThanOrEqual(1)
    expect(Math.abs(r.labelLeft - r.refLabelLeft)).toBeLessThanOrEqual(1)
    await entry.getByRole('button').click()
    await expect(panel(page)).toBeVisible()
  })

  test('rail: a History+ icon follows the last rail button, looks native and opens the panel', async ({ page }) => {
    await page.goto('https://chatgpt.com/')
    const icon = page.locator('[data-chp-rail-entry]')
    await expect(icon).toBeVisible()
    const r = await page.evaluate(() => {
      const e = document.querySelector<HTMLElement>('[data-chp-rail-entry]')!
      const box = e.getBoundingClientRect()
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)
      const ref = document.querySelector<HTMLElement>('[data-sidebar-destination="builtin:sites"]')!
      const refBox = ref.getBoundingClientRect()
      return {
        inRail: !!e.closest('[data-app-navigation-rail]'),
        prev: e.previousElementSibling?.getAttribute('data-sidebar-destination'),
        hitIsEntry: hit === e,
        dw: Math.abs(box.width - refBox.width),
        dh: Math.abs(box.height - refBox.height),
        dx: Math.abs(box.left - refBox.left),
        color: getComputedStyle(e.shadowRoot!.querySelector('button')!).color,
        refColor: getComputedStyle(ref).color,
      }
    })
    expect(r).toMatchObject({ inRail: true, prev: 'builtin:sites', hitIsEntry: true })
    expect(Math.max(r.dw, r.dh, r.dx)).toBeLessThanOrEqual(1)
    expect(r.color).toBe(r.refColor)
    // The labelled row stays too, and neither needs the floating launcher.
    await expect(page.locator('[data-chp-entry]')).toBeVisible()
    await expect(icon.getByRole('button')).toHaveAccessibleName(/History\+/)
    // In the extension's brand colour, not the rail's grey.
    await expect(icon.locator('svg rect')).toHaveAttribute('fill', 'url(#chp-tile)')
    await icon.getByRole('button').click()
    await expect(panel(page)).toBeVisible()
  })

  test('panel opens beside the icon rail, leaving the rail visible and clickable', async ({ page }) => {
    await page.goto('https://chatgpt.com/')
    await openPanel(page)
    const panelLeft = () =>
      page.evaluate(() => Math.round(document.getElementById('chatgpt-history-plus-root')!.shadowRoot!.querySelector('.panel')!.getBoundingClientRect().left))
    const railRight = await page.evaluate(() => Math.round(document.querySelector('[data-app-navigation-rail]')!.getBoundingClientRect().right))
    expect(railRight).toBeGreaterThan(0)
    await expect.poll(panelLeft).toBe(railRight) // after the slide-in animation
    // Every rail button, ours included, is still what the pointer hits.
    const hits = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>('[data-app-navigation-rail] button, [data-chp-rail-entry]')].map((el) => {
        const b = el.getBoundingClientRect()
        const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2)
        return el === hit || el.contains(hit)
      }),
    )
    expect(hits.length).toBeGreaterThan(4)
    expect(hits.every(Boolean)).toBe(true)
    // The panel's own width is unchanged.
    const width = await page.evaluate(() => document.getElementById('chatgpt-history-plus-root')!.shadowRoot!.querySelector('.panel')!.getBoundingClientRect().width)
    expect(Math.round(width)).toBe(380)
  })

  test('going to another rail destination slides the panel back; other rail buttons leave it open', async ({ page }) => {
    await page.goto('https://chatgpt.com/')
    await openPanel(page)
    // The profile button opens a menu rather than going anywhere.
    await page.getByRole('button', { name: 'Open profile menu' }).click()
    await expect(panel(page)).toBeVisible()

    const slidingBack = await page.evaluate(async () => {
      const shadow = document.getElementById('chatgpt-history-plus-root')!.shadowRoot!
      document.querySelector<HTMLElement>('[data-sidebar-destination="builtin:sites"]')!.click()
      await new Promise((resolve) => requestAnimationFrame(resolve))
      return shadow.querySelector('.panel')?.hasAttribute('data-closing') ?? false
    })
    expect(slidingBack).toBe(true) // still on screen for the exit animation...
    await expect(panel(page)).toHaveCount(0) // ...then gone
    await expect(page.locator('[data-chp-rail-entry]')).toBeVisible()

    // History+ is still one click away.
    await page.locator('[data-chp-rail-entry]').getByRole('button').click()
    await expect(panel(page)).toBeVisible()
  })

  test('panel opens at the window edge when there is no rail', async ({ page, server }) => {
    server.layout = 'sep28'
    await page.goto('https://chatgpt.com/')
    await openPanel(page)
    await expect
      .poll(() => page.evaluate(() => Math.round(document.getElementById('chatgpt-history-plus-root')!.shadowRoot!.querySelector('.panel')!.getBoundingClientRect().left)))
      .toBe(0)
  })

  test('collapsed sidebar: the rail icon is still reachable and no launcher is needed', async ({ page, server }) => {
    server.layout = 'sep30-collapsed'
    await page.goto('https://chatgpt.com/')
    const icon = page.locator('[data-chp-rail-entry]')
    await expect(icon).toBeVisible()
    await page.waitForTimeout(4500) // past the launcher's grace period
    await expect(page.locator('[data-chp-launcher]')).toHaveCount(0)
    await icon.getByRole('button').click()
    await expect(panel(page)).toBeVisible()
  })

  test('floating launcher: appears only while no entry is visible, opens the panel, then steps aside', async ({ page }) => {
    await page.goto('https://chatgpt.com/')
    await expect(page.locator('[data-chp-rail-entry]')).toBeVisible()
    const launcher = page.locator('[data-chp-launcher]')
    await expect(launcher).toHaveCount(0)

    // A redesign hides every native entry (a sidebar that is there but not shown).
    const hide = await page.addStyleTag({ content: '#app-shell-sidebar{display:none !important}' })
    await expect(launcher).toBeVisible({ timeout: 15_000 })
    const box = await launcher.boundingBox()
    expect(box!.x + box!.width).toBeGreaterThan(1280 - 2) // hugs the right edge
    await launcher.getByRole('button').click()
    await expect(panel(page)).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(panel(page)).toBeHidden()

    // A native entry is visible again: the launcher goes away at once.
    await hide.evaluate((el) => (el as Element).remove())
    await expect(launcher).toHaveCount(0, { timeout: 5_000 })
  })

  test('floating launcher: an entry that exists but is clipped away does not count as visible', async ({ page, server }) => {
    server.layout = 'sep30-collapsed'
    await page.goto('https://chatgpt.com/')
    await expect(page.locator('[data-chp-rail-entry]')).toBeVisible()
    // The row is placed inside the collapsed (zero-width, overflow-hidden) panel: it has a box, but nothing of it is on screen.
    await expect(page.locator('[data-chp-entry]')).toHaveCount(1)
    expect(
      await page.evaluate(
        () =>
          new Promise<number>((resolve) => {
            const io = new IntersectionObserver((rs) => (resolve(rs[0]!.intersectionRect.width), io.disconnect()))
            io.observe(document.querySelector('[data-chp-entry]')!)
          }),
      ),
    ).toBeLessThan(1)
    // With the rail gone too, only that clipped row is left, so the launcher steps in.
    await page.addStyleTag({ content: 'nav[data-app-navigation-rail]{display:none !important}' })
    await expect(page.locator('[data-chp-launcher]')).toBeVisible({ timeout: 15_000 })
  })

  test('floating launcher: never shown on a signed-out page', async ({ page, server }) => {
    server.loggedOut = true
    server.layout = 'bare'
    await page.goto('https://chatgpt.com/')
    await page.waitForTimeout(6000)
    await expect(page.locator('[data-chp-launcher], [data-chp-entry], [data-chp-rail-entry]')).toHaveCount(0)
  })

  test('28 Sep sidebar: entry sits at the top of the menu group and matches native rows', async ({ page, server }) => {
    server.layout = 'sep28'
    await page.goto('https://chatgpt.com/')
    const entry = page.locator('[data-chp-entry]')
    await expect(entry).toBeVisible()
    const placement = await page.evaluate(() => {
      const e = document.querySelector('[data-chp-entry]')!
      const next = e.nextElementSibling as HTMLElement
      const ref = document.querySelector('[data-sidebar-destination="builtin:automations"]')!
      return {
        parentId: e.parentElement?.id,
        next: next?.getAttribute('data-sidebar-destination'),
        inRail: !!e.closest('[data-app-navigation-rail], [inert]'),
        entryHeight: Math.round(e.getBoundingClientRect().height),
        refHeight: Math.round(ref.getBoundingClientRect().height),
        entryLeft: Math.round(e.shadowRoot!.querySelector('.label')!.getBoundingClientRect().left),
        refLeft: Math.round(ref.querySelector('.text-fade-truncate')!.getBoundingClientRect().left),
      }
    })
    expect(placement).toMatchObject({ parentId: 'menu-group', next: 'builtin:automations', inRail: false })
    expect(Math.abs(placement.entryHeight - placement.refHeight)).toBeLessThanOrEqual(1)
    expect(Math.abs(placement.entryLeft - placement.refLeft)).toBeLessThanOrEqual(1)
    // Follows theme changes: label colour tracks the native rows.
    await page.evaluate(() => document.documentElement.classList.replace('light', 'dark'))
    await page.addStyleTag({ content: 'html.dark .sidebar-item{color:#ececec}' })
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.querySelector('[data-chp-entry]')!.shadowRoot!.querySelector('button')!).color))
      .toBe('rgb(236, 236, 236)')
    await entry.getByRole('button').click()
    await expect(panel(page)).toBeVisible()
  })

  test('legacy sidebar: entry goes right after "Search chats"', async ({ page, server }) => {
    server.layout = 'legacy'
    await page.goto('https://chatgpt.com/')
    await expect(page.locator('[data-chp-entry]')).toBeVisible()
    const prev = await page.evaluate(() => document.querySelector('[data-chp-entry]')!.previousElementSibling?.textContent?.trim())
    expect(prev).toMatch(/^Search chats/)
  })

  test('searches titles locally with no network requests', async ({ page, server }) => {
    await page.goto('https://chatgpt.com/')
    await openPanel(page)
    await waitForSync(page, 650)
    const before = server.log.length

    await search(page).fill('paytm')
    await expect(panel(page).locator('.count')).toHaveText('3 of 650')
    await expect(rows(page).locator('mark').first()).toHaveText('Paytm')
    await search(page).fill('paytm last week')
    await expect(panel(page).locator('.tag')).toContainText('Last week')
    await search(page).fill('paytm in:' + new Date(Date.now() - 40 * 86_400_000).toISOString().slice(0, 7))
    await expect(rows(page)).toHaveCount(1)
    await expect(rows(page).first()).toContainText('Paytm reconciliation')

    expect(server.log.length).toBe(before)
  })

  test('reads whole-query dates and offers a literal fallback', async ({ page }) => {
    await page.goto('https://chatgpt.com/')
    await openPanel(page)
    await waitForSync(page, 650)
    await search(page).fill('yesterday')
    await expect(panel(page).locator('.tag')).toContainText('Yesterday')
    await expect(rows(page).first()).toContainText('Mobile game ideas')
    await panel(page).getByRole('button', { name: /in titles instead/ }).click()
    await expect(panel(page).getByText('No matching conversations')).toBeVisible()
  })

  test('keyboard: arrows + enter navigate client-side when ChatGPT has the link', async ({ page }) => {
    await page.goto('https://chatgpt.com/')
    await page.keyboard.press(`${MOD}+Shift+KeyH`)
    await expect(panel(page)).toBeVisible()
    await waitForSync(page, 650)
    await expect(search(page)).toBeFocused()
    await page.keyboard.press('ArrowDown') // Today header
    await page.keyboard.press('ArrowDown') // first conversation
    await page.keyboard.press('Enter')
    await expect(page.locator('#title')).toHaveText('Investigate Meta sync failure')
    expect(await page.evaluate(() => (window as unknown as { __pageLoads: number }).__pageLoads)).toBe(1)
    expect(await page.evaluate(() => (window as unknown as { __spaNavigations: number }).__spaNavigations)).toBe(1)
    // Wide window: panel stays open for browsing, marking the open conversation.
    await expect(panel(page)).toBeVisible()
    await expect(rows(page).first()).toHaveAttribute('aria-current', 'page')
    await page.keyboard.press('Escape')
    await expect(panel(page)).toBeHidden()
  })

  test('opens an old conversation outside the native sidebar and restores the panel', async ({ page, server }) => {
    const old = server.byTitle('Kisan pricing model')
    await page.goto('https://chatgpt.com/')
    await openPanel(page)
    await waitForSync(page, 650)
    await search(page).fill('kisan pricing')
    await expect(rows(page)).toHaveCount(1)
    await search(page).press('Enter')
    await page.waitForURL(`https://chatgpt.com/c/${old.id}`)
    await expect(page.locator('#title')).toHaveText('Kisan pricing model')
    await expect(panel(page)).toBeVisible()
    await expect(search(page)).toHaveValue('kisan pricing')
  })

  test('Today is always open; other groups start collapsed and remember what you open', async ({ page }) => {
    await page.goto('https://chatgpt.com/')
    await openPanel(page)
    await waitForSync(page, 650)
    const group = (name: string) => panel(page).locator('.list .group', { hasText: name }).first()

    // Today: open, no chevron, nothing to click.
    await expect(group('Today')).toHaveClass(/static/)
    await expect(group('Today').locator('.chev')).toHaveCount(0)
    await expect(group('Today')).not.toHaveAttribute('aria-expanded', /.*/)
    await expect(group('Today').locator('.sublabel')).toHaveText(/\w{3}, \w{3} \d{1,2}/) // its date, on the right
    // Everything else starts collapsed, with a count beside the title and a date range on the right.
    await expect(group('Yesterday')).toHaveAttribute('aria-expanded', 'false')
    await expect(group('Yesterday').locator('.n')).toHaveText('1')
    await expect(group('Yesterday').locator('.sublabel')).toHaveText(/\w{3}, \w{3} \d{1,2}/)
    await expect(rows(page).filter({ hasText: 'Mobile game ideas' })).toHaveCount(0)

    // Expanding does not navigate; the choice survives a reload.
    const url = page.url()
    await group('Yesterday').click()
    await expect(group('Yesterday')).toHaveAttribute('aria-expanded', 'true')
    await expect(rows(page).filter({ hasText: 'Mobile game ideas' })).toHaveCount(1)
    expect(page.url()).toBe(url)
    await page.waitForTimeout(400) // debounced save
    await page.reload()
    await openPanel(page)
    await expect(group('Yesterday')).toHaveAttribute('aria-expanded', 'true')

    // Searching shows matches without opening anything, and clearing restores the groups as they were.
    await search(page).fill('lottery-nothing')
    await search(page).fill('paytm')
    await expect(rows(page)).toHaveCount(3)
    await search(page).fill('')
    await expect(group('Yesterday')).toHaveAttribute('aria-expanded', 'true')
    await expect(group('Earlier this week')).toHaveAttribute('aria-expanded', 'false')
  })

  test('related to this chat: above Today, date + time, explained on hover, persistent, and it navigates', async ({ page, server }) => {
    const current = server.byTitle('Review Razorpay Settlement PR #5150')
    const followUp = server.byTitle('Razorpay PR 5150 follow-up fixes')
    await page.goto(`https://chatgpt.com/c/${current.id}`)
    await openPanel(page)
    await waitForSync(page, 650)

    const header = panel(page).locator('.related-head')
    await expect(header.locator('.label')).toHaveText('Related to this chat')
    await expect(header.locator('.n')).toHaveText('3') // three other chats about PR 5150
    await expect(header).toHaveAttribute('aria-expanded', 'true')
    // Immediately above Today, and visually quieter than it.
    const ys = await panel(page).locator('.list .group').evaluateAll((els) => els.slice(0, 2).map((e) => [e.textContent, e.getBoundingClientRect().top]))
    expect(String(ys[0]![0])).toMatch(/Related to this chat/)
    expect(String(ys[1]![0])).toMatch(/^Today/)
    expect(ys[0]![1] as number).toBeLessThan(ys[1]![1] as number)

    // The two strongest, with a "Show 1 more" for the third; never the open chat itself.
    const related = panel(page).locator('.conv.related')
    await expect(related).toHaveCount(2)
    await expect(panel(page).locator('.related-more')).toHaveText('Show 1 more')
    await expect(related.filter({ hasText: 'Review Razorpay Settlement PR #5150' })).toHaveCount(0)
    // Same density and structure as an ordinary row; date and time, compactly, on the right.
    const row = related.filter({ hasText: 'follow-up fixes' })
    await expect(row.locator('.cat svg')).toHaveCount(1)
    await expect(row.locator('.when')).toHaveText(/^[A-Z][a-z]{2} \d{1,2}(, \d{4})? · \d{1,2}:\d{2}\s[AP]M$/)
    const heights = await panel(page).locator('.conv').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)))
    expect(new Set(heights).size).toBe(1)
    // The reason is hover text, derived from the match.
    await expect(row).toHaveAttribute('title', /Related: Same PR number \(#5150\)/)

    // "Show more" reveals the rest, and the choice sticks.
    await panel(page).locator('.related-more').click()
    await expect(related).toHaveCount(3)
    await expect(panel(page).locator('.related-more')).toHaveText('Show less')

    // Collapsing keeps only the header, and survives a reload.
    await header.click()
    await expect(related).toHaveCount(0)
    await expect(header).toHaveAttribute('aria-expanded', 'false')
    await page.waitForTimeout(400) // debounced save
    await page.reload()
    await openPanel(page)
    await expect(panel(page).locator('.related-head')).toHaveAttribute('aria-expanded', 'false')
    await panel(page).locator('.related-head').click()
    await expect(related.first()).toBeVisible()

    // Clicking a suggestion opens that chat; the block then re-centres on it and offers the one we left.
    await related.filter({ hasText: 'follow-up fixes' }).click()
    await page.waitForURL(`https://chatgpt.com/c/${followUp.id}`)
    await expect(page.locator('#title')).toHaveText('Razorpay PR 5150 follow-up fixes')
    await expect(panel(page)).toBeVisible()
    await expect(panel(page).locator('.conv.related').filter({ hasText: 'Review Razorpay Settlement PR #5150' })).toHaveCount(1)
    await expect(panel(page).locator('.conv.related').filter({ hasText: 'Razorpay PR 5150 follow-up fixes' })).toHaveCount(0)
  })

  test('related to this chat follows client-side navigation, hides when empty, and the open chat is highlighted', async ({ page, server }) => {
    const razorpay = server.byTitle('Review Razorpay Settlement PR #5150')
    const game = server.byTitle('Mobile game ideas')
    const meta = server.byTitle('Investigate Meta sync failure')
    await page.goto('https://chatgpt.com/')
    await openPanel(page)
    await waitForSync(page, 650)
    const go = (id: string) => page.evaluate((path) => history.pushState({}, '', path), `/c/${id}`)
    const head = panel(page).locator('.related-head')

    await expect(head).toHaveCount(0) // no open chat
    await go(razorpay.id)
    await expect(head).toBeVisible()
    await go(game.id) // nothing about it elsewhere: the section goes away, no placeholder
    await expect(head).toHaveCount(0)
    await expect(panel(page).locator('.conv.related')).toHaveCount(0)
    await go(razorpay.id)
    await expect(head).toBeVisible()

    // The open chat's row is highlighted at once, and the highlight moves with navigation.
    await go(meta.id)
    const current = panel(page).locator('.conv[aria-current="page"]')
    await expect(current).toHaveCount(1)
    await expect(current).toContainText('Investigate Meta sync failure')
    await page.goBack()
    await expect(head).toBeVisible() // back/forward are navigations too
    await expect(panel(page).locator('.conv[aria-current="page"]')).toHaveCount(0) // Razorpay chat is in a collapsed group
  })

  test('opening another chat does not reset the list scroll position', async ({ page, server }) => {
    const meta = server.byTitle('Investigate Meta sync failure')
    await page.goto('https://chatgpt.com/')
    await openPanel(page)
    await waitForSync(page, 650)
    await panel(page).locator('.list .group', { hasText: 'Earlier this week' }).click()
    const list = panel(page).locator('.list')
    await list.evaluate((el) => (el.scrollTop = 400))
    await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBe(400)
    await page.evaluate((path) => history.pushState({}, '', path), `/c/${meta.id}`)
    await page.waitForTimeout(500)
    expect(await list.evaluate((el) => el.scrollTop)).toBe(400)
  })

  test('rows are one line: category icon, title, right-aligned 12-hour time', async ({ page }) => {
    await page.goto('https://chatgpt.com/')
    await openPanel(page)
    await waitForSync(page, 650)
    const todays = panel(page).locator('.conv')
    await expect(todays).toHaveCount(2)
    const m = await todays.evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect()
        const cat = e.querySelector('.cat')!.getBoundingClientRect()
        const title = e.querySelector('.title')!.getBoundingClientRect()
        const when = e.querySelector('.when') as HTMLElement
        const w = when.getBoundingClientRect()
        const svg = e.querySelector('.cat svg')!.getBoundingClientRect()
        return { h: r.height, catLeft: cat.left - r.left, catWidth: cat.width, iconSize: svg.width, titleLeft: title.left, titleRight: title.right, whenLeft: w.left, whenRight: w.right, rowRight: r.right, when: when.textContent, tab: getComputedStyle(when).fontVariantNumeric }
      }),
    )
    for (const row of m) {
      expect(row.h).toBeGreaterThanOrEqual(34) // roomy enough to scan, still one line
      expect(row.h).toBeLessThanOrEqual(38)
      expect(row.when).toMatch(/^\d{1,2}:\d{2}\s[AP]M$/)
      expect(row.tab).toContain('tabular-nums')
    }
    for (const row of m) {
      expect(row.catWidth).toBe(18) // fixed icon box
      expect(row.iconSize).toBe(15)
      expect(row.whenLeft - row.titleRight).toBeGreaterThanOrEqual(12) // never crowds the title
      expect(row.rowRight - row.whenRight).toBeGreaterThanOrEqual(8)
    }
    expect(Math.abs(m[0]!.whenRight - m[1]!.whenRight)).toBeLessThan(1) // times line up
    expect(Math.abs(m[0]!.catLeft - m[1]!.catLeft)).toBeLessThan(1) // icons line up
    expect(Math.abs(m[0]!.titleLeft - m[1]!.titleLeft)).toBeLessThan(1)
    // Category name on hover (the icon), full title and timestamps on the row.
    await expect(todays.filter({ hasText: 'Investigate Meta sync failure' }).locator('.cat')).toHaveAttribute('title', 'Technology · Debugging')
    await expect(todays.filter({ hasText: 'Review duplicate Paytm debit query' }).locator('.cat')).toHaveAttribute('title', 'Work · Payments')
    await expect(todays.first()).toHaveAttribute('title', /Created: .*\nLast active: /)
  })

  /** A chip in the filter row (not More). */
  const chip = (page: Page, label: string) => panel(page).locator('.cats-scroll .cat-chip', { hasText: new RegExp(`^${label}$`) })
  const chipLabels = (page: Page) => panel(page).locator('.cats-scroll .cat-chip > span').allTextContents()
  const more = (page: Page) => panel(page).locator('.cat-more')
  const menuItem = (page: Page, label: string) => panel(page).locator('.cat-menu .cat-item').filter({ has: page.locator('.label', { hasText: new RegExp(`^${label}$`) }) })
  /** Chips carry no numbers; the count is in the hover text ("12 chats"). */
  const chipCount = async (page: Page, label: string) => Number((await chip(page, label).getAttribute('title'))!.replace(/[^\d]/g, ''))
  const menuCount = async (page: Page, label: string) => Number((await menuItem(page, label).locator('.n').textContent())!.replace(/[^\d]/g, ''))
  const sortBy = async (page: Page, name: 'Last active' | 'Created') => {
    await panel(page).locator('.sort-chip').click()
    await panel(page).getByRole('menuitemradio', { name }).click()
  }
  /** What the date groups say, summed (the related block is not a date group). */
  const groupTotal = (page: Page) =>
    panel(page)
      .locator('.list .group[data-level="0"]:not(.related-head) .n')
      .evaluateAll((els) => els.reduce((sum, e) => sum + Number((e.textContent ?? '0').replace(/,/g, '')), 0))
  /** The filter bar is chosen provisionally while the first sync runs; wait for the final choice. */
  const barSettled = async (worker: Worker) =>
    expect
      .poll(() => worker.evaluate(async () => Object.entries(await chrome.storage.local.get(null)).some(([k, v]) => k.startsWith('flt:') && (v as { complete?: boolean }).complete)), { timeout: 10_000 })
      .toBe(true)
  const ready = async (page: Page, worker: Worker) => {
    await page.goto('https://chatgpt.com/')
    await openPanel(page)
    await waitForSync(page, 650)
    await barSettled(worker)
  }

  test('filter bar: All, filters chosen from this history, then More; one row that scrolls sideways; no numbers', async ({ page, worker }) => {
    await ready(page, worker)
    const labels = await chipLabels(page)
    expect(labels[0]).toBe('All')
    expect(labels.length).toBeGreaterThanOrEqual(4)
    expect(labels.length).toBeLessThanOrEqual(6) // All + up to five
    // This mock history is mostly engineering, with some product, personal and writing chats. Once the
    // first sync is complete the choice is made afresh, so it does not depend on how the pages arrived.
    expect(labels).toEqual(['All', 'Technology', 'Debugging', 'Personal', 'Work', 'Writing'])
    expect(labels).not.toContain('General')
    expect(labels.filter((l) => ['Technology', 'Debugging', 'Backend', 'Architecture', 'Frontend', 'Infrastructure'].includes(l)).length).toBeLessThanOrEqual(3) // no family fills the bar
    expect(labels.some((l) => ['Personal', 'Work', 'Writing', 'Travel', 'Product'].includes(l))).toBe(true)
    await expect(chip(page, 'All')).toHaveAttribute('aria-pressed', 'true')
    await expect(panel(page).locator('.cat-chip[aria-pressed="true"]')).toHaveCount(1)
    await expect(chip(page, 'Technology')).toHaveAttribute('title', /^\d[\d,]* chats?$/)
    await expect(more(page)).toBeInViewport({ ratio: 1 })
    await expect(panel(page).locator('.cats-scroll .cat-more')).toHaveCount(0) // More stays put, outside the scrolling part

    const m = await panel(page).evaluate((root) => {
      const scroller = root.querySelector<HTMLElement>('.cats-scroll')!
      const chips = [...root.querySelectorAll<HTMLElement>('.cats .cat-chip')]
      const search = root.querySelector('.search')!.getBoundingClientRect()
      const box = scroller.getBoundingClientRect()
      const cs = getComputedStyle(chips[1]!)
      return {
        lines: new Set(chips.map((c) => Math.round(c.getBoundingClientRect().top))).size,
        digits: chips.some((c) => /\d/.test(c.textContent ?? '')),
        icons: [...new Set([...scroller.querySelectorAll('.cat-chip svg')].map((s) => s.getBoundingClientRect().width))],
        scrolls: scroller.scrollWidth > scroller.clientWidth,
        scrollbar: getComputedStyle(scroller).scrollbarWidth,
        overscroll: getComputedStyle(scroller).overscrollBehaviorX,
        belowSearch: box.top >= search.bottom && box.top - search.bottom <= 16,
        pageOverflow: root.scrollWidth > root.clientWidth,
        height: chips[0]!.getBoundingClientRect().height,
        gap: chips[1]!.getBoundingClientRect().left - chips[0]!.getBoundingClientRect().right,
        padding: parseFloat(cs.paddingLeft),
        border: cs.borderTopWidth,
        shadow: cs.boxShadow,
      }
    })
    expect(m.lines).toBe(1) // never wraps, More included
    expect(m.digits).toBe(false)
    expect(m.icons).toEqual([14])
    expect(m.scrolls).toBe(true)
    expect(m.scrollbar).toBe('none')
    expect(m.overscroll).toBe('contain') // a swipe past the end is not browser back/forward
    expect(m.belowSearch).toBe(true)
    expect(m.pageOverflow).toBe(false)
    expect(m.height).toBeGreaterThanOrEqual(28)
    expect(m.height).toBeLessThanOrEqual(30)
    expect(m.gap).toBeGreaterThanOrEqual(6)
    expect(m.gap).toBeLessThanOrEqual(8)
    expect(m.padding).toBeGreaterThanOrEqual(10)
    expect(m.padding).toBeLessThanOrEqual(12)
    expect(m.border).toBe('0px')
    expect(m.shadow).toBe('none')

    // The right edge fades while there is more; at the end, the left edge does instead.
    const cats = panel(page).locator('.cats')
    await expect(cats).toHaveAttribute('data-fade-end', 'true')
    await expect(cats).not.toHaveAttribute('data-fade-start', /.*/)

    // A mouse wheel over the chips scrolls them sideways, and nothing else.
    const listTop = () => panel(page).locator('.list').evaluate((el) => el.scrollTop)
    const before = await listTop()
    await chip(page, 'Technology').hover()
    await page.mouse.wheel(0, 400)
    await expect.poll(() => panel(page).locator('.cats-scroll').evaluate((el) => el.scrollLeft)).toBeGreaterThan(0)
    expect(await listTop()).toBe(before)
    await expect(chip(page, labels.at(-1)!)).toBeInViewport({ ratio: 1 })
    await expect(cats).toHaveAttribute('data-fade-start', 'true')
    await expect(cats).not.toHaveAttribute('data-fade-end', /.*/)
  })

  test('picking a filter narrows the list; primaries add up to everything; the same chip again returns to All', async ({ page, worker }) => {
    await ready(page, worker)
    const count = panel(page).locator('.count')

    // Each conversation has exactly one primary category: their counts in More add up to everything.
    await more(page).click()
    const primaries = ['Work', 'Learning', 'Writing', 'Creative', 'Technology', 'Planning', 'Personal', 'General']
    let sum = 0
    for (const p of primaries) sum += await menuCount(page, p)
    expect(sum).toBe(650)
    await page.keyboard.press('Escape')
    await expect(panel(page).locator('.cat-menu')).toHaveCount(0)
    await expect(panel(page)).toBeVisible() // Escape closed only the menu

    // A primary: everything filed under it.
    await chip(page, 'Technology').click()
    const tech = await chipCount(page, 'Technology')
    expect(tech).toBeGreaterThan(0)
    await expect(chip(page, 'Technology')).toHaveAttribute('aria-pressed', 'true')
    await expect(chip(page, 'All')).toHaveAttribute('aria-pressed', 'false')
    await expect(count).toHaveText(`${tech} of 650`)
    expect(await groupTotal(page)).toBe(tech) // date-group counts reflect the filter too
    for (let i = 0; i < 3 && (await rows(page).count()) < 3; i++) await panel(page).locator('.list .group[aria-expanded="false"]').first().click()
    const kinds = await rows(page).evaluateAll((els) => els.map((e) => e.querySelector('.cat')!.getAttribute('data-category')))
    expect(kinds.length).toBeGreaterThan(1)
    expect(new Set(kinds)).toEqual(new Set(['technology']))

    // A subcategory: only that part of it.
    await chip(page, 'Debugging').click()
    const debugging = await chipCount(page, 'Debugging')
    expect(debugging).toBeLessThan(tech)
    await expect(count).toHaveText(`${debugging} of 650`)
    const subs = await rows(page).evaluateAll((els) => els.map((e) => e.querySelector('.cat')!.getAttribute('data-sub')))
    expect(new Set(subs)).toEqual(new Set(['debugging']))

    // The chip again: back to All, and nothing else was reset.
    await chip(page, 'Debugging').click()
    await expect(chip(page, 'All')).toHaveAttribute('aria-pressed', 'true')
    await expect(count).toHaveText('650')
  })

  test('filters work with search, date and sorting, and switching keeps them', async ({ page, worker, server }) => {
    await ready(page, worker)
    const count = panel(page).locator('.count')
    const requests = server.apiRequests().length

    // Search: counts follow the matches, and the selected filter narrows them further.
    await search(page).fill('paytm')
    await expect(count).toHaveText(/^\d+ of 650$/)
    const matches = Number((await count.textContent())!.split(' ')[0])
    // Paytm chats are payments work, except the architecture one, which is technology.
    expect(await chipCount(page, 'Technology')).toBe(1)
    await more(page).click()
    expect(await menuCount(page, 'Payments')).toBe(matches - 1)
    expect(await menuCount(page, 'Work')).toBe(matches - 1)
    // A filter from More joins the row while it is selected.
    await menuItem(page, 'Payments').click()
    await expect(panel(page).locator('.cat-menu')).toHaveCount(0)
    await expect(chip(page, 'Payments')).toHaveAttribute('aria-pressed', 'true')
    await expect(chip(page, 'Payments')).toHaveAttribute('data-extra', 'true')
    await expect(chip(page, 'Payments')).toBeInViewport({ ratio: 1 })
    await expect(count).toHaveText(`${matches - 1} of 650`)
    await expect(search(page)).toHaveValue('paytm') // switching did not reset the query

    // Sorting is independent of the filter.
    await sortBy(page, 'Created')
    await more(page).click()
    await expect(menuItem(page, 'Writing')).toHaveAttribute('data-empty', 'true')
    await menuItem(page, 'Writing').click()
    await expect(panel(page).locator('.sort-chip')).toHaveText('Created')
    await expect(search(page)).toHaveValue('paytm')
    await expect(rows(page)).toHaveCount(0)
    await expect(panel(page).getByText('No matching conversations')).toBeVisible()
    // The empty state says why and offers the way out.
    await panel(page).getByRole('button', { name: 'Show all categories' }).click()
    await expect(chip(page, 'All')).toHaveAttribute('aria-pressed', 'true')
    await expect(chip(page, 'Payments')).toHaveCount(0) // it left the row with the selection
    await expect(count).toHaveText(`${matches} of 650`)

    // Date filter: Today holds one technology (debugging) chat and one payments chat.
    await search(page).fill('')
    await panel(page).getByRole('button', { name: 'All dates' }).click()
    await panel(page).getByRole('menuitemradio', { name: 'Today' }).click()
    await expect(count).toHaveText('2 of 650')
    expect(await chipCount(page, 'Technology')).toBe(1)
    await chip(page, 'Technology').click()
    await expect(count).toHaveText('1 of 650')
    await expect(rows(page)).toHaveCount(1)
    await expect(rows(page).first().locator('.title')).toHaveText('Investigate Meta sync failure')
    await expect(panel(page).locator('.date-chip')).toContainText('Today') // the date filter is still on

    // Categorising is local: none of this asked ChatGPT for anything.
    expect(server.apiRequests().length).toBe(requests)
  })

  test('More: every category, grouped, with counts; find one by name; keyboard friendly', async ({ page, worker }) => {
    await ready(page, worker)
    await more(page).click()
    const menu = panel(page).locator('.cat-menu')
    await expect(menu).toHaveAttribute('role', 'dialog')
    await expect(menu.locator('.cat-menu-search input')).toBeFocused()

    // Primaries in a fixed order, always listed; subcategories under them, only those this history has.
    const top = await menu.locator('.cat-item[data-level="0"] .label').allTextContents()
    expect(top).toEqual(['Work', 'Learning', 'Writing', 'Creative', 'Technology', 'Planning', 'Personal', 'General'])
    await expect(menuItem(page, 'PR Reviews')).toHaveAttribute('data-level', '1')
    await expect(menuItem(page, 'Mathematics')).toHaveCount(0) // nobody here does maths
    const order = await menu.locator('.cat-item .label').allTextContents()
    expect(order.indexOf('PR Reviews')).toBeGreaterThan(order.indexOf('Technology'))
    expect(order.indexOf('PR Reviews')).toBeLessThan(order.indexOf('Planning'))
    // The list scrolls inside the menu; the menu stays inside the panel.
    const fits = await panel(page).evaluate((root) => {
      const m = root.querySelector('.cat-menu')!.getBoundingClientRect()
      const p = root.getBoundingClientRect()
      return m.left >= p.left && m.right <= p.right && m.bottom <= p.bottom
    })
    expect(fits).toBe(true)

    // Find by name; a subcategory says which primary it belongs to.
    await page.keyboard.type('trav')
    await expect(menu.locator('.cat-item')).toHaveCount(1)
    await expect(menuItem(page, 'Travel').locator('.in')).toHaveText('Personal')
    await page.keyboard.type('elzzz')
    await expect(menu.locator('.cat-menu-empty')).toBeVisible()
    await menu.locator('input').fill('')

    // Opened with a filter selected, the list starts at it.
    await page.keyboard.press('Escape')
    await chip(page, 'Writing').click()
    await more(page).click()
    await expect(menuItem(page, 'Writing')).toBeInViewport({ ratio: 1 })
    await menuItem(page, 'Writing').click() // picking the selected one again clears it
    await expect(chip(page, 'All')).toHaveAttribute('aria-pressed', 'true')
    await more(page).click()

    // Arrows move from the search box into the list; Enter picks and closes; focus returns to More.
    await page.keyboard.press('ArrowDown')
    await expect(menuItem(page, 'Work')).toBeFocused()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(menu).toHaveCount(0)
    const picked = await panel(page).locator('.cat-chip[aria-pressed="true"]').textContent()
    expect(picked).not.toBe('All')
    await expect(more(page)).toBeFocused()
  })

  test('customize: pin, hide and reset filters; the choice survives a reload', async ({ page, worker }) => {
    await ready(page, worker)
    const auto = await chipLabels(page)
    const victim = auto[2]! // an automatic filter to hide
    await more(page).click()
    await panel(page).getByRole('button', { name: 'Customize filters' }).click()
    await expect(panel(page).locator('.cat-menu')).toHaveAttribute('aria-label', 'Customize filters')
    await panel(page).getByRole('button', { name: 'Pin Travel' }).click()
    await panel(page).getByRole('button', { name: `Hide ${victim}` }).click()
    await expect(menuItem(page, 'Travel').locator('.cat-status')).toHaveText('Pinned')
    await expect(menuItem(page, victim).locator('.cat-status')).toHaveText('Hidden')
    await panel(page).getByRole('button', { name: 'Done' }).click()
    await page.keyboard.press('Escape')

    // Pinned first; the hidden one gone; still one row.
    const labels = await chipLabels(page)
    expect(labels[1]).toBe('Travel')
    expect(labels).not.toContain(victim)
    expect(labels.length).toBeLessThanOrEqual(6)

    await page.reload()
    await openPanel(page)
    await expect.poll(() => chipLabels(page)).toEqual(labels)

    // Reset: back to the automatic choice.
    await more(page).click()
    await panel(page).getByRole('button', { name: 'Customize filters' }).click()
    await panel(page).getByRole('button', { name: 'Reset to automatic' }).click()
    await page.keyboard.press('Escape')
    await expect.poll(() => chipLabels(page)).toEqual(auto)
  })

  test('the selected filter is remembered: reopening the panel, and reloading the page', async ({ page, worker }) => {
    await ready(page, worker)
    await more(page).click()
    await menuItem(page, 'General').click()
    await expect(chip(page, 'General')).toHaveAttribute('aria-pressed', 'true')

    await page.keyboard.press('Escape') // search is empty, so this closes the panel
    await expect(panel(page)).toHaveCount(0)
    await openPanel(page)
    await expect(chip(page, 'General')).toHaveAttribute('aria-pressed', 'true')
    await expect(panel(page).locator('.count')).toHaveText(/^\d+ of 650$/)

    await page.waitForTimeout(400) // debounced save
    await page.reload()
    await openPanel(page)
    await expect(chip(page, 'General')).toHaveAttribute('aria-pressed', 'true')
    // Reopened with the chip scrolled into view, not left behind the fade.
    await expect(chip(page, 'General')).toBeInViewport({ ratio: 1 })
  })

  test('a filter remembered by History+ 0.2 is carried over to its new name', async ({ page, worker }) => {
    await ready(page, worker)
    await worker.evaluate(() => chrome.storage.local.set({ ui: { category: 'engineering', collapsed: {} } }))
    await page.reload()
    await openPanel(page)
    await expect(chip(page, 'Technology')).toHaveAttribute('aria-pressed', 'true')
    await expect(panel(page).locator('.count')).toHaveText(/^\d+ of 650$/) // no re-sync needed: categories come from titles already stored
  })

  test('chips are keyboard reachable: one tab stop, arrows move, Enter picks', async ({ page, worker }) => {
    await ready(page, worker)
    const labels = await chipLabels(page)
    await chip(page, 'All').focus()
    await page.keyboard.press('ArrowRight')
    await expect(chip(page, labels[1]!)).toBeFocused()
    await page.keyboard.press('End')
    await expect(chip(page, labels.at(-1)!)).toBeFocused()
    await expect(chip(page, labels.at(-1)!)).toBeInViewport({ ratio: 1 }) // focus scrolls it into view
    await page.keyboard.press('Enter')
    await expect(chip(page, labels.at(-1)!)).toHaveAttribute('aria-pressed', 'true')
    await page.keyboard.press('Home')
    await expect(chip(page, 'All')).toBeFocused()
    // Only the selected chip is in the tab order.
    const tabbable = await panel(page).locator('.cats-scroll .cat-chip').evaluateAll((els) => els.filter((e) => (e as HTMLElement).tabIndex >= 0).length)
    expect(tabbable).toBe(1)
  })

  test('date groups: Today has no control; the others keep a chevron, count and date, and the current chat is subtle', async ({ page, server }) => {
    const id = server.conversations[3]!.id
    await page.goto(`https://chatgpt.com/c/${id}`)
    await openPanel(page)
    await waitForSync(page, 650)
    const group = (name: string) => panel(page).locator('.list .group', { hasText: name }).first()
    // The month-by-month archive is behind one header.
    const top = await panel(page).locator('.list .group[data-level="0"]:not(.related-head) .label').allTextContents()
    expect(top).toEqual(['Today', 'Yesterday', 'Earlier this week', 'Last week', 'Older conversations'])
    await expect(group('Older conversations').locator('.sublabel')).toHaveCount(0)
    await group('Older conversations').click()
    const months = await panel(page).locator('.list .group[data-level="1"] .label').allTextContents()
    expect(months.length).toBeGreaterThan(3)
    expect(months[0]).toMatch(/^[A-Z][a-z]+$/) // this year's months need no year
    expect(months.at(-1)).toMatch(/^[A-Z][a-z]+ \d{4}$/)
    await group('Older conversations').click()
    await expect(group('Today')).not.toHaveAttribute('role', 'button')
    expect(await group('Today').evaluate((el) => el.tagName)).toBe('DIV')
    expect(await group('Yesterday').evaluate((el) => el.tagName)).toBe('BUTTON')
    const m = await group('Yesterday').evaluate((el) => {
      const label = el.querySelector('.label')!
      const sub = el.querySelector('.sublabel')!.getBoundingClientRect()
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(label)
      return { upper: cs.textTransform, size: parseFloat(cs.fontSize), spacing: cs.letterSpacing, right: r.right - sub.right, sublabelAfterLabel: sub.left > label.getBoundingClientRect().right }
    })
    expect(m.upper).toBe('uppercase')
    expect(m.size).toBeGreaterThanOrEqual(10)
    expect(m.size).toBeLessThanOrEqual(11)
    expect(m.spacing).not.toBe('normal')
    expect(m.right).toBeLessThan(12) // the date is flush right
    expect(m.sublabelAfterLabel).toBe(true)
    // Rows under Today: a few px between the header and the first conversation below it.
    const gap = await panel(page).evaluate((root) => {
      const h = root.querySelector('.list .group.static')!.getBoundingClientRect()
      const below = [...root.querySelectorAll('.list .conv')].map((c) => c.getBoundingClientRect().top - h.bottom).filter((d) => d >= 0)
      return Math.min(...below)
    })
    expect(gap).toBeGreaterThanOrEqual(4)
    expect(gap).toBeLessThanOrEqual(8)
    // A new section after an open one has air above it, with a hairline in the middle.
    const above = await panel(page).evaluate((root) => {
      const y = [...root.querySelectorAll('.list .group:not(.static):not(.related-head)')][0]!.getBoundingClientRect()
      const before = [...root.querySelectorAll('.list .conv')].map((c) => y.top - c.getBoundingClientRect().bottom).filter((d) => d >= 0)
      return Math.min(...before)
    })
    expect(above).toBeGreaterThanOrEqual(14)
    expect(above).toBeLessThanOrEqual(18)
    await expect(panel(page).locator('.list .group[data-rule]').first()).toContainText('Yesterday')

    // Open the chat that is current: a wash of colour, no border, no shadow, and the title only a little brighter.
    await group('Earlier this week').click()
    const current = panel(page).locator('.conv[aria-current="page"]')
    await expect(current).toHaveCount(1)
    const style = await current.evaluate((el) => {
      const cs = getComputedStyle(el)
      const other = el.parentElement!.parentElement!.querySelector('.conv:not([aria-current])')!
      return { shadow: cs.boxShadow, border: cs.borderTopWidth, radius: parseFloat(cs.borderTopLeftRadius), bg: cs.backgroundColor, titleColor: getComputedStyle(el.querySelector('.title')!).color, otherTitle: getComputedStyle(other.querySelector('.title')!).color }
    })
    expect(style.shadow).toBe('none')
    expect(style.border).toBe('0px')
    expect(style.radius).toBeGreaterThanOrEqual(6)
    expect(style.radius).toBeLessThanOrEqual(8)
    expect(style.bg).not.toBe('rgba(0, 0, 0, 0)')
    expect(style.titleColor).not.toBe(style.otherTitle)
  })

  test('time format: 12-hour with AM/PM by default; 24-hour from Settings, in the list and the native sidebar', async ({ page }) => {
    await page.goto('https://chatgpt.com/')
    await openPanel(page)
    await waitForSync(page, 650)
    const todays = rows(page).locator('.when')
    // Native sidebar: a chat from today shows its time; an older one shows a date, with the time in its tooltip.
    const nativeToday = page.locator('nav a', { hasText: 'Investigate Meta sync failure' }).locator('[data-chp-date]').first()
    const nativeOlder = page.locator('nav [data-chp-date][title]', { hasText: /^[A-Z][a-z]{2} \d{1,2}$/ }).first()
    await expect(todays.first()).toHaveText(/^\d{1,2}:\d{2}\s[AP]M$/)
    await expect(nativeToday).toHaveText(/^\d{1,2}:\d{2}\s[AP]M$/)
    await expect(nativeOlder).toHaveAttribute('title', /· \d{1,2}:\d{2}\s[AP]M$/)

    await panel(page).getByRole('button', { name: 'Settings' }).click()
    await expect(panel(page).getByRole('radio', { name: /12-hour/ })).toBeChecked()
    await panel(page).getByRole('radio', { name: /24-hour/ }).check()
    await panel(page).getByRole('button', { name: 'Back' }).click()
    await expect(todays.first()).toHaveText(/^\d{2}:\d{2}$/)
    await expect(nativeToday).toHaveText(/^\d{2}:\d{2}$/)
    await expect(nativeOlder).toHaveAttribute('title', /· \d{2}:\d{2}$/) // a date-only label, but its tooltip changed
    // The hover text follows too.
    await expect(rows(page).first()).toHaveAttribute('title', /Last active: .* · \d{2}:\d{2}/)

    // It sticks.
    await page.reload()
    await openPanel(page)
    await expect(rows(page).locator('.when').first()).toHaveText(/^\d{2}:\d{2}$/)
    await panel(page).getByRole('button', { name: 'Settings' }).click()
    await expect(panel(page).getByRole('radio', { name: /24-hour/ })).toBeChecked()
    await panel(page).getByRole('radio', { name: /12-hour/ }).check()
    await panel(page).getByRole('button', { name: 'Back' }).click()
    await expect(rows(page).locator('.when').first()).toHaveText(/^\d{1,2}:\d{2}\s[AP]M$/)
  })

  test('stays usable at narrow widths: long titles ellipsise and nothing scrolls sideways', async ({ page, server }) => {
    server.conversations[0]!.title = 'A very long conversation title about reviewing Razorpay settlement reconciliation across every provider and every region'
    await page.setViewportSize({ width: 360, height: 760 })
    await page.goto('https://chatgpt.com/')
    await openPanel(page)
    await waitForSync(page, 650)
    const m = await page.evaluate(() => {
      const root = document.getElementById('chatgpt-history-plus-root')!.shadowRoot!
      const p = root.querySelector('.panel')!
      const list = root.querySelector('.list')!
      const title = root.querySelector('.conv .title') as HTMLElement
      const row = root.querySelector('.conv') as HTMLElement
      const when = row.querySelector('.when')!.getBoundingClientRect()
      return {
        panelOverflow: p.scrollWidth - p.clientWidth,
        listOverflow: list.scrollWidth - list.clientWidth,
        ellipsis: getComputedStyle(title).textOverflow === 'ellipsis' && title.scrollWidth > title.clientWidth,
        timeInsideRow: when.right <= row.getBoundingClientRect().right + 0.5,
        panelWidth: Math.round(p.getBoundingClientRect().width),
      }
    })
    expect(m.panelOverflow).toBeLessThanOrEqual(0)
    expect(m.listOverflow).toBeLessThanOrEqual(0)
    expect(m.ellipsis).toBe(true)
    expect(m.timeInsideRow).toBe(true)
    expect(m.panelWidth).toBeLessThanOrEqual(360)
  })

  test('keeps the cached history usable when ChatGPT’s API fails', async ({ page, server }) => {
    await page.goto('https://chatgpt.com/')
    await openPanel(page)
    await waitForSync(page, 650)
    server.failAll = true
    await page.reload()
    await openPanel(page)
    await expect(panel(page).locator('.count')).toHaveText('650')
    await panel(page).getByRole('button', { name: 'Sync now' }).click()
    await expect(panel(page).locator('.status[data-tone="error"]')).toContainText('Unable to refresh history', { timeout: 40_000 })
    await expect(panel(page).locator('.status[data-tone="error"]')).toContainText('650 previously indexed conversations are still available')
    await search(page).fill('paytm')
    await expect(rows(page)).toHaveCount(3)
  })

  test('asks for a ChatGPT session when signed out, and hides any cache', async ({ page, server }) => {
    server.loggedOut = true
    await page.goto('https://chatgpt.com/')
    await openPanel(page)
    await expect(panel(page).getByText('History+ needs an active ChatGPT session.')).toBeVisible()
    await expect(rows(page)).toHaveCount(0)
  })

  test('backs off and retries on 429', async ({ page, server }) => {
    server.rateLimitOnce = true
    await page.goto('https://chatgpt.com/')
    await openPanel(page)
    await waitForSync(page, 650)
    const statuses = server.apiRequests().map((r) => r.status)
    expect(statuses[0]).toBe(429)
    expect(statuses.filter((s) => s === 200)).toHaveLength(7)
  })

  test('waits out a rate limit with a countdown, then finishes on its own', async ({ page, server }) => {
    server.rateLimitNext = 1
    server.rateLimitRetryAfter = '3'
    await page.goto('https://chatgpt.com/')
    await openPanel(page)
    const status = panel(page).locator('.status')
    await expect(status).toContainText('Waiting on ChatGPT’s rate limit')
    await expect(status).toContainText(/resuming in 0:0[1-3]/)
    await expect(panel(page).locator('.count')).toHaveText('100')
    await waitForSync(page, 650)
    await expect(status).toHaveCount(0)
    // It slowed down after the 429: later pages are spaced ≥ 3 s apart.
    const list = server.apiRequests().filter((r) => r.path === '/backend-api/conversations' && r.status === 200)
    expect(list.at(-1)!.at - list.at(-2)!.at).toBeGreaterThanOrEqual(2900)
  })

  test('filters by date from the menu and switches timestamp mode', async ({ page }) => {
    await page.goto('https://chatgpt.com/')
    await openPanel(page)
    await waitForSync(page, 650)
    await panel(page).getByRole('button', { name: 'All dates' }).click()
    await panel(page).getByRole('menuitemradio', { name: 'Today' }).click()
    await expect(panel(page).locator('.count')).toHaveText('2 of 650')
    await sortBy(page, 'Created')
    await expect(panel(page).locator('.sort-chip')).toHaveText('Created')
    await panel(page).locator('.date-chip').click()
    await panel(page).getByRole('menuitemradio', { name: 'All dates' }).click()
    await expect(panel(page).locator('.count')).toHaveText('650')
  })

  test('settings: full resync and clearing local data', async ({ page, server }) => {
    await page.goto('https://chatgpt.com/')
    await openPanel(page)
    await waitForSync(page, 650)
    server.conversations.splice(3, 1) // deleted in ChatGPT
    await panel(page).getByRole('button', { name: 'Settings' }).click()
    await panel(page).getByRole('button', { name: 'Full resync' }).click()
    await expect(panel(page).getByText('649 conversations')).toBeVisible({ timeout: 30_000 })
    await panel(page).getByRole('button', { name: 'Clear local data' }).click()
    await panel(page).getByRole('button', { name: 'Delete local data' }).click()
    await expect(panel(page).getByText('Local History+ data cleared')).toBeVisible()
    await panel(page).getByRole('button', { name: 'Back' }).click()
    await expect(panel(page).getByText('Local data cleared')).toBeVisible()
    await expect(page.locator('nav [data-chp-date]')).toHaveCount(0)
  })

  test('survives ChatGPT replacing or removing its sidebar', async ({ page, errors }) => {
    await page.goto('https://chatgpt.com/')
    await openPanel(page)
    await waitForSync(page, 650)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    // A redesign: the whole sidebar disappears.
    await page.evaluate(() => document.querySelector('aside')!.remove())
    await page.waitForTimeout(1800)
    await page.keyboard.press(`${MOD}+Shift+KeyH`)
    await expect(panel(page)).toBeVisible()
    await expect(panel(page).locator('.count')).toHaveText('650')
    expect(errors).toEqual([])
  })

  test('handles 10,000 conversations quickly', async ({ page, worker }) => {
    const now = Date.now()
    await worker.evaluate(
      async ({ key, now }) => {
        const words = ['paytm', 'review', 'design', 'meta', 'sync', 'hiring', 'budget', 'notes', 'api', 'plan', 'debug', 'kisan']
        const conversations: Record<string, unknown> = {}
        for (let i = 0; i < 10_000; i++) {
          const id = `c0ffee00-0000-4000-8000-${String(i).padStart(12, '0')}`
          const ts = now - i * 3 * 3_600_000
          conversations[id] = { id, title: `${words[i % 12]} ${words[(i * 5) % 12]} ${i}`, createdAt: ts, updatedAt: ts, cachedAt: now }
        }
        await chrome.storage.local.set({
          [`idx:${key}`]: { schemaVersion: 1, accountKey: key, lastIncrementalSyncAt: now, lastFullSyncAt: now, backfillComplete: true, backfillOffset: 10_000, totalReported: 10_000, conversations },
          ui: { lastAccountKey: key, collapsed: {} },
        })
      },
      { key: accountKey(), now },
    )
    await page.goto('https://chatgpt.com/')
    await expect(page.locator('[data-chp-entry]')).toBeVisible()
    await page.waitForTimeout(2500) // background identification
    const t0 = Date.now()
    await page.locator('[data-chp-entry]').getByRole('button').click()
    await expect(panel(page).locator('.count')).toHaveText('10,000')
    const openMs = Date.now() - t0

    const typed = await page.evaluate(async () => {
      const host = document.getElementById('chatgpt-history-plus-root')!.shadowRoot!
      const input = host.querySelector('input')!
      const count = host.querySelector('.count')!
      const t = performance.now()
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, 'paytm')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise<void>((resolve) => {
        const check = () => (count.textContent?.includes(' of ') ? resolve() : requestAnimationFrame(check))
        check()
      })
      return { ms: performance.now() - t, count: count.textContent }
    })
    console.log(`open: ${openMs} ms (incl. Playwright overhead), search→render: ${typed.ms.toFixed(1)} ms`)
    expect(typed.count).toMatch(/of 10,000/)
    expect(typed.ms).toBeLessThan(150)
    // Only ~a screenful of rows is in the DOM.
    expect(await rows(page).count()).toBeLessThan(60)
  })
})
