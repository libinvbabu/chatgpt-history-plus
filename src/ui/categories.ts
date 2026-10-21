// One definition of "category" for the whole UI: the filter chips under the
// search box and the small icon beside every conversation read from this table.
//
// The extractor (src/related) assigns one of ten fine-grained categories. The
// chips group them into eight, so every conversation is reachable from some
// chip. A category inherits its label and icon from the chip it belongs to,
// unless it has its own (debugging keeps a bug, security a shield): the row
// then says something more specific than the chip. To add a category, add it to
// src/related/dictionary.ts and one row to CATEGORIES below.

import { categoryFor } from '../related/extract'
import type { CategoryId } from '../related/dictionary'

/** Names of the glyphs in CategoryIcon.tsx. */
export type IconName = 'grid' | 'git-pull-request' | 'code' | 'chart' | 'lightbulb' | 'credit-card' | 'pen' | 'message' | 'bug' | 'users' | 'shield'

export type CategoryFilterId = 'pr-reviews' | 'engineering' | 'analytics' | 'product' | 'payments' | 'writing' | 'other'
export type FilterId = 'all' | CategoryFilterId

export interface FilterDef {
  id: FilterId
  label: string
  icon: IconName
}

/** Left to right, as shown. "All" first, "Other" last: the catch-all for anything unrecognised. */
export const FILTERS: readonly FilterDef[] = [
  { id: 'all', label: 'All', icon: 'grid' },
  { id: 'pr-reviews', label: 'Reviews', icon: 'git-pull-request' },
  { id: 'engineering', label: 'Engineering', icon: 'code' },
  { id: 'analytics', label: 'Analytics', icon: 'chart' },
  { id: 'product', label: 'Product', icon: 'lightbulb' },
  { id: 'payments', label: 'Payments', icon: 'credit-card' },
  { id: 'writing', label: 'Writing', icon: 'pen' },
  { id: 'other', label: 'Other', icon: 'message' },
]

const FILTER_BY_ID = new Map(FILTERS.map((f) => [f.id, f]))

export const filterDef = (id: FilterId): FilterDef => FILTER_BY_ID.get(id)!

export const isFilterId = (v: unknown): v is FilterId => typeof v === 'string' && FILTER_BY_ID.has(v as FilterId) // a Map: no prototype keys to trip over

interface CategoryEntry {
  /** The chip this category is listed under. */
  filter: CategoryFilterId
  /** Own label and icon, where the row should say more than the chip does. */
  label?: string
  icon?: IconName
}

const CATEGORIES: Record<CategoryId, CategoryEntry> = {
  'code-review': { filter: 'pr-reviews' },
  engineering: { filter: 'engineering' },
  debugging: { filter: 'engineering', label: 'Debugging', icon: 'bug' },
  security: { filter: 'engineering', label: 'Security & access', icon: 'shield' },
  analytics: { filter: 'analytics' },
  product: { filter: 'product' },
  payments: { filter: 'payments' },
  writing: { filter: 'writing' },
  people: { filter: 'other', label: 'Hiring & people', icon: 'users' },
  general: { filter: 'other' },
}

export interface CategoryDisplay {
  filter: CategoryFilterId
  label: string
  icon: IconName
}

/** What to show for a category. Anything unknown is "Other". */
export function categoryDisplay(category: string | null | undefined): CategoryDisplay {
  const entry = category && Object.hasOwn(CATEGORIES, category) ? CATEGORIES[category as CategoryId] : CATEGORIES.general
  const chip = filterDef(entry.filter)
  return { filter: entry.filter, label: entry.label ?? chip.label, icon: entry.icon ?? chip.icon }
}

/** The chip a conversation is listed under, from its stored category or else its title. */
export const filterFor = (conv: { title: string; category?: string | null }): CategoryFilterId => categoryDisplay(categoryFor(conv)).filter
