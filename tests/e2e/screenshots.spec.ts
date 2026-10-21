// Visual review captures. Run with: SHOTS=<dir> npx playwright test screenshots
import { expect, openPanel, panel, search, test, waitForSync } from './fixtures'

const dir = process.env.SHOTS
test.skip(!dir, 'set SHOTS=<dir> to capture screenshots')

test('capture', async ({ page }) => {
  await page.goto('https://chatgpt.com/')
  await openPanel(page)
  await waitForSync(page, 650)
  await page.screenshot({ path: `${dir}/1-light-default.png` })

  await panel(page).locator('.list').evaluate((el) => (el.scrollTop = el.scrollHeight))
  await page.waitForTimeout(100)
  await panel(page).locator('.list .slot .group[aria-expanded="false"]').first().click()
  await page.waitForTimeout(100)
  await panel(page).locator('.list').evaluate((el) => (el.scrollTop += 520))
  await page.waitForTimeout(150)
  await page.screenshot({ path: `${dir}/2-light-scrolled-sticky.png` })

  await search(page).fill('paytm')
  await page.waitForTimeout(100)
  await page.screenshot({ path: `${dir}/3-search.png` })

  await search(page).fill('around ' + new Date(Date.now() - 12 * 86_400_000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))
  await page.waitForTimeout(100)
  await page.screenshot({ path: `${dir}/4-date-phrase.png` })

  await search(page).fill('')
  await panel(page).getByRole('button', { name: 'All dates' }).click()
  await page.waitForTimeout(100)
  await page.screenshot({ path: `${dir}/5-date-menu.png` })
  await page.keyboard.press('Escape')

  await panel(page).getByRole('button', { name: 'Settings' }).click()
  await page.screenshot({ path: `${dir}/6-settings.png` })
  await panel(page).getByRole('button', { name: 'Back' }).click()

  await page.evaluate(() => document.documentElement.classList.replace('light', 'dark'))
  await page.waitForTimeout(150)
  await page.screenshot({ path: `${dir}/7-dark.png` })
  await search(page).fill('review')
  await page.waitForTimeout(100)
  await page.screenshot({ path: `${dir}/8-dark-search.png` })

  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(panel(page)).toBeHidden()
  await page.locator('nav[aria-label="Chat history"]').hover()
  await page.screenshot({ path: `${dir}/9-native-sidebar-dark.png`, clip: { x: 0, y: 0, width: 300, height: 520 } })
  await page.evaluate(() => document.documentElement.classList.replace('dark', 'light'))
  await page.locator('#history a.title-link').nth(2).hover()
  await page.screenshot({ path: `${dir}/10-native-sidebar-light.png`, clip: { x: 0, y: 0, width: 300, height: 520 } })

  await page.setViewportSize({ width: 375, height: 760 })
  await openPanel(page).catch(async () => {
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+KeyH' : 'Control+Shift+KeyH')
  })
  await page.waitForTimeout(200)
  await page.screenshot({ path: `${dir}/11-narrow.png` })
})

test('capture categories', async ({ page, server }) => {
  const recent = server.byTitle('Investigate Meta sync failure')
  await page.goto(`https://chatgpt.com/c/${recent.id}`)
  await openPanel(page)
  await waitForSync(page, 650)
  await page.waitForTimeout(1200) // the filter bar's final choice lands just after the first sync
  const shot = (name: string) => page.screenshot({ path: `${dir}/c-${name}.png` })
  await page.mouse.move(1000, 700)
  await shot('1-bar-light')
  await panel(page).locator('.cat-more').click()
  await shot('2-more-light')
  await panel(page).getByRole('button', { name: 'Customize filters' }).click()
  await shot('3-customize-light')
  await page.keyboard.press('Escape')
  await panel(page).locator('.cats-scroll .cat-chip', { hasText: /^Debugging$/ }).click()
  await shot('4-subcategory-selected')
  await panel(page).locator('.cats-scroll .cat-chip', { hasText: /^All$/ }).click()

  // 24-hour clock from Settings, with the open chat highlighted.
  await panel(page).getByRole('button', { name: 'Settings' }).click()
  await panel(page).getByText('24-hour').click()
  await shot('5-settings')
  await panel(page).getByRole('button', { name: 'Back' }).click()
  await shot('6-24h')

  await page.evaluate(() => document.documentElement.classList.replace('light', 'dark'))
  await shot('7-bar-dark')
  await panel(page).locator('.cat-more').click()
  await shot('8-more-dark')
  await page.keyboard.press('Escape')

  for (const width of [900, 375]) {
    await page.setViewportSize({ width, height: 760 })
    await page.waitForTimeout(250)
    if (!(await panel(page).isVisible())) await openPanel(page)
    await shot(`9-width-${width}`)
  }
})
