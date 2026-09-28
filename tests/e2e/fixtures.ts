import { test as base, chromium, type BrowserContext, type Page, type Worker } from '@playwright/test'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { MockChatGPT, SESSION } from './mock-chatgpt'

const EXTENSION = resolve(import.meta.dirname, '../../dist')

export const test = base.extend<{ server: MockChatGPT; context: BrowserContext; page: Page; worker: Worker; errors: string[] }>({
  server: async ({}, use) => {
    await use(new MockChatGPT())
  },
  context: async ({ server }, use) => {
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: !process.env.HEADED,
      viewport: { width: 1280, height: 820 },
      args: [`--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
    })
    await context.route('https://chatgpt.com/**', (route) => server.handle(route))
    await use(context)
    await context.close()
  },
  worker: async ({ context }, use) => {
    const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
    await use(sw)
  },
  errors: async ({}, use) => {
    await use([])
  },
  page: async ({ context, errors }, use) => {
    const page = context.pages()[0] ?? (await context.newPage())
    page.on('pageerror', (e) => errors.push(e.message))
    page.on('console', (m) => {
      if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text())
    })
    await use(page)
  },
})

export const expect = test.expect

export function accountKey(): string {
  return createHash('sha256').update(`${SESSION.user.id}|personal`).digest('hex').slice(0, 32)
}

/** The History+ panel inside its shadow root (Playwright's CSS pierces open shadow roots). */
export const panel = (page: Page) => page.locator('#chatgpt-history-plus-root .panel')
export const search = (page: Page) => panel(page).getByRole('combobox')
export const rows = (page: Page) => panel(page).locator('.conv')

export async function openPanel(page: Page) {
  await page.locator('[data-chp-entry]').getByRole('button').click()
  await expect(panel(page)).toBeVisible()
}

export async function waitForSync(page: Page, total: number) {
  await expect(panel(page).locator('.count')).toHaveText(total.toLocaleString('en-US'), { timeout: 30_000 })
  await expect(panel(page).locator('.footer .synced')).toContainText('Synced')
}
