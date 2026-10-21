// An original, license-free music bed for the promo, synthesised from code:
// a calm Cmaj7 – Am7 – Fmaj7 – G6 loop (warm pad, soft keys arpeggio, round
// bass, light kick and shaker), with a little reverb. The tempo is fitted so
// the last G6 resolves to Cmaj7 exactly when the end card arrives, which then
// rings out. Deterministic: same lengths in, same file out.

import { writeFile } from 'node:fs/promises'

const RATE = 48000
const TAU = Math.PI * 2
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12)

function mulberry32(seed) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const CHORDS = [
  { name: 'Cmaj7', bass: 36, pad: [55, 59, 64, 67], keys: [72, 76, 79, 83] },
  { name: 'Am7', bass: 45, pad: [55, 60, 64, 69], keys: [69, 72, 76, 79] },
  { name: 'Fmaj7', bass: 41, pad: [53, 57, 60, 64], keys: [69, 72, 76, 77] },
  { name: 'G6', bass: 43, pad: [55, 59, 62, 64], keys: [67, 71, 74, 76] },
]
/** Eighth-note arpeggio over a bar: indices into `keys`, -1 = rest. */
const ARP = [0, 2, 1, 3, -1, 2, 1, -1]

/**
 * @param {{ path: string, length: number, endAt: number }} o
 *   `length`: total seconds. `endAt`: when the end card arrives (the resolution).
 */
export async function renderMusic({ path, length, endAt }) {
  const n = Math.ceil(length * RATE)
  const dryL = new Float32Array(n)
  const dryR = new Float32Array(n)
  const sendL = new Float32Array(n)
  const sendR = new Float32Array(n)
  const rand = mulberry32(7)

  const bars = Math.max(4, Math.round(endAt / 2.5)) // ~96 BPM
  const bar = endAt / bars
  const beat = bar / 4
  // Bar `bars - 1` is G6, so the end card lands on Cmaj7.
  const chordAt = (i) => CHORDS[(((i - bars + 4) % 4) + 4) % 4]

  const add = (t0, dur, gainL, gainR, send, fn) => {
    const a = Math.max(0, Math.floor(t0 * RATE))
    const b = Math.min(n, Math.ceil((t0 + dur) * RATE))
    for (let i = a; i < b; i++) {
      const v = fn(i / RATE - t0)
      dryL[i] += v * gainL
      dryR[i] += v * gainR
      sendL[i] += v * gainL * send
      sendR[i] += v * gainR * send
    }
  }

  // Pad: two slightly detuned additive voices per note, slow swell.
  const pad = (t0, dur, notes, level) => {
    for (const m of notes) {
      for (const [cents, pan] of [[-5, 0.3], [5, -0.3]]) {
        const f = hz(m) * 2 ** (cents / 1200)
        const phase = rand() * TAU
        const env = (t) => Math.min(1, t / 0.9) * Math.min(1, Math.max(0, (dur - t) / 1.4))
        add(t0, dur, level * (1 - pan) * 0.5, level * (1 + pan) * 0.5, 0.35, (t) => {
          let s = 0
          for (let k = 1; k <= 5; k++) s += Math.sin(TAU * f * k * t + phase * k) / k ** 1.6
          return s * env(t) * (1 + 0.08 * Math.sin(TAU * 0.23 * t))
        })
      }
    }
  }
  // Keys: soft electric-piano-ish pluck.
  const key = (t0, m, level, pan) => {
    const f = hz(m)
    add(t0, 1.6, level * (1 - pan) * 0.5, level * (1 + pan) * 0.5, 0.5, (t) => {
      const env = Math.min(1, t / 0.006) * Math.exp(-t / 0.42)
      return (Math.sin(TAU * f * t) + 0.3 * Math.sin(TAU * 2 * f * t) * Math.exp(-t / 0.15) + 0.08 * Math.sin(TAU * 3 * f * t)) * env
    })
  }
  const bass = (t0, m, level, dur = beat * 1.8) => {
    const f = hz(m)
    add(t0, dur + 0.3, level, level, 0.05, (t) => {
      const env = Math.min(1, t / 0.012) * Math.exp(-t / 0.7) * Math.min(1, Math.max(0, (dur + 0.3 - t) / 0.3))
      return (Math.sin(TAU * f * t) + 0.18 * Math.sin(TAU * 2 * f * t)) * env
    })
  }
  const kick = (t0, level) =>
    add(t0, 0.35, level, level, 0, (t) => {
      const f = 46 + 70 * Math.exp(-t / 0.03)
      return Math.sin(TAU * f * t) * Math.exp(-t / 0.16)
    })
  let prev = 0
  const shaker = (t0, level, pan) =>
    add(t0, 0.08, level * (1 - pan) * 0.5, level * (1 + pan) * 0.5, 0.15, (t) => {
      const w = rand() * 2 - 1
      const hp = w - prev // crude high-pass
      prev = w
      return hp * Math.exp(-t / 0.018)
    })

  for (let i = 0; i < bars; i++) {
    const t = i * bar
    const c = chordAt(i)
    pad(t, bar + 1.4, c.pad, 0.05)
    if (i >= 1) {
      bass(t, c.bass, 0.22)
      bass(t + beat * 2.5, c.bass, 0.14, beat * 1.3)
      ARP.forEach((k, j) => k >= 0 && key(t + j * (beat / 2), c.keys[k], j % 2 ? 0.055 : 0.07, j % 2 ? 0.3 : -0.3))
    }
    if (i >= 2) {
      kick(t, 0.26)
      kick(t + beat * 2, 0.2)
      for (let j = 0; j < 8; j++) shaker(t + j * (beat / 2), j % 2 ? 0.05 : 0.025, 0.4)
    }
  }
  // The resolution: Cmaj7 rings over the end card, with one rising arpeggio.
  const end = CHORDS[0]
  const tail = length - endAt
  pad(endAt, tail + 0.5, end.pad, 0.055)
  bass(endAt, end.bass, 0.22, Math.max(0.5, tail - 0.4))
  ;[...end.keys, 84].forEach((m, j) => key(endAt + j * (beat / 2), m, 0.07, j % 2 ? 0.3 : -0.3))

  // Schroeder reverb on the send bus.
  const reverb = (input, spread) => {
    const out = new Float32Array(n)
    for (const d of [1557, 1617, 1491, 1422].map((x) => Math.round(((x + spread) * RATE) / 44100))) {
      const buf = new Float32Array(d)
      let p = 0
      let lp = 0
      for (let i = 0; i < n; i++) {
        const y = buf[p]
        lp = y * 0.7 + lp * 0.3
        buf[p] = input[i] + lp * 0.8
        out[i] += y * 0.25
        p = (p + 1) % d
      }
    }
    for (const d of [556, 225]) {
      const buf = new Float32Array(d)
      let p = 0
      for (let i = 0; i < n; i++) {
        const b = buf[p]
        const y = -out[i] * 0.5 + b
        buf[p] = out[i] + b * 0.5
        out[i] = y
        p = (p + 1) % d
      }
    }
    return out
  }
  const wetL = reverb(sendL, 0)
  const wetR = reverb(sendR, 23)

  // Fades, normalise to -3 dBFS peak, 16-bit stereo WAV.
  const fadeIn = 1.2
  const fadeOut = Math.min(2.2, tail)
  let peak = 0
  const mixL = new Float32Array(n)
  const mixR = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / RATE
    const g = Math.min(1, t / fadeIn) * Math.min(1, Math.max(0, (length - t) / fadeOut))
    mixL[i] = (dryL[i] + wetL[i] * 0.45) * g
    mixR[i] = (dryR[i] + wetR[i] * 0.45) * g
    peak = Math.max(peak, Math.abs(mixL[i]), Math.abs(mixR[i]))
  }
  const gain = 0.708 / peak
  const buf = Buffer.alloc(44 + n * 4)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + n * 4, 4)
  buf.write('WAVEfmt ', 8)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(2, 22)
  buf.writeUInt32LE(RATE, 24)
  buf.writeUInt32LE(RATE * 4, 28)
  buf.writeUInt16LE(4, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(n * 4, 40)
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(mixL[i] * gain * 32767), 44 + i * 4)
    buf.writeInt16LE(Math.round(mixR[i] * gain * 32767), 46 + i * 4)
  }
  await writeFile(path, buf)
  return { bars, bpm: +(60 / beat).toFixed(1) }
}
