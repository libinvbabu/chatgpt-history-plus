export interface ConversationMetadata {
  id: string
  /** Empty string when ChatGPT has not generated a title. */
  title: string
  createdAt: number | null
  updatedAt: number | null
  archived?: boolean
  gizmoId?: string | null
}

export interface StoredConversation extends ConversationMetadata {
  cachedAt: number
}

export interface HistoryIndex {
  schemaVersion: 1
  accountKey: string
  lastIncrementalSyncAt: number | null
  lastFullSyncAt: number | null
  /** True once pagination has reached the end of history at least once. */
  backfillComplete: boolean
  /** Furthest offset reached while backfilling, for resuming an interrupted first sync. */
  backfillOffset: number
  /** Total conversation count as last reported by the API, if it reports one. */
  totalReported: number | null
  conversations: Record<string, StoredConversation>
}

export type TimestampMode = 'updated' | 'created'

export interface Settings {
  timestampMode: TimestampMode
  dateFormat: 'relative' | 'absolute'
  grouping: 'smart' | 'month'
  showNativeDates: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  timestampMode: 'updated',
  dateFormat: 'relative',
  grouping: 'smart',
  showNativeDates: true,
}

export type ProviderStatus = 'available' | 'auth-failed' | 'schema-changed' | 'rate-limited' | 'network-error'

/** The timestamp a conversation is sorted and grouped by, with a fallback to the other one. */
export function effectiveTime(c: ConversationMetadata, mode: TimestampMode): number | null {
  return mode === 'updated' ? (c.updatedAt ?? c.createdAt) : (c.createdAt ?? c.updatedAt)
}

export function emptyIndex(accountKey: string): HistoryIndex {
  return {
    schemaVersion: 1,
    accountKey,
    lastIncrementalSyncAt: null,
    lastFullSyncAt: null,
    backfillComplete: false,
    backfillOffset: 0,
    totalReported: null,
    conversations: {},
  }
}
