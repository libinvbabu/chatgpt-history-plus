import { KEYS, type KeyValueStore } from '../storage'
import { migrateIndex } from '../storage/migrations'
import type { ConversationMetadata, HistoryIndex, StoredConversation } from './types'

/** True when the cache already holds this exact version of the conversation. */
export function isUnchanged(cached: StoredConversation | undefined, incoming: ConversationMetadata): boolean {
  return (
    !!cached &&
    cached.title === incoming.title &&
    cached.updatedAt === incoming.updatedAt &&
    cached.createdAt === incoming.createdAt &&
    !!cached.archived === !!incoming.archived
  )
}

export interface MergeResult {
  added: number
  changed: number
}

export function mergeItems(index: HistoryIndex, items: readonly ConversationMetadata[], now: number): MergeResult {
  let added = 0
  let changed = 0
  for (const item of items) {
    const cached = index.conversations[item.id]
    if (isUnchanged(cached, item)) continue
    if (cached) changed++
    else added++
    const next: StoredConversation = {
      id: item.id,
      title: item.title,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      cachedAt: now,
    }
    if (item.archived) next.archived = true
    if (item.gizmoId) next.gizmoId = item.gizmoId
    index.conversations[item.id] = next
  }
  return { added, changed }
}

/** Removes conversations not seen during a complete pass (deleted upstream). */
export function sweepUnseen(index: HistoryIndex, seen: ReadonlySet<string>): number {
  let removed = 0
  for (const id of Object.keys(index.conversations)) {
    if (!seen.has(id)) {
      delete index.conversations[id]
      removed++
    }
  }
  return removed
}

/** Random per-tab id, so a tab can ignore storage change events it caused itself. */
export const WRITER_ID = Math.random().toString(36).slice(2)

export interface StoredIndex extends HistoryIndex {
  writer?: string
}

export class MetadataRepository {
  constructor(private readonly kv: KeyValueStore) {}

  async load(accountKey: string): Promise<HistoryIndex | null> {
    return migrateIndex(await this.kv.get(KEYS.index(accountKey)), accountKey)
  }

  async save(index: HistoryIndex): Promise<void> {
    const value: StoredIndex = { ...index, writer: WRITER_ID }
    await this.kv.set({ [KEYS.index(index.accountKey)]: value })
  }

  async clearAll(): Promise<void> {
    await this.kv.remove(await this.kv.keys())
  }
}
