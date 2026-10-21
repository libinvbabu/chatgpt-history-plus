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
  it('keeps an explicit category through a save and reload', async () => {
    const repo = new MetadataRepository(memoryStore())
    const index = emptyIndex('k')
    mergeItems(index, [{ id: 'a', title: 'Review Paytm PR', createdAt: 1, updatedAt: 2, category: 'writing' }], 99)
    await repo.save(index)
    expect((await repo.load('k'))!.conversations.a!.category).toBe('writing')
    // A later sync (which never carries a category) does not wipe it.
    mergeItems(index, [{ id: 'a', title: 'Review Paytm PR (renamed)', createdAt: 1, updatedAt: 3 }], 100)
    expect(index.conversations.a!.category).toBe('writing')
    expect(migrateIndex({ schemaVersion: 1, accountKey: 'k', conversations: { b: { id: 'b', title: 't', category: 42 } } }, 'k')!.conversations.b!.category).toBeUndefined()
  })
  it('fills settings defaults', () => {
    expect(migrateSettings(undefined)).toEqual(DEFAULT_SETTINGS)
    expect(migrateSettings({ timestampMode: 'created', grouping: 'nonsense' })).toEqual({ ...DEFAULT_SETTINGS, timestampMode: 'created' })
  })
  it('defaults to 12-hour time and only accepts the two known clock styles', () => {
    expect(DEFAULT_SETTINGS.timeFormat).toBe('12h')
    expect(migrateSettings({ timeFormat: '24h' }).timeFormat).toBe('24h')
    expect(migrateSettings({ timeFormat: '12h' }).timeFormat).toBe('12h')
    expect(migrateSettings({ timeFormat: 'military' }).timeFormat).toBe('12h')
    // Settings saved before this option existed pick up the default.
    expect(migrateSettings({ timestampMode: 'created', dateFormat: 'absolute' }).timeFormat).toBe('12h')
  })
  it('clears everything', async () => {
    const kv = memoryStore({ settings: {}, 'idx:k': {}, ui: {} })
    await new MetadataRepository(kv).clearAll()
    expect(await kv.keys()).toEqual([])
  })
})
