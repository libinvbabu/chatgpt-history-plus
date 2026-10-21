import { describe, expect, it } from 'vitest'
import { categorize, normalizeTitle } from '../../src/related/categorize'
import { categoryFor, categoryForTitle, extract } from '../../src/related/extract'
import { AUDIT } from './fixtures/category-titles'

describe('category classification', () => {
  it('normalises titles before matching', () => {
    expect(normalizeTitle('TRP - Review Paytm PR')).toBe('trp review paytm pr')
    expect(normalizeTitle('Read-Only access (1:1)')).toBe('read only access 1 1')
    expect(normalizeTitle('  ')).toBe('')
  })

  it.each(AUDIT)('%s → %s', (title, expected) => {
    expect(categoryForTitle(title)).toBe(expected)
  })

  it('gives a PR review precedence over whatever the PR is about', () => {
    for (const t of ['Review Paytm PR', 'Hero Cashback PR Review', 'Review Kisan Backend Changes', 'Analytics dashboard PR', 'Fix payment crash PR #4312', 'https://github.com/Animall-In/backend-apis/pull/4294'])
      expect(categoryForTitle(t), t).toBe('code-review')
  })

  it('does not treat every "review" as a code review, or every "payment" as Payments', () => {
    expect(categoryForTitle('Review Q3 pricing proposal')).toBe('product')
    expect(categoryForTitle('Performance review for Asha')).toBe('people')
    expect(categoryForTitle('Review the monthly revenue report')).toBe('analytics')
    expect(categoryForTitle('Payment webhook signature verification')).toBe('engineering')
    expect(categoryForTitle('Payment success rate dashboard')).toBe('analytics')
    expect(categoryForTitle('Mr Sharma follow-up')).toBe('general') // "Mr" is a person, not a merge request
  })

  it('keeps technical titles out of Other and Product', () => {
    for (const t of ['Compare Audio Video Notifications', 'Engineering AI Questionnaire', 'WebSocket reconnect strategy', 'Kotlin coroutine scope', 'Call Drop Review Plan']) {
      const c = categoryForTitle(t)
      expect(['engineering', 'debugging'], `${t} → ${c}`).toContain(c)
    }
  })

  it('an explicit "debug" is debugging, whatever is being debugged', () => {
    for (const t of ['Debug CI pipeline', 'Debug onboarding flow', 'Debug hiring loop', 'Debugging Redis eviction']) expect(categoryForTitle(t), t).toBe('debugging')
  })

  it('needs a clear signal: a single hint, or nothing at all, is Other', () => {
    for (const t of ['Hello', 'New chat', 'Quick question', 'Improving Team Communication', 'Plan for tomorrow', 'Untitled', '¿Qué es esto?'])
      expect(categoryForTitle(t), t).toBe('general')
  })

  it('uses a stored category before the title, and ignores one that is not ours', () => {
    expect(categoryFor({ title: 'Review Paytm PR', category: 'writing' })).toBe('writing')
    expect(categoryFor({ title: 'Review Paytm PR', category: 'made-up' })).toBe('code-review')
  })

  it('is what extract() reports, and does not change what the related engine sees', () => {
    const x = extract('Paytm PreNotify architecture')
    expect(x.category).toBe('engineering')
    expect(categorize('Paytm PreNotify architecture', x.entities)).toBe('engineering')
    // Topics and activity (the related engine's inputs) are untouched by the icon rules.
    expect(x.topics).toEqual(['subscriptions', 'architecture'])
    expect(x.activity).toBeNull()
  })
})
