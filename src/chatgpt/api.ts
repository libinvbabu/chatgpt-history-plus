// HTTP for the undocumented ChatGPT web API: endpoints, retries, backoff and
// error classification. Nothing outside src/chatgpt/ should know these paths.

import { ProviderError, isAbortError } from '../history/provider'

export const ENDPOINTS = {
  session: '/api/auth/session',
  conversations: '/backend-api/conversations',
} as const

export const PAGE_SIZE = 100

export interface HttpOptions {
  fetch: typeof fetch
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>
  maxRetries?: number
  random?: () => number
}

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    const t = setTimeout(done, ms)
    function done() {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }
    function onAbort() {
      clearTimeout(t)
      reject(signal!.reason ?? new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function backoffDelay(attempt: number, random = Math.random): number {
  return Math.min(30_000, 1000 * 2 ** attempt) * (0.75 + random() * 0.5)
}

export function parseRetryAfter(header: string | null, now = Date.now()): number | null {
  if (!header) return null
  const secs = Number(header)
  const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(header) - now
  return Number.isFinite(ms) && ms >= 0 ? Math.min(ms, 15 * 60_000) : null
}

/**
 * GET a JSON resource, retrying 5xx/network failures with short exponential
 * backoff. 429s are not retried here: they surface immediately (with any
 * Retry-After) so the sync engine can slow down and wait properly, instead of
 * hammering an endpoint ChatGPT's own UI also depends on.
 */
export async function requestJson(url: string, init: RequestInit, opts: HttpOptions): Promise<unknown> {
  const max = opts.maxRetries ?? 4
  const signal = init.signal ?? undefined
  for (let attempt = 0; ; attempt++) {
    let res: Response
    try {
      res = await opts.fetch(url, { ...init, method: 'GET', credentials: 'include', cache: 'no-store' })
    } catch (e) {
      if (isAbortError(e) || signal?.aborted) throw e
      if (attempt >= max) throw new ProviderError('network-error', 'Could not reach ChatGPT')
      await opts.sleep(backoffDelay(attempt, opts.random), signal)
      continue
    }

    if (res.ok) {
      try {
        return await res.json()
      } catch (e) {
        if (isAbortError(e)) throw e
        throw new ProviderError('schema-changed', 'ChatGPT returned a non-JSON response', res.status)
      }
    }
    if (res.status === 401 || res.status === 403) {
      throw new ProviderError('auth-failed', 'ChatGPT rejected the session', res.status)
    }
    if (res.status === 429) {
      throw new ProviderError('rate-limited', 'ChatGPT is rate limiting requests', 429, parseRetryAfter(res.headers.get('retry-after')))
    }
    if (res.status >= 500) {
      if (attempt >= max) throw new ProviderError('network-error', `ChatGPT responded ${res.status}`, res.status)
      await opts.sleep(backoffDelay(attempt, opts.random), signal)
      continue
    }
    // 404/400/etc: the endpoint or its parameters changed.
    throw new ProviderError('schema-changed', `ChatGPT responded ${res.status}`, res.status)
  }
}
