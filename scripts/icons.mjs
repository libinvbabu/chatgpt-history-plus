// Renders the extension icon at each size with Playwright's Chromium.
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

const out = resolve(import.meta.dirname, '../public/icons')
await mkdir(out, { recursive: true })

// The panel's clock-with-arrow glyph (20-unit grid), scaled onto a 128 tile.
const s = (v) => (v * 4.4 + 20).toFixed(2)
const d = (v) => (v * 4.4).toFixed(2)
const glyph = `M${s(3.4)} ${s(7.2)}A${d(7)} ${d(7)} 0 1 1 ${s(3)} ${s(10)}M${s(3)} ${s(4)}v${d(3.4)}h${d(3.4)}M${s(10)} ${s(6.4)}V${s(10)}l${d(2.4)} ${d(1.6)}`

// Chrome Web Store guidance: the 128px icon is 96px of artwork with 16px of
// transparent padding on each side. Smaller sizes use the full canvas.
const svg = (size, stroke) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${size === 128 ? '-21.33 -21.33 170.67 170.67' : '0 0 128 128'}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5b7cf2"/><stop offset="1" stop-color="#2d4bbf"/></linearGradient></defs>
  <rect x="2" y="2" width="124" height="124" rx="30" fill="url(#g)"/>
  <path d="${glyph}" fill="none" stroke="#fff" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`

const browser = await chromium.launch()
const page = await browser.newPage()
for (const [size, stroke] of [[16, 13], [32, 11], [48, 10], [128, 9]]) {
  await page.setViewportSize({ width: size, height: size })
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(size, stroke)}</body></html>`)
  await page.locator('svg').screenshot({ path: resolve(out, `icon-${size}.png`), omitBackground: true })
}
await browser.close()
console.log('icons written to public/icons')
