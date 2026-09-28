// Stored data is validated on read. Anything unrecognisable is discarded
// rather than trusted: a dropped cache costs one re-sync, a corrupt one
// could break the UI.

import { DEFAULT_SETTINGS, type HistoryIndex, type Settings, type StoredConversation } from '../history/types'

export const CURRENT_SCHEMA_VERSION = 1

export function migrateIndex(raw: unknown, accountKey: string): HistoryIndex | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (r.schemaVersion !== CURRENT_SCHEMA_VERSION) return null // Future versions: migrate step by step here.
  if (r.accountKey !== accountKey || !r.conversations || typeof r.conversations !== 'object') return null

  const conversations: Record<string, StoredConversation> = {}
  for (const [id, c] of Object.entries(r.conversations as Record<string, unknown>)) {
    if (!c || typeof c !== 'object') continue
    const v = c as Record<string, unknown>
    if (v.id !== id || typeof v.title !== 'string') continue
    conversations[id] = {
      id,
      title: v.title,
      createdAt: num(v.createdAt),
      updatedAt: num(v.updatedAt),
      cachedAt: num(v.cachedAt) ?? 0,
      ...(v.archived === true ? { archived: true } : {}),
      ...(typeof v.gizmoId === 'string' ? { gizmoId: v.gizmoId } : {}),
    }
  }
  return {
    schemaVersion: 1,
    accountKey,
    lastIncrementalSyncAt: num(r.lastIncrementalSyncAt),
    lastFullSyncAt: num(r.lastFullSyncAt),
    backfillComplete: r.backfillComplete === true,
    backfillOffset: num(r.backfillOffset) ?? 0,
    totalReported: num(r.totalReported),
    conversations,
  }
}

export function migrateSettings(raw: unknown): Settings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Settings, unknown>>
  return {
    timestampMode: r.timestampMode === 'created' ? 'created' : DEFAULT_SETTINGS.timestampMode,
    dateFormat: r.dateFormat === 'absolute' ? 'absolute' : DEFAULT_SETTINGS.dateFormat,
    grouping: r.grouping === 'month' ? 'month' : DEFAULT_SETTINGS.grouping,
    showNativeDates: typeof r.showNativeDates === 'boolean' ? r.showNativeDates : DEFAULT_SETTINGS.showNativeDates,
  }
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
