// Search normalisation.
//
// Only Latin-style combining diacritics (U+0300–U+036F) are stripped, so that
// "café" matches "cafe". Other combining marks are kept: stripping all \p{M}
// would destroy Indic scripts, where vowel signs are combining marks.

const DIACRITICS = /[̀-ͯ]/g
const NON_WORD = /[^\p{L}\p{N}\p{M}]+/gu
const SPACES = /\s+/g

/** Lowercased, diacritic-folded, punctuation removed, whitespace collapsed. */
export function normalize(input: string): string {
  return fold(input).replace(NON_WORD, ' ').trim()
}

/** Lowercased and diacritic-folded, punctuation kept, whitespace collapsed. */
export function fold(input: string): string {
  return input.normalize('NFKD').replace(DIACRITICS, '').toLowerCase().replace(SPACES, ' ').trim()
}
