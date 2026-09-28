import { describe, expect, it, vi } from 'vitest'
import { backoffDelay, parseRetryAfter, requestJson } from '../../src/chatgpt/api'

const json = (status: number, body: unknown = {}, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

function setup(responses: Array<Response | Error>) {
  const fetch = vi.fn(async () => {
    const r = responses.shift()!
    if (r instanceof Error) throw r
    return r
  })
  const sleeps: number[] = []
  const sleep = vi.fn(async (ms: number) => void sleeps.push(ms))
  return { fetch: fetch as unknown as typeof globalThis.fetch, sleep, sleeps, calls: fetch }
}

describe('requestJson', () => {
  it('surfaces 429 immediately with Retry-After, without retrying', async () => {
    const s = setup([json(429, {}, { 'retry-after': '2' }), json(200, { ok: 1 })])
    await expect(requestJson('u', {}, { ...s, random: () => 0.5 })).rejects.toMatchObject({ status: 'rate-limited', httpStatus: 429, retryAfterMs: 2000 })
    expect(s.calls).toHaveBeenCalledTimes(1)
    expect(s.sleep).not.toHaveBeenCalled()
  })
  it('backs off exponentially on 5xx and network errors', async () => {
    const s = setup([json(502), new TypeError('offline'), json(503), json(200, [])])
    await requestJson('u', {}, { ...s, random: () => 0.5 })
    expect(s.sleeps).toEqual([1000, 2000, 4000])
  })
  it('gives up with network-error after the retry ceiling', async () => {
    const s = setup(Array.from({ length: 5 }, () => json(503)))
    await expect(requestJson('u', {}, { ...s, random: () => 0.5 })).rejects.toMatchObject({ status: 'network-error', httpStatus: 503 })
    expect(s.calls).toHaveBeenCalledTimes(5)
  })
  it('classifies auth and schema failures without retrying', async () => {
    let s = setup([json(401)])
    await expect(requestJson('u', {}, s)).rejects.toMatchObject({ status: 'auth-failed' })
    s = setup([json(404)])
    await expect(requestJson('u', {}, s)).rejects.toMatchObject({ status: 'schema-changed' })
    s = setup([new Response('<html>', { status: 200 })])
    await expect(requestJson('u', {}, s)).rejects.toMatchObject({ status: 'schema-changed' })
    expect(s.sleep).not.toHaveBeenCalled()
  })
  it('does not retry aborted requests', async () => {
    const s = setup([new DOMException('Aborted', 'AbortError')])
    await expect(requestJson('u', {}, s)).rejects.toMatchObject({ name: 'AbortError' })
  })
})

describe('backoff helpers', () => {
  it('caps delays', () => {
    expect(backoffDelay(10, () => 0.5)).toBe(30_000)
    expect(parseRetryAfter('120')).toBe(120_000)
    expect(parseRetryAfter('86400')).toBe(15 * 60_000)
    expect(parseRetryAfter('garbage')).toBeNull()
    expect(parseRetryAfter(new Date(Date.now() + 5000).toUTCString())).toBeGreaterThan(3000)
  })
})
