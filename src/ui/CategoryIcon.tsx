// One subtle, neutral icon per conversation category. The mapping lives here,
// in one table: add a category in src/related/dictionary.ts and a row below.
//
// Glyphs are adapted from Lucide (https://lucide.dev), ISC License:
//   Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as
//   part of Feather (MIT). All other copyright (c) for Lucide are held by the
//   Lucide Contributors 2022. Permission to use, copy, modify, and/or distribute
//   this software for any purpose with or without fee is hereby granted,
//   provided that the above copyright notice and this permission notice appear
//   in all copies.

import type { ReactNode, SVGProps } from 'react'
import type { CategoryId } from '../related/dictionary'
import { CATEGORY_LABELS } from '../related/dictionary'

const glyph = (children: ReactNode) =>
  function Glyph({ size = 15, ...p }: SVGProps<SVGSVGElement> & { size?: number }) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
        {children}
      </svg>
    )
  }

const ICONS: Record<CategoryId, ReturnType<typeof glyph>> = {
  'code-review': glyph(
    <>
      <circle cx="18" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <path d="M13 6h3a2 2 0 0 1 2 2v7" />
      <path d="M6 9v12" />
    </>,
  ),
  engineering: glyph(
    <>
      <path d="m18 16 4-4-4-4" />
      <path d="m6 8-4 4 4 4" />
      <path d="m14.5 4-5 16" />
    </>,
  ),
  debugging: glyph(
    <>
      <path d="m8 2 1.88 1.88" />
      <path d="M14.12 3.88 16 2" />
      <path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1" />
      <path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6" />
      <path d="M12 20v-9" />
      <path d="M6.53 9C4.6 8.8 3 7.1 3 5" />
      <path d="M6 13H2" />
      <path d="M3 21c0-2.1 1.7-3.9 3.8-4" />
      <path d="M20.97 5c0 2.1-1.6 3.8-3.5 4" />
      <path d="M22 13h-4" />
      <path d="M17.2 17c2.1.1 3.8 1.9 3.8 4" />
    </>,
  ),
  payments: glyph(
    <>
      <rect width="20" height="14" x="2" y="5" rx="2" />
      <path d="M2 10h20" />
    </>,
  ),
  analytics: glyph(
    <>
      <path d="M3 3v18h18" />
      <path d="M18 17V9" />
      <path d="M13 17V5" />
      <path d="M8 17v-3" />
    </>,
  ),
  product: glyph(
    <>
      <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" />
      <path d="M9 18h6" />
      <path d="M10 22h4" />
    </>,
  ),
  people: glyph(
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </>,
  ),
  security: glyph(<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />),
  writing: glyph(
    <>
      <path d="M12.5 22H18a2 2 0 0 0 2-2V7l-5-5H6a2 2 0 0 0-2 2v9.5" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M13.378 15.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z" />
    </>,
  ),
  general: glyph(<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />),
}

/** The category's icon; the name is on hover. Unknown categories fall back to the general icon. */
export function CategoryIcon({ category, size }: { category: CategoryId; size?: number }) {
  const Icon = ICONS[category] ?? ICONS.general
  return (
    <span className="cat" title={CATEGORY_LABELS[category] ?? CATEGORY_LABELS.general} data-category={category}>
      <Icon size={size} />
    </span>
  )
}
