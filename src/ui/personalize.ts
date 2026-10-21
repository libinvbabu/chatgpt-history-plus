// Which category filters to show in the bar, chosen from the user's own
// history. Nobody is asked what they do: a student's history fills the bar with
// Learning and its subjects, a developer's with Technology and PR Reviews.
//
// Deterministic and deliberately simple:
//
//   1. Count conversations per primary and subcategory, counting only those the
//      classifier filed with at least `minConfidence`.
//   2. A filter is eligible with at least `minCount` conversations and
//      `minShare` of the history; a subcategory also needs a real part of its
//      primary (`subMinShareOfPrimary`), but not nearly all of it, which would
//      only repeat the primary. General is never chosen: it is in More.
//   3. The largest families (a primary and its subcategories) get a slot each,
//      up to `reservedFamilies`, so one dominant area cannot fill the bar.
//   4. Every other eligible filter follows by size, no family taking more than
//      `maxPerFamily` slots while another family has something eligible.
//   5. Ties go to taxonomy order. The bar shows the first `slots` of this list,
//      grouped by family (a primary, then its subcategories).
//
// The result is stored per account and only recomputed when the history has
// changed materially (`shouldRefresh`), and never while the panel is in use
// once the first full sync is done. When it is recomputed, filters already in
// the bar count `stickiness` times their size, so a near-tie does not swap
// them. Together these keep the bar from shuffling under the user.

import { CONFIDENCE_RANK, type Classification, type Confidence } from '../related/classify'
import { PRIMARY_IDS, SUBCATEGORIES } from '../related/taxonomy'

export const PERSONALIZE = {
  /** Filters shown between All and More, pinned ones included. */
  slots: 5,
  /** Only conversations classified at least this confidently count toward choosing filters. */
  minConfidence: 'medium' as Confidence,
  /** A filter needs this many confidently classified conversations… */
  minCount: 3,
  /** …and this share of them. */
  minShare: 0.05,
  /** How many of the largest families get a slot before any family gets a second. */
  reservedFamilies: 3,
  /** A family needs this share to reserve a slot; a smaller one competes by size for what is left. */
  reserveMinShare: 0.05,
  /** No family takes more than this many slots while another family has an eligible filter. */
  maxPerFamily: 3,
  /** A subcategory needs this many conversations… */
  subMinCount: 5,
  /** …at least this share of its primary… */
  subMinShareOfPrimary: 0.15,
  /** …and not nearly all of it. */
  subMaxShareOfPrimary: 0.9,
  /** Choose again once the history has grown or shrunk by at least this many conversations… */
  refreshMinDelta: 25,
  /** …and by this share of what the filters were last chosen from… */
  refreshMinRatio: 0.1,
  /** …or, while the first sync is still running, by this share (so the bar settles in a few steps). */
  provisionalRatio: 0.5,
  /** Filters already in the bar count this many times their size when choosing again. */
  stickiness: 1.2,
}

export type PersonalizeConfig = typeof PERSONALIZE

/** Bump when the algorithm or taxonomy changes, so stored choices are made again. */
export const PERSONALIZE_VERSION = 1

export interface Tally {
  /** Conversations counted (those at or above the confidence floor). */
  confident: number
  /** All conversations seen. */
  total: number
  /** Confident conversations per primary and subcategory id. */
  counts: Map<string, number>
}

export function tally(classifications: Iterable<Classification>, minConfidence: Confidence = PERSONALIZE.minConfidence): Tally {
  const floor = CONFIDENCE_RANK[minConfidence]
  const counts = new Map<string, number>()
  let confident = 0
  let total = 0
  for (const c of classifications) {
    total++
    if (CONFIDENCE_RANK[c.confidence] < floor) continue
    confident++
    counts.set(c.primary, (counts.get(c.primary) ?? 0) + 1)
    if (c.sub) counts.set(c.sub, (counts.get(c.sub) ?? 0) + 1)
  }
  return { confident, total, counts }
}

const SUB_PARENT = new Map(SUBCATEGORIES.map((s) => [s.id, s.parent] as const))
const ORDER = new Map<string, number>([...PRIMARY_IDS, ...SUBCATEGORIES.map((s) => s.id)].map((id, i) => [id, i]))
const familyOf = (id: string): string => SUB_PARENT.get(id) ?? id

/**
 * Every eligible filter, most useful first. The bar shows a prefix of it; hiding
 * one lets the next in. `previous` is the bar as it is now, which gets the
 * stickiness bonus.
 */
export function rankFilters(t: Tally, previous: readonly string[] = [], cfg: PersonalizeConfig = PERSONALIZE): string[] {
  const n = t.confident
  if (!n) return []
  const count = (id: string) => t.counts.get(id) ?? 0
  const shown = new Set(previous)
  const weight = (id: string) => count(id) * (shown.has(id) ? cfg.stickiness : 1)
  const bySize = (a: string, b: string) => weight(b) - weight(a) || ORDER.get(a)! - ORDER.get(b)!

  const primaries = PRIMARY_IDS.filter((p) => p !== 'general' && count(p) >= cfg.minCount && count(p) / n >= cfg.minShare).sort(bySize)
  const subs = SUBCATEGORIES.map((s) => s.id)
    .filter((id) => {
      const c = count(id)
      const share = c / Math.max(1, count(familyOf(id)))
      return c >= Math.max(cfg.minCount, cfg.subMinCount) && c / n >= cfg.minShare && share >= cfg.subMinShareOfPrimary && share <= cfg.subMaxShareOfPrimary
    })
    .sort(bySize)

  const ranked: string[] = []
  const perFamily = new Map<string, number>()
  const take = (id: string) => {
    ranked.push(id)
    perFamily.set(familyOf(id), (perFamily.get(familyOf(id)) ?? 0) + 1)
  }
  for (const p of primaries.slice(0, cfg.reservedFamilies)) if (count(p) / n >= cfg.reserveMinShare) take(p)

  const deferred: string[] = []
  for (const id of [...primaries.filter((p) => !ranked.includes(p)), ...subs].sort(bySize)) {
    if ((perFamily.get(familyOf(id)) ?? 0) < cfg.maxPerFamily) take(id)
    else deferred.push(id)
  }
  return [...ranked, ...deferred]
}

/** Display order for chosen filters: families in the order the ranking met them, each primary before its subcategories. */
export function arrange(ids: readonly string[], ranked: readonly string[]): string[] {
  const families: string[] = []
  for (const id of ranked) if (!families.includes(familyOf(id))) families.push(familyOf(id))
  const pos = (id: string) => {
    const f = families.indexOf(familyOf(id))
    return [f < 0 ? families.length : f, familyOf(id) === id ? -1 : ranked.indexOf(id)] as const
  }
  return [...ids].sort((a, b) => {
    const [fa, ia] = pos(a)
    const [fb, ib] = pos(b)
    return fa - fb || ia - ib || ORDER.get(a)! - ORDER.get(b)!
  })
}

export interface FilterPrefs {
  /** Always in the bar, in this order, first. Kept even when nothing matches them. */
  pinned: string[]
  /** Never chosen automatically (still in More). */
  hidden: string[]
  /** The ranking last chosen from the history (see rankFilters). */
  ranked: string[]
  /** How many conversations it was chosen from. */
  basis: number
  /** Whether that history was complete (first sync finished). */
  complete: boolean
  /** PERSONALIZE_VERSION it was chosen with. */
  v: number
}

export const emptyFilterPrefs = (): FilterPrefs => ({ pinned: [], hidden: [], ranked: [], basis: 0, complete: false, v: 0 })

/** The filters in the bar between All and More: pinned first, then the automatic choice. */
export function visibleFilters(prefs: Pick<FilterPrefs, 'pinned' | 'hidden' | 'ranked'>, slots = PERSONALIZE.slots): string[] {
  const pinned = new Set(prefs.pinned)
  const hidden = new Set(prefs.hidden)
  const auto = prefs.ranked.filter((id) => !pinned.has(id) && !hidden.has(id)).slice(0, Math.max(0, slots - pinned.size))
  return [...prefs.pinned, ...arrange(auto, prefs.ranked)]
}

/** Whether the stored choice should be made again for a history of `size` conversations. */
export function shouldRefresh(prefs: FilterPrefs, size: number, complete: boolean, cfg: PersonalizeConfig = PERSONALIZE): boolean {
  if (prefs.v !== PERSONALIZE_VERSION) return true
  if (complete && !prefs.complete) return true
  const delta = Math.abs(size - prefs.basis)
  return delta >= cfg.refreshMinDelta && delta >= (prefs.complete ? cfg.refreshMinRatio : cfg.provisionalRatio) * prefs.basis
}

