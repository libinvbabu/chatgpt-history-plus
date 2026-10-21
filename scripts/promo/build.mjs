// Turns the recording in .promo/recording into the promo videos and the
// YouTube thumbnail. Run `npm run promo:record` first, then `npm run promo:build`.
//
// The screen content is the recorded frames, untouched apart from scaling and
// cropping. Everything around it (browser frame, captions, end card,
// thumbnail) is HTML rendered to PNG by Playwright, so the type matches the
// panel, and composited with ffmpeg.

import { chromium } from '@playwright/test'
import ffmpegStatic from 'ffmpeg-static'
import { spawn } from 'node:child_process'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '../..')
const REC = resolve(ROOT, '.promo/recording')
const TMP = resolve(ROOT, '.promo/build')
const OUT = resolve(ROOT, 'marketing/promo')
/** The thumbnail is a store asset, committed beside the screenshots; the videos are not. */
const THUMBNAIL = resolve(ROOT, 'store/youtube-thumbnail.png')
const FFMPEG = process.env.FFMPEG_PATH || ffmpegStatic || 'ffmpeg'
const FPS = 30

const timeline = JSON.parse(await readFile(resolve(REC, 'timeline.json'), 'utf8'))
const { marks, frames, viewport, dpr } = timeline
const icon = `data:image/png;base64,${(await readFile(resolve(ROOT, 'public/icons/icon-128.png'))).toString('base64')}`
const still = `data:image/png;base64,${(await readFile(resolve(REC, 'still-search-panel.png'))).toString('base64')}`

// ---------------------------------------------------------------------------
// Layout

/** 16:9: the browser window on the left, captions in the column to its right. */
const WIDE = {
  w: 1920,
  h: 1080,
  win: { x: 56, y: 40, w: 1232, chrome: 78 },
  col: { x: 1352, w: 528 },
}
WIDE.content = { x: WIDE.win.x, y: WIDE.win.y + WIDE.win.chrome, w: WIDE.win.w, h: Math.round((WIDE.win.w * viewport.height) / viewport.width) }

/** 9:16: the left of the page (icon rail + History+ panel), cropped and enlarged into a card. */
const TALL = { w: 1080, h: 1920, card: { x: 40, y: 452, w: 1000 } }
TALL.crop = { x: 2, y: 0, w: 454 } // CSS px of the recording: the icon rail and the 380px panel
TALL.scale = TALL.card.w / TALL.crop.w
TALL.crop.h = 545
TALL.card.h = Math.round(TALL.crop.h * TALL.scale)

// ---------------------------------------------------------------------------
// Copy

const WIDE_CAPTIONS = [
  { from: 0.3, to: marks['hook:open'] + 0.2, title: 'Too many ChatGPT conversations?' },
  { from: marks['hook:open'] + 0.3, to: marks.search - 0.1, title: 'Find the right one in seconds.' },
  { from: marks.search, to: marks.category - 0.1, eyebrow: 'Search', title: 'Search your ChatGPT history instantly.', sub: 'Results narrow as you type. Search matches chat titles.' },
  { from: marks.category, to: marks.dates - 0.1, eyebrow: 'Filter', title: 'Organize by topic.', sub: 'Reviews, Engineering, Analytics, Payments and more, each with its own icon.' },
  { from: marks.dates, to: marks.related - 0.1, eyebrow: 'Browse', title: 'Jump back to any conversation.', sub: 'Today, Yesterday, last week, and every month before.' },
  { from: marks.related, to: marks.end, eyebrow: 'Rediscover', title: 'Pick up where you left off.', sub: 'Related chats appear for the one you’re in. All on your device.' },
]

/** The vertical cut ends once an older chat is open. */
const SOCIAL = { from: 0, to: marks['dates:opened'] + 1.4 }
const TALL_CAPTIONS = [
  { from: 0.3, to: marks.search - 0.1, title: 'Can’t find an old ChatGPT conversation?' },
  { from: marks.search, to: marks.category - 0.1, title: 'Search every chat by title, instantly.' },
  { from: marks.category, to: marks.dates - 0.1, title: 'Filter by topic.' },
  { from: marks.dates, to: SOCIAL.to, title: 'Browse by date.' },
]

const END_SECONDS = 3.6
const XFADE = 0.6

// ---------------------------------------------------------------------------
// Overlays (HTML → PNG)

const FONT = `-apple-system,BlinkMacSystemFont,'SF Pro Display','Segoe UI',system-ui,sans-serif`
const BASE_CSS = `*{box-sizing:border-box;margin:0;padding:0}html,body{background:transparent}body{font-family:${FONT};color:#fff;-webkit-font-smoothing:antialiased;overflow:hidden}
  .plus{color:#8da4ef}`
const BG = `radial-gradient(1000px 700px at 82% 18%,rgba(62,99,221,.28),transparent 70%),radial-gradient(900px 600px at 0% 100%,rgba(62,99,221,.16),transparent 70%),linear-gradient(180deg,#0d1020,#090b14)`
const BG_TALL = `radial-gradient(900px 900px at 50% 8%,rgba(62,99,221,.30),transparent 70%),radial-gradient(800px 700px at 50% 100%,rgba(62,99,221,.18),transparent 70%),linear-gradient(180deg,#0d1020,#090b14)`

/** An alpha mask that is opaque everywhere except a rounded-rect hole, where the recording shows through. */
function holeMask(w, h, x, y, hw, hh, r, topRadius = 0) {
  const t = topRadius
  const d = `M0 0H${w}V${h}H0Z M${x + t} ${y}H${x + hw - t}${t ? `A${t} ${t} 0 0 1 ${x + hw} ${y + t}` : ''}V${y + hh - r}A${r} ${r} 0 0 1 ${x + hw - r} ${y + hh}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + hh - r}V${y + t}${t ? `A${t} ${t} 0 0 1 ${x + t} ${y}` : ''}Z`
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><path fill-rule="evenodd" d="${d}"/></svg>`
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
}

const ICONS = {
  back: '<path d="M15 9H4m4-4L4 9l4 4"/>',
  fwd: '<path d="M3 9h11m-4-4 4 4-4 4"/>',
  reload: '<path d="M14.5 9A5.5 5.5 0 1 1 12.9 5.1M14.5 3v3.5H11"/>',
  tune: '<path d="M3 6h7m3 0h2M3 12h2m3 0h7"/><circle cx="11.5" cy="6" r="1.6"/><circle cx="6.5" cy="12" r="1.6"/>',
  puzzle: '<path d="M7 3.5a1.5 1.5 0 0 1 3 0V5h3v3h-1.5a1.5 1.5 0 0 0 0 3H13v3H4v-3h1.5a1.5 1.5 0 0 0 0-3H4V5h3z"/>',
}
const svgIcon = (name, size = 18, color = '#9aa0a6') =>
  `<svg width="${size}" height="${size}" viewBox="0 0 18 18" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`

function wideFrameHtml() {
  const { w, h, win, content, col } = WIDE
  const mask = holeMask(w, h, content.x, content.y, content.w, content.h, 12)
  return `<style>
    .stage{position:absolute;inset:0;background:${BG};-webkit-mask-image:${mask};mask-image:${mask}}
    .win{position:absolute;left:${win.x}px;top:${win.y}px;width:${win.w}px;height:${win.chrome + content.h}px;border-radius:12px;background:#202124;
      box-shadow:0 0 0 1px rgba(255,255,255,.09),0 30px 90px rgba(0,0,0,.6),0 8px 24px rgba(0,0,0,.35)}
    .tabs{height:38px;display:flex;align-items:flex-end;padding-left:14px;gap:8px}
    .lights{display:flex;gap:8px;align-self:center;margin-right:14px}.lights i{width:12px;height:12px;border-radius:50%;display:block}
    .tab{width:236px;height:31px;background:#35363a;border-radius:9px 9px 0 0;display:flex;align-items:center;gap:9px;padding:0 12px;font-size:12.5px;color:#e8eaed}
    .fav{width:15px;height:15px;border-radius:50%;border:1.6px solid #c4c7c5}.tab .x{margin-left:auto;color:#9aa0a6;font-size:14px}
    .newtab{color:#9aa0a6;font-size:20px;align-self:center;margin-left:4px}
    .bar{height:40px;background:#35363a;display:flex;align-items:center;gap:16px;padding:0 14px;border-bottom:1px solid #2a2b2e}
    .omni{flex:1;height:30px;border-radius:15px;background:#202124;display:flex;align-items:center;gap:10px;padding:0 14px;font-size:14px;color:#e8eaed;letter-spacing:.01em}
    .omni .path{color:#9aa0a6}
    .ext{display:flex;align-items:center;gap:14px}.ext img{width:20px;height:20px}.avatar{width:22px;height:22px;border-radius:50%;background:#5f6368}
    .brand{position:absolute;left:${col.x}px;bottom:58px;display:flex;align-items:center;gap:14px}
    .brand img{width:56px;height:56px;margin:-6px}
    .brand b{font-size:22px;font-weight:700;letter-spacing:-.01em;display:block}.brand span{font-size:16px;color:rgba(255,255,255,.62)}
  </style>
  <div class="stage">
    <div class="win">
      <div class="tabs"><div class="lights"><i style="background:#ff5f57"></i><i style="background:#febc2e"></i><i style="background:#28c840"></i></div>
        <div class="tab"><span class="fav"></span>ChatGPT<span class="x">×</span></div><span class="newtab">+</span></div>
      <div class="bar">${svgIcon('back')}${svgIcon('fwd')}${svgIcon('reload')}
        <div class="omni">${svgIcon('tune', 16, '#c4c7c5')}<span>chatgpt.com<span class="path">/c/…</span></span></div>
        <div class="ext"><img src="${icon}">${svgIcon('puzzle')}<span class="avatar"></span></div></div>
    </div>
    <div class="brand"><img src="${icon}"><div><b>History<span class="plus">+</span> for ChatGPT</b><span>Free on the Chrome Web Store</span></div></div>
  </div>`
}

function wideCaptionHtml({ eyebrow, title, sub }) {
  return `<style>
    .cap{width:${WIDE.col.w}px;padding-right:12px}
    .eb{font-size:17px;font-weight:650;letter-spacing:.16em;text-transform:uppercase;color:#8da4ef;margin-bottom:18px}
    h1{font-size:54px;line-height:1.08;font-weight:760;letter-spacing:-.025em;text-wrap:balance}
    p{margin-top:22px;font-size:24px;line-height:1.42;color:rgba(255,255,255,.68);text-wrap:pretty}
  </style><div class="cap">${eyebrow ? `<div class="eb">${eyebrow}</div>` : ''}<h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div>`
}

function tallFrameHtml() {
  const { w, h, card } = TALL
  const mask = holeMask(w, h, card.x, card.y, card.w, card.h, 28, 28)
  return `<style>
    .stage{position:absolute;inset:0;background:${BG_TALL};-webkit-mask-image:${mask};mask-image:${mask}}
    .ring{position:absolute;left:${card.x - 1}px;top:${card.y - 1}px;width:${card.w + 2}px;height:${card.h + 2}px;border-radius:29px;
      box-shadow:0 0 0 1.5px rgba(255,255,255,.12),0 40px 90px rgba(0,0,0,.6)}
    .brand{position:absolute;left:0;right:0;top:${card.y + card.h + 54}px;display:flex;flex-direction:column;align-items:center;gap:10px}
    .row{display:flex;align-items:center;gap:14px}.row img{width:64px;height:64px;margin:-8px}
    .row b{font-size:34px;font-weight:720;letter-spacing:-.015em}
    .brand span{font-size:24px;color:rgba(255,255,255,.66)}
  </style>
  <div class="stage"><div class="ring"></div>
    <div class="brand"><div class="row"><img src="${icon}"><b>History<span class="plus">+</span> for ChatGPT</b></div><span>Free on the Chrome Web Store</span></div>
  </div>`
}

function tallCaptionHtml({ title }) {
  return `<style>
    .cap{width:1000px;height:300px;display:flex;align-items:flex-end;justify-content:center;text-align:center}
    h1{font-size:68px;line-height:1.08;font-weight:780;letter-spacing:-.03em;text-wrap:balance}
  </style><div class="cap"><h1>${title}</h1></div>`
}

function endCardHtml(tall) {
  return `<style>
    .card{position:absolute;inset:0;background:${tall ? BG_TALL : BG};display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 60px}
    img{width:${tall ? 168 : 152}px;height:${tall ? 168 : 152}px;margin-bottom:${tall ? 18 : 10}px}
    .name{font-size:${tall ? 132 : 120}px;font-weight:800;letter-spacing:-.04em;line-height:1}
    .tag{margin-top:${tall ? 30 : 24}px;font-size:${tall ? 50 : 46}px;font-weight:600;letter-spacing:-.015em}
    .feats{margin-top:${tall ? 26 : 20}px;font-size:${tall ? 34 : 30}px;color:rgba(255,255,255,.62);letter-spacing:.02em}
    .feats i{font-style:normal;color:#8da4ef;margin:0 .5em}
    .cta{margin-top:${tall ? 70 : 54}px;display:inline-flex;align-items:center;gap:14px;background:#3e63dd;border-radius:999px;padding:${tall ? '26px 52px' : '22px 46px'};
      font-size:${tall ? 38 : 32}px;font-weight:700;box-shadow:0 18px 50px rgba(62,99,221,.45)}
    .small{margin-top:${tall ? 30 : 24}px;font-size:${tall ? 26 : 22}px;color:rgba(255,255,255,.55)}
  </style>
  <div class="card"><img src="${icon}"><div class="name">History<span class="plus">+</span></div>
    <div class="tag">Your ChatGPT history, organized.</div>
    <div class="feats">Search<i>•</i>Filter<i>•</i>Rediscover</div>
    <div class="cta">Install free on Chrome</div>
    <div class="small">Chrome Web Store · Open source on GitHub</div></div>`
}

function thumbnailHtml() {
  // The panel still is 2x; show its top part, large.
  return `<style>
    .bg{position:absolute;inset:0;background:radial-gradient(700px 520px at 78% 40%,rgba(62,99,221,.45),transparent 70%),linear-gradient(160deg,#10142a,#080a12)}
    .copy{position:absolute;left:64px;top:0;bottom:0;width:640px;display:flex;flex-direction:column;justify-content:center}
    .brand{display:flex;align-items:center;gap:12px;margin-bottom:28px}.brand img{width:76px;height:76px;margin:-10px}
    .brand b{font-size:34px;font-weight:760;letter-spacing:-.02em}
    h1{font-size:86px;line-height:1.0;font-weight:850;letter-spacing:-.04em}
    h1 em{font-style:normal;color:#9db1ff}
    .shot{position:absolute;right:56px;top:46px;width:500px;height:740px;border-radius:22px;overflow:hidden;background:#181818;
      box-shadow:0 0 0 2px rgba(255,255,255,.14),0 30px 80px rgba(0,0,0,.65)}
    .shot img{width:500px;display:block}
  </style>
  <div class="bg"></div>
  <div class="copy"><div class="brand"><img src="${icon}"><b>History<span class="plus">+</span></b></div>
    <h1>Find Old<br>ChatGPT Chats<br><em>Instantly</em></h1></div>
  <div class="shot"><img src="${still}"></div>`
}

async function renderPngs(jobs) {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 })
    for (const { width, height, html, path, opaque } of jobs) {
      await page.setViewportSize({ width, height })
      await page.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}</style></head><body style="width:${width}px;height:${height}px;position:relative">${html}</body></html>`)
      await page.evaluate(() => Promise.all([document.fonts.ready, ...[...document.images].map((i) => i.decode())]))
      await page.screenshot({ path, omitBackground: !opaque })
    }
  } finally {
    await browser.close()
  }
}

// ---------------------------------------------------------------------------
// ffmpeg

function run(args) {
  return new Promise((ok, fail) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'inherit', 'pipe'] })
    let err = ''
    p.stderr.on('data', (d) => (err += d))
    p.on('error', fail)
    p.on('close', (code) => (code === 0 ? ok() : fail(new Error(`ffmpeg exited ${code}\n${err}`))))
  })
}

/** An ffconcat list that holds each recorded frame until the next one, covering [from, to) seconds of the recording. */
async function frameList(name, from, to) {
  let i = frames.findLastIndex((f) => f.t <= from)
  if (i < 0) i = 0
  const lines = ['ffconcat version 1.0']
  let at = from
  for (; i < frames.length && at < to; i++) {
    const end = Math.min(frames[i + 1]?.t ?? Infinity, to)
    if (end > at) lines.push(`file '${resolve(REC, 'frames', frames[i].file)}'`, `duration ${(end - at).toFixed(5)}`)
    at = end
  }
  lines.push(lines.at(-2)) // the concat demuxer ignores the last entry's duration
  const path = resolve(TMP, `${name}.ffconcat`)
  await writeFile(path, `${lines.join('\n')}\n`)
  return path
}

/** Overlay captions (PNG inputs from index `first`) on `[label]`, each faded in and out over its own window. */
function captionChain(label, captions, first, x, y) {
  const parts = []
  let cur = label
  captions.forEach((c, k) => {
    const d = (c.to - c.from).toFixed(3)
    const fade = Math.min(0.35, (c.to - c.from) / 4)
    parts.push(
      `[${first + k}:v]format=rgba,fade=t=in:st=0:d=${fade}:alpha=1,fade=t=out:st=${(c.to - c.from - fade).toFixed(3)}:d=${fade}:alpha=1,setpts=PTS-STARTPTS+${c.from.toFixed(3)}/TB[cap${k}]`,
      `[${cur}][cap${k}]overlay=${x}:${y}:eof_action=pass:format=rgb[cv${k}]`,
    )
    cur = `cv${k}`
  })
  return { parts, out: cur }
}

const ENCODE = ['-c:v', 'libx264', '-preset', 'slow', '-crf', '16', '-pix_fmt', 'yuv420p', '-profile:v', 'high', '-r', `${FPS}`,
  '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
  '-c:a', 'aac', '-b:a', '96k', '-shortest', '-movflags', '+faststart']
const TO_YUV = `scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setsar=1`

async function renderVideo({ name, size, frameList: list, length, place, frame, captions, capPos, endCard }) {
  const inputs = ['-f', 'concat', '-safe', '0', '-i', list, '-loop', '1', '-framerate', `${FPS}`, '-t', `${length}`, '-i', frame]
  for (const c of captions) inputs.push('-loop', '1', '-framerate', `${FPS}`, '-t', `${(c.to - c.from).toFixed(3)}`, '-i', c.png)
  inputs.push('-loop', '1', '-framerate', `${FPS}`, '-t', `${END_SECONDS + XFADE}`, '-i', endCard)
  inputs.push('-f', 'lavfi', '-t', `${length + END_SECONDS}`, '-i', 'anullsrc=r=48000:cl=stereo')
  const endIdx = 2 + captions.length
  const graph = [
    `color=c=0x0a0c16:s=${size.w}x${size.h}:r=${FPS}:d=${length},format=rgba[base]`,
    `[0:v]fps=${FPS},${place},format=rgba[rec]`,
    `[base][rec]overlay=${size.recX}:${size.recY}:eof_action=repeat:format=rgb[v0]`,
    `[v0][1:v]overlay=0:0:format=rgb[v1]`,
  ]
  const chain = captionChain('v1', captions, 2, capPos.x, capPos.y)
  graph.push(...chain.parts)
  graph.push(`[${chain.out}]trim=duration=${length},${TO_YUV}[main]`)
  graph.push(`[${endIdx}:v]fps=${FPS},${TO_YUV}[end]`)
  graph.push(`[main][end]xfade=transition=fade:duration=${XFADE}:offset=${(length - XFADE).toFixed(3)},fade=t=in:st=0:d=0.4[out]`)
  const out = resolve(OUT, name)
  await run([...inputs, '-filter_complex', graph.join(';'), '-map', '[out]', '-map', `${endIdx + 1}:a`, ...ENCODE, out])
  return out
}

/** Duration, size, codec and frame rate, read back from the file. */
async function probe(path) {
  const info = await new Promise((ok) => {
    const p = spawn(FFMPEG, ['-hide_banner', '-i', path])
    let s = ''
    p.stderr.on('data', (d) => (s += d))
    p.on('close', () => ok(s))
  })
  const video = info.match(/Video: (\w+).*?, (\d+)x(\d+).*?, ([\d.]+) fps/)
  return { duration: info.match(/Duration: ([\d:.]+)/)?.[1], codec: video?.[1], size: video ? `${video[2]}x${video[3]}` : null, fps: video?.[4], mb: ((await stat(path)).size / 1e6).toFixed(1) }
}

// ---------------------------------------------------------------------------

await rm(TMP, { recursive: true, force: true })
await mkdir(TMP, { recursive: true })
await mkdir(OUT, { recursive: true })

const png = (name) => resolve(TMP, `${name}.png`)
const wideCaps = WIDE_CAPTIONS.map((c, i) => ({ ...c, png: png(`cap-wide-${i}`) }))
const tallCaps = TALL_CAPTIONS.map((c, i) => ({ ...c, png: png(`cap-tall-${i}`) }))
await renderPngs([
  { width: WIDE.w, height: WIDE.h, html: wideFrameHtml(), path: png('frame-wide') },
  { width: TALL.w, height: TALL.h, html: tallFrameHtml(), path: png('frame-tall') },
  { width: WIDE.w, height: WIDE.h, html: endCardHtml(false), path: png('end-wide'), opaque: true },
  { width: TALL.w, height: TALL.h, html: endCardHtml(true), path: png('end-tall'), opaque: true },
  ...wideCaps.map((c) => ({ width: WIDE.col.w, height: 460, html: wideCaptionHtml(c), path: c.png })),
  ...tallCaps.map((c) => ({ width: 1000, height: 300, html: tallCaptionHtml(c), path: c.png })),
  { width: 1280, height: 720, html: thumbnailHtml(), path: THUMBNAIL, opaque: true },
])
console.log('overlays rendered')

const wideLength = marks.end
const wide = await renderVideo({
  name: 'history-plus-demo.mp4',
  size: { w: WIDE.w, h: WIDE.h, recX: WIDE.content.x, recY: WIDE.content.y },
  frameList: await frameList('wide', 0, wideLength),
  length: wideLength,
  place: `scale=${WIDE.content.w}:${WIDE.content.h}:flags=lanczos`,
  frame: png('frame-wide'),
  captions: wideCaps,
  capPos: { x: WIDE.col.x, y: 300 },
  endCard: png('end-wide'),
})
console.log(wide, await probe(wide))

const c = TALL.crop
const socialLength = SOCIAL.to - SOCIAL.from
const tall = await renderVideo({
  name: 'history-plus-social.mp4',
  size: { w: TALL.w, h: TALL.h, recX: TALL.card.x, recY: TALL.card.y },
  frameList: await frameList('tall', SOCIAL.from, SOCIAL.to),
  length: socialLength,
  place: `crop=${c.w * dpr}:${c.h * dpr}:${c.x * dpr}:${c.y * dpr},scale=${TALL.card.w}:${TALL.card.h}:flags=lanczos`,
  frame: png('frame-tall'),
  captions: tallCaps.map((x) => ({ ...x, from: x.from - SOCIAL.from, to: x.to - SOCIAL.from })),
  capPos: { x: 40, y: 118 },
  endCard: png('end-tall'),
})
console.log(tall, await probe(tall))
console.log(THUMBNAIL)
