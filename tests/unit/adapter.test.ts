import { describe, expect, it } from 'vitest'
import page1 from '../fixtures/conversations-page-1.json'
import session from '../fixtures/session.json'
import { accountKeyFor, createChatGPTProvider, parseCookies } from '../../src/chatgpt/adapter'

function fakeFetch(routes: Record<string, () => unknown>, log: Array<{ url: string; headers: Record<string, string> }>) {
  return (async (url: string, init?: RequestInit) => {
    log.push({ url, headers: (init?.headers ?? {}) as Record<string, string> })
    const path = new URL(url).pathname
    const body = routes[path]?.()
    return body === undefined ? new Response('', { status: 404 }) : new Response(JSON.stringify(body), { status: 200 })
  }) as unknown as typeof fetch
}

describe('ChatGPT provider', () => {
  it('authenticates via the session endpoint and lists conversations', async () => {
    const log: Array<{ url: string; headers: Record<string, string> }> = []
    const provider = createChatGPTProvider({
      origin: 'https://chatgpt.com',
      fetch: fakeFetch({ '/api/auth/session': () => session, '/backend-api/conversations': () => page1 }, log),
      cookies: () => 'oai-did=device-123; other=1',
      language: 'en-US',
    })
    const s = await provider.connect()
    expect(s.accountKey).toMatch(/^[0-9a-f]{32}$/)
    expect(s.accountKey).not.toContain('FAKE')
    const page = await s.list({ offset: 100, limit: 100 })
    expect(page.items).toHaveLength(3)
    const req = log[1]!
    expect(req.url).toBe('https://chatgpt.com/backend-api/conversations?offset=100&limit=100&order=updated')
    expect(req.headers.authorization).toBe('Bearer fake.jwt.token')
    expect(req.headers['oai-device-id']).toBe('device-123')
    expect(req.headers['chatgpt-account-id']).toBeUndefined() // personal account
  })

  it('selects the workspace for Team/Business sessions and keys the cache by it', async () => {
    const ws = { ...session, account: { id: '11111111-2222-4333-8444-555555555555', structure: 'workspace' } }
    const log: Array<{ url: string; headers: Record<string, string> }> = []
    const provider = createChatGPTProvider({
      origin: 'https://chatgpt.com',
      fetch: fakeFetch({ '/api/auth/session': () => ws, '/backend-api/conversations': () => page1 }, log),
      cookies: () => '',
    })
    const s = await provider.connect()
    await s.list({ offset: 0, limit: 100 })
    expect(log[1]!.headers['chatgpt-account-id']).toBe('11111111-2222-4333-8444-555555555555')
    expect(s.accountKey).toBe(await accountKeyFor('user-FAKE000000000000000000', '11111111-2222-4333-8444-555555555555'))
    expect(s.accountKey).not.toBe(await accountKeyFor('user-FAKE000000000000000000', null))
  })

  it('refreshes an expired token once', async () => {
    let listCalls = 0
    const log: Array<{ url: string; headers: Record<string, string> }> = []
    const fetch = (async (url: string, init?: RequestInit) => {
      log.push({ url, headers: (init?.headers ?? {}) as Record<string, string> })
      if (url.includes('/api/auth/session')) return new Response(JSON.stringify(session))
      return ++listCalls === 1 ? new Response('', { status: 401 }) : new Response(JSON.stringify(page1))
    }) as unknown as typeof globalThis.fetch
    const s = await createChatGPTProvider({ origin: 'https://chatgpt.com', fetch, cookies: () => '' }).connect()
    await expect(s.list({ offset: 0, limit: 100 })).resolves.toMatchObject({ rawCount: 3 })
    expect(log.map((l) => new URL(l.url).pathname)).toEqual(['/api/auth/session', '/backend-api/conversations', '/api/auth/session', '/backend-api/conversations'])
  })

  it('reports a signed-out user', async () => {
    const provider = createChatGPTProvider({ origin: 'https://chatgpt.com', fetch: fakeFetch({ '/api/auth/session': () => ({}) }, []), cookies: () => '' })
    await expect(provider.connect()).rejects.toMatchObject({ status: 'auth-failed' })
  })
})

describe('parseCookies', () => {
  it('parses and decodes', () => {
    expect(parseCookies('a=1; b=hello%20world; bad; =x')).toEqual({ a: '1', b: 'hello world' })
  })
})
