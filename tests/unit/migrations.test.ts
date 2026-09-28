import { describe, expect, it } from 'vitest'
import { MetadataRepository, mergeItems } from '../../src/history/repository'
import { DEFAULT_SETTINGS, emptyIndex } from '../../src/history/types'
import { memoryStore } from '../../src/storage'
import { migrateIndex, migrateSettings } from '../../src/storage/migrations'

describe('stored data validation', () => {
  it('round-trips an index through the repository', async () => {
    const repo = new MetadataRepository(memoryStore())
    const index = emptyIndex('k')
    mergeItems(index, [{ id: 'a', title: 'A', createdAt: 1, updatedAt: 2, archived: true }], 99)
    await repo.save(index)
    expect(await repo.load('k')).toEqual(index)
    expect(await repo.load('other')).toBeNull()
  })
  it('discards unknown schema versions and corrupt entries', () => {
    expect(migrateIndex({ schemaVersion: 2, accountKey: 'k', conversations: {} }, 'k')).toBeNull()
    expect(migrateIndex('garbage', 'k')).toBeNull()
    const idx = migrateIndex({ schemaVersion: 1, accountKey: 'k', conversations: { a: { id: 'a', title: 'ok', createdAt: 'x' }, b: { id: 'zzz', title: 'mismatch' }, c: null } }, 'k')!
    expect(Object.keys(idx.conversations)).toEqual(['a'])
    expect(idx.conversations.a!.createdAt).toBeNull()
  })
  it('fills settings defaults', () => {
    expect(migrateSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(migrateSettings({ timestampMode: 'created', grouping: 'nonsense' })).toEqual({ ...DEFAULT_SETTINGS, timestampMode: 'created' })
  })
  it('clears everything', async () => {
    const kv = memoryStore({ settings: {}, 'idx:k': {}, ui: {} })
    await new MetadataRepository(kv).clearAll()
    expect(await kv.keys()).toEqual([])
  })
})
