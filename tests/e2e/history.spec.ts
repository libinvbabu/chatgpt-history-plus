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
    expect(Math.round(width)).toBe(400)
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

  test('remembers collapsed groups across reloads', async ({ page }) => {
    await page.goto('https://chatgpt.com/')
    await openPanel(page)
    await waitForSync(page, 650)
    const today = panel(page).locator('.list .group', { hasText: 'Today' }).first()
    await today.click()
    await expect(today).toHaveAttribute('aria-expanded', 'false')
    await page.waitForTimeout(400) // debounced save
    await page.reload()
    await openPanel(page)
    await expect(panel(page).locator('.list .group', { hasText: 'Today' }).first()).toHaveAttribute('aria-expanded', 'false')
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
    await panel(page).getByRole('button', { name: 'Created' }).click()
    await expect(panel(page).getByRole('button', { name: 'Created' })).toHaveAttribute('aria-pressed', 'true')
    await panel(page).locator('.chip').click()
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
