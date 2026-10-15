// Hook: the related conversations for the chat that is open in ChatGPT.

import { useMemo } from 'react'
import { pageConversationTitle } from '../chatgpt/selectors'
import type { HistoryApp } from '../content/app'
import type { AppState } from '../content/store'
import { RELATED_MAX, type RelatedEntry } from '../history/related-rows'
import { effectiveTime } from '../history/types'

/**
 * Recomputed when the open chat changes (including back/forward and client-side
 * navigation, which both update `currentId`), when the related index changes
 * (`relatedRev`: a sync added or retitled chats), or when the timestamp mode
 * changes. The engine caches by chat and index version, so this is cheap, and
 * nothing here runs while a reply streams: streaming changes neither input.
 */
export function useRelated(app: HistoryApp, state: AppState): RelatedEntry[] {
  const { index, currentId, relatedRev, indexRev, settings } = state
  const mode = settings.timestampMode
  const known = !!(index && currentId && index.conversations[currentId])
  return useMemo(() => {
    if (!index || !currentId) return []
    // A chat that has not synced yet is matched on the title the page shows.
    const activeTitle = index.conversations[currentId]?.title ?? pageConversationTitle() ?? undefined
    const out: RelatedEntry[] = []
    for (const r of app.related.related(currentId, { limit: RELATED_MAX, activeTitle })) {
      const conv = index.conversations[r.id]
      if (conv) out.push({ entry: { conv, ts: effectiveTime(conv, mode) }, reasons: r.reasons })
    }
    return out
    // `indexRev` only matters until the open chat is in the history, so a freshly synced title can be picked up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, index, currentId, relatedRev, mode, known ? 0 : indexRev])
}
