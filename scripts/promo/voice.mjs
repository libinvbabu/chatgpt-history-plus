// Generates the 16:9 voice-over with Kokoro (82M, Apache-2.0), locally, from
// narration.json. Writes one WAV per line plus voice.json (durations) to
// .promo/voice/, which the recorder uses for pacing and the build for mixing.
//
// kokoro-js and its ONNX runtime are ~400 MB, so they are installed on demand
// into .promo/tools (gitignored) rather than as a dev dependency every CI run
// would download. The model (~330 MB) is cached in .promo/models.

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const ROOT = resolve(import.meta.dirname, '../..')
const TOOLS = resolve(ROOT, '.promo/tools')
const OUT = resolve(ROOT, '.promo/voice')
const KOKORO_JS = '1.2.1'
const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX'

const pkg = resolve(TOOLS, 'node_modules/kokoro-js/package.json')
if (!existsSync(pkg) || JSON.parse(await readFile(pkg, 'utf8')).version !== KOKORO_JS) {
  console.log(`installing kokoro-js@${KOKORO_JS} into .promo/tools`)
  await mkdir(TOOLS, { recursive: true })
  const r = spawnSync('npm', ['install', '--prefix', TOOLS, '--no-audit', '--no-fund', `kokoro-js@${KOKORO_JS}`], { stdio: 'inherit' })
  if (r.status !== 0) throw new Error('npm install kokoro-js failed')
}
const req = createRequire(resolve(TOOLS, 'package.json'))
// Both resolve to their CommonJS builds (one shared transformers instance); exports sit under `default`.
const load = async (id) => {
  const m = await import(pathToFileURL(req.resolve(id)).href)
  return m.default ?? m
}
const { KokoroTTS } = await load('kokoro-js')
const { env } = await load('@huggingface/transformers')
env.cacheDir = resolve(ROOT, '.promo/models')

const narration = JSON.parse(await readFile(resolve(import.meta.dirname, 'narration.json'), 'utf8'))
const tts = await KokoroTTS.from_pretrained(MODEL, { dtype: 'fp32', device: 'cpu' })

/** Mono float → 16-bit PCM WAV. */
function wav(samples, rate) {
  const buf = Buffer.alloc(44 + samples.length * 2)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + samples.length * 2, 4)
  buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(samples.length * 2, 40)
  samples.forEach((s, i) => buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), 44 + i * 2))
  return buf
}

/** Trim silence at both ends (keeping a short tail) and peak-normalise to -3 dBFS. */
function tidy(samples, rate) {
  const loud = (s) => Math.abs(s) > 0.01
  let a = samples.findIndex(loud)
  let b = samples.findLastIndex(loud)
  if (a < 0) return samples
  a = Math.max(0, a - Math.round(rate * 0.02))
  b = Math.min(samples.length, b + Math.round(rate * 0.12))
  const out = samples.slice(a, b)
  const peak = out.reduce((m, s) => Math.max(m, Math.abs(s)), 0)
  const gain = 0.708 / peak
  return out.map((s) => s * gain)
}

await rm(OUT, { recursive: true, force: true })
await mkdir(OUT, { recursive: true })
const lines = []
for (const line of narration.lines) {
  // generate(), not stream(): kokoro-js 1.2.1's stream() never settles for a plain string.
  const audio = await tts.generate(line.say, { voice: narration.voice, speed: narration.speed })
  const rate = audio.sampling_rate
  const samples = tidy(audio.audio, rate)
  const file = resolve(OUT, `${line.id}.wav`)
  await writeFile(file, wav(samples, rate))
  const duration = +(samples.length / rate).toFixed(3)
  lines.push({ ...line, file, duration })
  console.log(`${line.id.padEnd(9)} ${duration.toFixed(2)}s  ${line.say}`)
}
await writeFile(resolve(OUT, 'voice.json'), JSON.stringify({ voice: narration.voice, model: MODEL, lines }, null, 1))
