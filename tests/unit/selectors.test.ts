import { describe, expect, it } from 'vitest'
import { CONVERSATION_HREF, conversationIdFromPath } from '../../src/chatgpt/selectors'

describe('conversation hrefs', () => {
  it('extracts ids from plain, project and GPT conversation paths', () => {
    expect(conversationIdFromPath('/c/6f1a9c2e-0001-4a7b-9c1d-000000000001')).toBe('6f1a9c2e-0001-4a7b-9c1d-000000000001')
    expect(conversationIdFromPath('/g/g-p-abc123-project/c/abc-123')).toBe('abc-123')
    expect(conversationIdFromPath('/c/abc-123?model=x')).toBe('abc-123')
    expect(conversationIdFromPath('/')).toBeNull()
    expect(conversationIdFromPath('/codex')).toBeNull()
    expect(CONVERSATION_HREF.exec('/c/../../x')).toBeNull()
  })
})
