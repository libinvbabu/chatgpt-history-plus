// Generates Chrome Web Store assets from the real extension running against
// the mock ChatGPT with synthetic "showcase" data. Run: npm run store-assets
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, openPanel, panel, search, test, waitForSync } from './fixtures'

test.skip(!process.env.STORE_ASSETS, 'set STORE_ASSETS=1 (npm run store-assets)')
test.setTimeout(120_000)

const out = (name: string) => resolve(import.meta.dirname, '../../store', name)

test('screenshots (1280x800)', async ({ page, server }) => {
  server.useShowcase()
  await page.setViewportSize({ width: 1280, height: 800 })
  const recent = server.byTitle('Plan the product launch checklist')
  await page.goto(`https://chatgpt.com/c/${recent.id}`)
  await openPanel(page)
  await waitForSync(page, 650)
  await page.mouse.move(1000, 700)
  await page.screenshot({ path: out('screenshot-1-timeline.png') })

  await search(page).fill('roadmap')
  await page.waitForTimeout(150)
  await page.screenshot({ path: out('screenshot-2-search.png') })

  await search(page).fill('roadmap last month')
  await page.waitForTimeout(150)
  await page.screenshot({ path: out('screenshot-3-dates.png') })

  await search(page).fill('')
  await page.evaluate(() => document.documentElement.classList.replace('light', 'dark'))
  await panel(page).getByRole('button', { name: 'All dates' }).click()
  await page.waitForTimeout(200)
  await page.screenshot({ path: out('screenshot-4-dark.png') })
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(panel(page)).toBeHidden()

  // Close-up of ChatGPT's own sidebar with History+ added.
  await page.evaluate(() => document.documentElement.classList.replace('dark', 'light'))
  await page.evaluate(() => {
    ;(document.documentElement.style as CSSStyleDeclaration & { zoom: string }).zoom = '1.6'
    // The chat is offset for the open panel; recentre it for this shot.
    document.querySelector<HTMLElement>('.thread')!.style.padding = '0 48px'
  })
  await page.waitForTimeout(400)
  await page.locator('[data-chp-entry]').hover()
  await page.screenshot({ path: out('screenshot-5-sidebar.png') })
})

test('promo tiles', async ({ page }) => {
  const icon = (await readFile(resolve(import.meta.dirname, '../../public/icons/icon-128.png'))).toString('base64')
  const shot = (await readFile(out('screenshot-1-timeline.png'))).toString('base64')
  const base = `*{box-sizing:border-box;margin:0}body{font-family:ui-sans-serif,-apple-system,system-ui,'Segoe UI',Helvetica,Arial,sans-serif;color:#fff;
    background:radial-gradient(120% 140% at 0% 0%,#6b89f5 0%,#3e63dd 45%,#2a44ad 100%);overflow:hidden}
    .name{font-weight:700;letter-spacing:-.02em}.plus{color:#c9d5ff}.tag{opacity:.92}`

  await page.setViewportSize({ width: 440, height: 280 })
  await page.setContent(`<style>${base}
    body{width:440px;height:280px;display:flex;flex-direction:column;justify-content:center;padding:0 40px;gap:14px}
    img{width:76px;height:76px;margin:-10px 0 0 -10px}.name{font-size:40px;line-height:1}.tag{font-size:19px;line-height:1.35;max-width:330px}
  </style><img src="data:image/png;base64,${icon}"><div class="name">History<span class="plus">+</span></div><div class="tag">Find any ChatGPT conversation by when it happened.</div>`)
  await page.screenshot({ path: out('promo-small-440x280.png') })

  await page.setViewportSize({ width: 1400, height: 560 })
  await page.setContent(`<style>${base}
    body{width:1400px;height:560px;display:flex;align-items:center;padding:0 80px;gap:64px}
    .copy{flex:1;display:flex;flex-direction:column;gap:18px}img.icon{width:96px;height:96px;margin:-12px 0 0 -12px}
    .name{font-size:64px;line-height:1}.tag{font-size:26px;line-height:1.35;max-width:560px}
    .points{display:flex;flex-direction:column;gap:8px;font-size:18px;opacity:.92;margin-top:6px}
    .frame{flex:none;width:672px;height:420px;border-radius:18px;overflow:hidden;box-shadow:0 30px 80px rgba(10,20,70,.45);background:#fff}
    .frame img{width:1280px;transform:scale(.525);transform-origin:0 0}
  </style><div class="copy"><img class="icon" src="data:image/png;base64,${icon}"><div class="name">History<span class="plus">+</span></div>
    <div class="tag">Your ChatGPT timeline. Browse by date, search instantly, and jump back into any conversation.</div>
    <div class="points"><span>🕘 Dates on every chat</span><span>⚡ Instant local search</span><span>🔒 Stays on your device</span></div></div>
    <div class="frame"><img src="data:image/png;base64,${shot}"></div>`)
  await page.screenshot({ path: out('promo-marquee-1400x560.png') })
})
