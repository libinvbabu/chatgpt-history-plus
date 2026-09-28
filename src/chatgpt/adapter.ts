// ChatGPT implementation of ConversationProvider.
//
// Runs in the content script's isolated world. Requests are same-origin to
// chatgpt.com, so the browser attaches the user's cookies; the short-lived
// access token from /api/auth/session is held in a closure for the length of
// one sync and never written anywhere.

import type { ConversationProvider, ProviderSession } from '../history/provider'
import { ProviderError } from '../history/provider'
import { ENDPOINTS, abortableSleep, requestJson, type HttpOptions } from './api'
import { parseConversationPage, parseSession, type ParsedSession } from './schemas'

export interface ChatGPTProviderOptions {
  origin?: string
  fetch?: typeof fetch
  sleep?: HttpOptions['sleep']
  cookies?: () => string
  language?: string
  random?: () => number
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function createChatGPTProvider(options: ChatGPTProviderOptions = {}): ConversationProvider {
  const origin = options.origin ?? location.origin
  const http: HttpOptions = {
    fetch: options.fetch ?? ((...args) => fetch(...args)),
    sleep: options.sleep ?? abortableSleep,
    random: options.random,
  }
  const readCookies = options.cookies ?? (() => document.cookie)
  const language = options.language ?? (typeof navigator !== 'undefined' ? navigator.language : 'en-US')

  async function fetchSession(signal?: AbortSignal): Promise<ParsedSession> {
    // Fewer retries than page fetches: this gates the UI, so fail fast.
    const raw = await requestJson(`${origin}${ENDPOINTS.session}`, { signal, headers: { accept: 'application/json' } }, { ...http, maxRetries: 2 })
    return parseSession(raw)
  }

  return {
    async connect(signal) {
      let session = await fetchSession(signal)
      const cookies = parseCookies(readCookies())
      const workspaceId = pickWorkspaceId(session, cookies)
      const deviceId = cookies['oai-did']
      const accountKey = await accountKeyFor(session.userId, workspaceId)

      const headers = (): Record<string, string> => ({
        accept: 'application/json',
        authorization: `Bearer ${session.accessToken}`,
        'oai-language': language,
        ...(workspaceId ? { 'chatgpt-account-id': workspaceId } : {}),
        ...(deviceId ? { 'oai-device-id': deviceId } : {}),
      })

      const result: ProviderSession = {
        accountKey,
        async list({ offset, limit, signal: s }) {
          const url = `${origin}${ENDPOINTS.conversations}?offset=${offset}&limit=${limit}&order=updated`
          try {
            return parseConversationPage(await requestJson(url, { signal: s, headers: headers() }, http))
          } catch (e) {
            // Access tokens are short-lived; refresh once and retry the page.
            if (!(e instanceof ProviderError) || e.status !== 'auth-failed') throw e
            const fresh = await fetchSession(s)
            if (fresh.userId !== session.userId) throw e
            session = fresh
            return parseConversationPage(await requestJson(url, { signal: s, headers: headers() }, http))
          }
        },
      }
      return result
    },
  }
}

export function parseCookies(cookieHeader: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of cookieHeader.split(';')) {
    const i = part.indexOf('=')
    const k = i > 0 ? part.slice(0, i).trim() : ''
    if (!k) continue
    try {
      out[k] = decodeURIComponent(part.slice(i + 1).trim())
    } catch {
      out[k] = part.slice(i + 1).trim()
    }
  }
  return out
}

/** Team/Business workspaces are selected with a ChatGPT-Account-Id header. */
export function pickWorkspaceId(session: ParsedSession, cookies: Record<string, string>): string | null {
  if (session.account?.structure === 'workspace' && session.account.id) return session.account.id
  const cookie = cookies['_account']
  return cookie && UUID.test(cookie) ? cookie : null
}

/** SHA-256 of user + workspace, so storage keys never contain the raw user id. */
export async function accountKeyFor(userId: string, workspaceId: string | null): Promise<string> {
  const bytes = new TextEncoder().encode(`${userId}|${workspaceId ?? 'personal'}`)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return [...digest.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
