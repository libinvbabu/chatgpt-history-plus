// One definition of "category" for the whole UI: the filter bar under the
// search box, its More menu, and the small icon beside every conversation read
// from this table.
//
// The classifier (src/related/classify.ts) gives each conversation a primary
// category and, when the title is clear, a subcategory. A filter is either: a
// primary shows every conversation filed under it; a subcategory shows the
// ones filed under that part of it. Every conversation has a primary, so every
// conversation is reachable from some filter.
//
// Icons: each primary has its own; a subcategory has one when its glyph says
// more than its primary's (a bug for Debugging, a plane for Travel). A row
// shows its subcategory's icon when there is one, else its primary's.

import { categoryFor, isCategoryNodeId, knownCategory, migrateCategoryId, parentOf, type Classification } from '../related/classify'
import { PRIMARY_IDS, PRIMARY_LABELS, SUBCATEGORIES, type PrimaryId } from '../related/taxonomy'

/** Names of the glyphs in CategoryIcon.tsx. */
export type IconName =
  | 'grid'
  | 'briefcase'
  | 'graduation-cap'
  | 'pen-line'
  | 'palette'
  | 'code'
  | 'calendar-check'
  | 'heart'
  | 'message'
  | 'git-pull-request'
  | 'bug'
  | 'shield'
  | 'chart'
  | 'lightbulb'
  | 'credit-card'
  | 'users'
  | 'plane'
  | 'utensils'
  | 'heart-pulse'
  | 'shopping-cart'
  | 'wallet'
  | 'calculator'
  | 'flask'
  | 'mail'
  | 'image'
  | 'presentation'
  | 'sparkles'

/** A primary or subcategory id. */
export type CategoryNodeId = string
export type FilterId = 'all' | CategoryNodeId

export interface FilterDef {
  id: FilterId
  label: string
  icon: IconName
  /** The primary a subcategory belongs to; null for a primary and for All. */
  parent: PrimaryId | null
}

const PRIMARY_ICONS: Record<PrimaryId, IconName> = {
  work: 'briefcase',
  learning: 'graduation-cap',
  writing: 'pen-line',
  creative: 'palette',
  technology: 'code',
  planning: 'calendar-check',
  personal: 'heart',
  general: 'message',
}

/** Subcategories whose glyph says more than their primary's. The rest borrow the primary's. */
const SUB_ICONS: Record<string, IconName> = {
  'pr-reviews': 'git-pull-request',
  debugging: 'bug',
  security: 'shield',
  ai: 'sparkles',
  hiring: 'users',
  product: 'lightbulb',
  analytics: 'chart',
  payments: 'credit-card',
  presentations: 'presentation',
  mathematics: 'calculator',
  science: 'flask',
  emails: 'mail',
  'image-generation': 'image',
  travel: 'plane',
  cooking: 'utensils',
  health: 'heart-pulse',
  shopping: 'shopping-cart',
  finance: 'wallet',
}

export const ALL_FILTER: FilterDef = { id: 'all', label: 'All', icon: 'grid', parent: null }

/** Every filter except All, grouped: each primary followed by its subcategories, primaries in taxonomy order (General last). */
export const CATEGORY_FILTERS: readonly FilterDef[] = PRIMARY_IDS.flatMap((p) => [
  { id: p, label: PRIMARY_LABELS[p], icon: PRIMARY_ICONS[p], parent: null } satisfies FilterDef,
  ...SUBCATEGORIES.filter((s) => s.parent === p).map((s): FilterDef => ({ id: s.id, label: s.label, icon: SUB_ICONS[s.id] ?? PRIMARY_ICONS[p], parent: p })),
])

const FILTER_BY_ID = new Map<string, FilterDef>([[ALL_FILTER.id, ALL_FILTER], ...CATEGORY_FILTERS.map((f) => [f.id, f] as const)])

export const filterDef = (id: FilterId): FilterDef => FILTER_BY_ID.get(id) ?? ALL_FILTER

export const isFilterId = (v: unknown): v is FilterId => v === 'all' || isCategoryNodeId(v)

/** A remembered filter from any version: current ids pass, legacy ids map ("engineering" → Technology), anything else is All. */
export const migrateFilterId = (v: unknown): FilterId => (v === 'all' ? 'all' : (migrateCategoryId(v) ?? 'all'))

export const isPrimaryFilter = (id: FilterId): id is PrimaryId => id !== 'all' && parentOf(id) === id

/** Whether a conversation with this classification shows under a filter. */
export const matchesFilter = (c: Classification, id: FilterId): boolean => id === 'all' || c.primary === id || c.sub === id

export interface CategoryDisplay {
  primary: PrimaryId
  sub: string | null
  /** Hover text: "Technology · Debugging", or just "Technology". */
  label: string
  icon: IconName
}

const displays = new Map<string, CategoryDisplay>()

/** What to show beside a conversation. */
export function categoryDisplay(c: Classification): CategoryDisplay {
  const key = `${c.primary}/${c.sub ?? ''}`
  let d = displays.get(key)
  if (!d) {
    const sub = c.sub ? filterDef(c.sub) : null
    d = { primary: c.primary, sub: c.sub, label: sub ? `${PRIMARY_LABELS[c.primary]} · ${sub.label}` : PRIMARY_LABELS[c.primary], icon: sub?.icon ?? PRIMARY_ICONS[c.primary] }
    displays.set(key, d)
  }
  return d
}

/** A conversation's classification, from its stored category or else its title. */
export const classificationOf = (conv: { title: string; category?: string | null }): Classification => categoryFor(conv)

/**
 * The same, but only if already known; null while the app's background pass has
 * not reached the title yet. The list reads this, so rendering never classifies
 * a whole history in one task (the pass bumps `classifiedRev` when it is done).
 */
export const knownClassificationOf = (conv: { title: string; category?: string | null }): Classification | null => knownCategory(conv)

/**
 * What the More menu lists: every primary; a subcategory once the history has
 * any, or when it is pinned, hidden or selected. With a query, every filter
 * whose name (or whose primary's name) contains it.
 */
export function menuItems(historyCounts: ReadonlyMap<string, number>, keep: ReadonlySet<string>, query = ''): FilterDef[] {
  const q = query.trim().toLowerCase()
  return CATEGORY_FILTERS.filter((f) => {
    if (q) return f.label.toLowerCase().includes(q) || (f.parent !== null && PRIMARY_LABELS[f.parent].toLowerCase().includes(q))
    return !f.parent || (historyCounts.get(f.id) ?? 0) > 0 || keep.has(f.id)
  })
}
