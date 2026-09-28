import { describe, expect, it } from 'vitest'
import page1 from '../fixtures/conversations-page-1.json'
import page2 from '../fixtures/conversations-page-2.json'
import missingDate from '../fixtures/conversation-missing-date.json'
import nullTitle from '../fixtures/conversation-null-title.json'
import session from '../fixtures/session.json'
import loggedOut from '../fixtures/session-logged-out.json'
import { parseConversationPage, parseSession } from '../../src/chatgpt/schemas'
import { ProviderError } from '../../src/history/provider'

describe('conversation page parsing', () => {
  it('parses mixed ISO and numeric timestamps', () => {
    const p = parseConversationPage(page1)
    expect(p.total).toBe(5)
    expect(p.rawCount).toBe(3)
    expect(p.items.map((i) => i.title)).toEqual(['Investigate sync failure', 'Duplicate debit query', 'Mobile game ideas'])
    expect(p.items[0]!.createdAt).toBe(Date.UTC(2026, 8, 28, 4, 55, 12, 123))
    expect(p.items[1]!.updatedAt).toBe(1790494920123)
    expect(p.items[2]!.archived).toBe(true)
    expect(p.stats.createFormats).toEqual({ iso: 2, number: 1 })
    expect(p.stats.projectLike).toBe(1)
    expect(p.stats.withGizmo).toBe(2)
    expect(p.stats.itemKeys).toContain('safe_urls')
    expect(p.stats.hasMissingConversations).toBe(false)
  })
  it('parses a second page', () => {
    const p = parseConversationPage(page2)
    expect(p.items).toHaveLength(2)
    expect(p.items[0]!.createdAt).toBe(Date.UTC(2025, 11, 14, 4, 30))
  })
  it('keeps conversations with missing or malformed dates', () => {
    const p = parseConversationPage(missingDate)
    expect(p.malformed).toBe(0)
    expect(p.items.map((i) => [i.createdAt, i.updatedAt])).toEqual([[null, null], [null, null], [1788000000000, null]])
    expect(p.stats.createFormats).toEqual({ missing: 1, invalid: 1, number: 1 })
  })
  it('drops items without a safe id, keeps null titles', () => {
    const p = parseConversationPage(nullTitle)
    expect(p.rawCount).toBe(6)
    expect(p.malformed).toBe(4)
    expect(p.items.map((i) => i.title)).toEqual(['', ''])
  })
  it('flags a changed response shape', () => {
    for (const bad of [null, [], { conversations: [] }, { items: 'nope' }]) {
      expect(() => parseConversationPage(bad)).toThrowError(ProviderError)
    }
    try {
      parseConversationPage({ data: [] })
    } catch (e) {
      expect((e as ProviderError).status).toBe('schema-changed')
    }
  })
})

describe('session parsing', () => {
  it('extracts the token, user and account', () => {
    expect(parseSession(session)).toEqual({
      accessToken: 'fake.jwt.token',
      userId: 'user-FAKE000000000000000000',
      account: { id: '00000000-0000-4000-8000-000000000000', structure: 'personal' },
    })
  })
  it('reports a signed-out session as auth-failed', () => {
    expect(() => parseSession(loggedOut)).toThrowError(expect.objectContaining({ status: 'auth-failed' }))
  })
})
