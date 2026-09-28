// Runtime validation of undocumented ChatGPT web API responses. Only `id` is
// strictly required per item; anything else that has changed shape degrades
// to null instead of dropping the conversation.

import * as z from 'zod/mini'
import { ProviderError, type ConversationPage, type PageStats } from '../history/provider'
import type { ConversationMetadata } from '../history/types'
import { parseTimestamp, timestampFormat } from '../utils/time'

// zod/mini: same validation as full zod, but tree-shakeable (~60 KB smaller bundle).
/** Missing, null, or wrong-typed all degrade to null. */
const lenient = <T extends z.ZodMiniType>(schema: T) => z.catch(z.nullish(schema), null)
const NonEmpty = z.string().check(z.minLength(1))

/** Conversation ids are interpolated into URLs, so keep them to a safe alphabet. */
export const ConversationIdSchema = z.string().check(z.regex(/^[A-Za-z0-9_-]{1,128}$/))

const Timestamp = lenient(z.union([z.number(), z.string()]))

export const RawConversationSchema = z.object({
  id: ConversationIdSchema,
  title: lenient(z.string()),
  create_time: Timestamp,
  update_time: Timestamp,
  is_archived: lenient(z.boolean()),
  gizmo_id: lenient(z.string()),
})

export const ConversationPageSchema = z.object({
  items: z.array(z.unknown()),
  total: lenient(z.int().check(z.gte(0))),
  limit: lenient(z.number()),
  offset: lenient(z.number()),
  has_missing_conversations: lenient(z.boolean()),
})

export const SessionSchema = z.object({
  accessToken: lenient(NonEmpty),
  user: lenient(z.object({ id: NonEmpty })),
  account: lenient(z.object({ id: lenient(z.string()), structure: lenient(z.string()) })),
})

export interface ParsedSession {
  accessToken: string
  userId: string
  account: { id: string | null; structure: string | null } | null
}

export function parseSession(raw: unknown): ParsedSession {
  const r = SessionSchema.safeParse(raw)
  if (!r.success) throw new ProviderError('schema-changed', 'Unrecognised session response')
  const { accessToken, user, account } = r.data
  // A signed-out session is a successful response with no token/user.
  if (!accessToken || !user) throw new ProviderError('auth-failed', 'No active ChatGPT session')
  return { accessToken, userId: user.id, account: account ? { id: account.id ?? null, structure: account.structure ?? null } : null }
}

export function parseConversation(raw: unknown): ConversationMetadata | null {
  const r = RawConversationSchema.safeParse(raw)
  if (!r.success) return null
  const c = r.data
  return {
    id: c.id,
    title: (c.title ?? '').trim(),
    createdAt: parseTimestamp(c.create_time),
    updatedAt: parseTimestamp(c.update_time),
    ...(c.is_archived ? { archived: true } : {}),
    ...(c.gizmo_id ? { gizmoId: c.gizmo_id } : {}),
  }
}

export function parseConversationPage(raw: unknown): ConversationPage {
  const r = ConversationPageSchema.safeParse(raw)
  if (!r.success) throw new ProviderError('schema-changed', 'Conversation list response has an unexpected shape')
  const page = r.data
  const items: ConversationMetadata[] = []
  const stats: PageStats = {
    itemKeys: [],
    responseKeys: raw && typeof raw === 'object' ? Object.keys(raw).sort() : [],
    createFormats: {},
    updateFormats: {},
    archived: 0,
    withGizmo: 0,
    projectLike: 0,
    hasMissingConversations: page.has_missing_conversations ?? null,
  }
  const keys = new Set<string>()
  let malformed = 0
  for (const rawItem of page.items) {
    if (rawItem && typeof rawItem === 'object') {
      for (const k of Object.keys(rawItem)) keys.add(k)
      const o = rawItem as Record<string, unknown>
      const cf = timestampFormat(o.create_time)
      const uf = timestampFormat(o.update_time)
      stats.createFormats[cf] = (stats.createFormats[cf] ?? 0) + 1
      stats.updateFormats[uf] = (stats.updateFormats[uf] ?? 0) + 1
    }
    const item = parseConversation(rawItem)
    if (!item) {
      malformed++
      continue
    }
    if (item.archived) stats.archived++
    if (item.gizmoId) {
      stats.withGizmo++
      if (item.gizmoId.startsWith('g-p-')) stats.projectLike++
    }
    items.push(item)
  }
  stats.itemKeys = [...keys].sort()
  return { items, rawCount: page.items.length, malformed, total: page.total ?? null, stats }
}
