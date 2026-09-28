// The only thing the history engine knows about ChatGPT. Everything behind
// this interface lives in src/chatgpt/ and can change without touching sync,
// search or UI.

import type { TimestampFormat } from '../utils/time'
import type { ConversationMetadata, ProviderStatus } from './types'

export interface PageStats {
  itemKeys: string[]
  responseKeys: string[]
  createFormats: Partial<Record<TimestampFormat, number>>
  updateFormats: Partial<Record<TimestampFormat, number>>
  archived: number
  withGizmo: number
  projectLike: number
  hasMissingConversations: boolean | null
}

export interface ConversationPage {
  items: ConversationMetadata[]
  /** Items in the raw response, including malformed ones (they still consume an offset). */
  rawCount: number
  malformed: number
  total: number | null
  stats: PageStats
}

export interface ListParams {
  offset: number
  limit: number
  signal?: AbortSignal
}

/** An authenticated session. Holds credentials in memory only; drop it when done. */
export interface ProviderSession {
  /** Opaque, stable key for the signed-in user + workspace. Never the raw user id. */
  accountKey: string
  list(params: ListParams): Promise<ConversationPage>
}

export interface ConversationProvider {
  connect(signal?: AbortSignal): Promise<ProviderSession>
}

export class ProviderError extends Error {
  constructor(
    readonly status: Exclude<ProviderStatus, 'available'>,
    message: string,
    readonly httpStatus?: number,
    /** For rate limits: how long the server asked us to wait, if it said. */
    readonly retryAfterMs: number | null = null,
  ) {
    super(message)
    this.name = 'ProviderError'
  }
}

export function isAbortError(e: unknown): boolean {
  return e instanceof DOMException ? e.name === 'AbortError' : (e as { name?: string } | null)?.name === 'AbortError'
}
