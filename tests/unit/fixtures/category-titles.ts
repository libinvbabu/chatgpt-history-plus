// Titles for the classifier audit, with the category a person would give each.
// The first group are titles from the user's own sidebar (screenshots and the
// audit request); the rest are realistic, deliberately ambiguous titles in the
// same style ("review", "payment", "plan", "analysis" used every which way).

import type { CategoryId } from '../../../src/related/dictionary'

export const AUDIT: Array<[title: string, expected: CategoryId, why?: string]> = [
  // From the user's sidebar
  ['PR review', 'code-review'],
  ['PR review summary', 'code-review'],
  ['TRP - Review Paytm PR', 'code-review', 'reviewing a PR wins over the payments subject'],
  ['Rishab - PR review', 'code-review'],
  ['Set up PR reviews', 'code-review'],
  ['Review Hero Checkout PRs', 'code-review'],
  ['Review Hero Cashback Checkout', 'payments', 'no PR signal in the title; cashback + checkout'],
  ['Compare Audio Video Notifications', 'engineering', 'notification implementation'],
  ['Draft interview heads up', 'people', 'a message, but about hiring'],
  ['Call Drop Review Plan', 'debugging', 'dropped calls are a fault; "review plan" is weak'],
  ['Improve History Sidebar', 'product'],
  ['Engineering AI Questionnaire', 'engineering'],
  ['Amplitude renewal review', 'analytics', 'Amplitude is the analytics tool being renewed'],
  ['Read Only Access Request', 'security'],
  ['Investigate Meta sync failure', 'debugging'],
  ['Review duplicate Paytm debit query', 'payments', 'a payment problem, not a PR'],
  ['Paytm PreNotify architecture', 'engineering', 'technical design of a payments feature'],
  ['Paytm reconciliation', 'payments'],
  ['Mobile game ideas', 'product'],
  ['Kisan pricing model', 'product'],
  ['Apple developer enrolment', 'engineering'],
  ['Review Razorpay Settlement PR #5150', 'code-review'],
  ['Razorpay PR 5150 follow-up fixes', 'code-review'],
  ['PR 5150 rollback plan', 'code-review'],
  // PR reviews named without "PR"
  ['Review Paytm PR', 'code-review'],
  ['Hero Cashback PR Review', 'code-review'],
  ['Review Kisan Backend Changes', 'code-review'],
  ['Code review for subscription service', 'code-review'],
  // "review" that is not a code review
  ['Review analytics dashboard', 'analytics'],
  ['Review offer letter for backend candidate', 'people'],
  ['Appraisal feedback for Rishab', 'people'],
  ['Compensation benchmarking for SDE2', 'people'],
  // "payment" that is engineering, analytics or writing
  ['Payment gateway integration plan', 'engineering'],
  ['Paytm autopay crash in Android app', 'debugging'],
  ['Payment failure analysis', 'analytics'],
  ['Write email to Razorpay about settlement delay', 'writing'],
  ['Autopay mandate not getting created', 'payments'],
  ['Cancel subscription and refund', 'payments'],
  ['Fix PayU refund flow', 'payments', 'a payment failure is still Payments'],
  // "analysis" and analytics
  ['Revenue drop analysis', 'analytics'],
  ['Investigate funnel tracking discrepancy', 'analytics'],
  ['Mixpanel vs Amplitude event mismatch', 'analytics'],
  ['September revenue report', 'analytics'],
  // "plan" that is product, engineering or personal
  ['Plan Q4 roadmap', 'product'],
  ['PRD for referral program', 'product'],
  ['Checkout UX improvements', 'product'],
  ['Plan the product launch checklist', 'product'],
  ['Database migration plan', 'engineering'],
  ['Workout plan', 'general'],
  ['Plan reading list', 'general'],
  // Engineering
  ['Android notification not showing on Xiaomi', 'debugging'],
  ['Explain React hooks', 'engineering'],
  ['Postgres index tuning', 'engineering'],
  ['Design webhook retries', 'engineering'],
  ['Refactor onboarding API', 'engineering'],
  ['WebSocket reconnect strategy', 'engineering'],
  // Writing
  ['Thank you message to the team', 'writing'],
  ['Summarise meeting notes', 'writing'],
  ['LinkedIn post about launch', 'writing'],
  // Nothing to go on
  ['Weekend trip itinerary ideas', 'general'],
  ['Kitchen renovation budget', 'general'],
  ['Hello', 'general'],
  ['Improving Team Communication', 'general'],
]
