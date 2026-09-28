// Thin async key-value interface over chrome.storage.local, so everything
// above it can be tested with the in-memory implementation.

export interface KeyValueStore {
  get<T = unknown>(key: string): Promise<T | undefined>
  set(values: Record<string, unknown>): Promise<void>
  remove(keys: string | string[]): Promise<void>
  keys(): Promise<string[]>
  onChanged(listener: (changes: Record<string, { newValue?: unknown }>) => void): () => void
}

export const KEYS = {
  settings: 'settings',
  ui: 'ui',
  restore: 'restore',
  diagnostics: 'diagnostics',
  pacing: 'pacing',
  index: (accountKey: string) => `idx:${accountKey}`,
} as const

export function chromeStore(area: chrome.storage.StorageArea = chrome.storage.local): KeyValueStore {
  return {
    async get<T>(key: string) {
      const out = await area.get(key)
      return out[key] as T | undefined
    },
    set: (values) => area.set(values),
    remove: (keys) => area.remove(keys),
    async keys() {
      return Object.keys(await area.get(null))
    },
    onChanged(listener) {
      const fn = (changes: Record<string, chrome.storage.StorageChange>, name: string) => {
        if (name === 'local') listener(changes)
      }
      chrome.storage.onChanged.addListener(fn)
      return () => chrome.storage.onChanged.removeListener(fn)
    },
  }
}

export function memoryStore(initial: Record<string, unknown> = {}): KeyValueStore & { data: Map<string, unknown> } {
  const data = new Map(Object.entries(structuredClone(initial)))
  const listeners = new Set<(c: Record<string, { newValue?: unknown }>) => void>()
  const emit = (c: Record<string, { newValue?: unknown }>) => listeners.forEach((l) => l(c))
  return {
    data,
    async get<T>(key: string) {
      const v = data.get(key)
      return v === undefined ? undefined : (structuredClone(v) as T)
    },
    async set(values) {
      const changes: Record<string, { newValue?: unknown }> = {}
      for (const [k, v] of Object.entries(values)) {
        data.set(k, structuredClone(v))
        changes[k] = { newValue: structuredClone(v) }
      }
      emit(changes)
    },
    async remove(keys) {
      const changes: Record<string, { newValue?: unknown }> = {}
      for (const k of Array.isArray(keys) ? keys : [keys]) {
        data.delete(k)
        changes[k] = {}
      }
      emit(changes)
    },
    async keys() {
      return [...data.keys()]
    },
    onChanged(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
