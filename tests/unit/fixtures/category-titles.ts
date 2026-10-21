// Titles for the classifier audit, with the category a person would give each.
// The first group are titles from the user's own sidebar (screenshots and the
// audit request); the rest are realistic, deliberately ambiguous titles in the
// same style ("review", "payment", "plan", "analysis" used every which way).
//
// Written for the developer-oriented categories of 0.2 and carried over to the
// universal taxonomy: "primary" or "primary/subcategory". Where only a primary
// is given, any subcategory (or none) is fine. These must not regress.

export const AUDIT: Array<[title: string, expected: string, why?: string]> = [
  // From the user's sidebar
  ['PR review', 'technology/pr-reviews'],
  ['PR review summary', 'technology/pr-reviews'],
  ['TRP - Review Paytm PR', 'technology/pr-reviews', 'reviewing a PR wins over the payments subject'],
  ['Rishab - PR review', 'technology/pr-reviews'],
  ['Set up PR reviews', 'technology/pr-reviews'],
  ['Review Hero Checkout PRs', 'technology/pr-reviews'],
  ['Review Hero Cashback Checkout', 'work/payments', 'no PR signal in the title; cashback + checkout'],
  ['Compare Audio Video Notifications', 'technology', 'notification implementation'],
  ['Draft interview heads up', 'work/hiring', 'a message, but about hiring'],
  ['Call Drop Review Plan', 'technology/debugging', 'dropped calls are a fault; "review plan" is weak'],
  ['Improve History Sidebar', 'work/product'],
  ['Engineering AI Questionnaire', 'technology'],
  ['Amplitude renewal review', 'work/analytics', 'Amplitude is the analytics tool being renewed'],
  ['Read Only Access Request', 'technology/security'],
  ['Investigate Meta sync failure', 'technology/debugging'],
  ['Review duplicate Paytm debit query', 'work/payments', 'a payment problem, not a PR'],
  ['Paytm PreNotify architecture', 'technology', 'technical design of a payments feature'],
  ['Paytm reconciliation', 'work/payments'],
  ['Mobile game ideas', 'personal/entertainment', 'was Product; a mobile game is entertainment unless the title says it is product work (low confidence)'],
  ['Kisan pricing model', 'work/product'],
  ['Apple developer enrolment', 'technology'],
  ['Review Razorpay Settlement PR #5150', 'technology/pr-reviews'],
  ['Razorpay PR 5150 follow-up fixes', 'technology/pr-reviews'],
  ['PR 5150 rollback plan', 'technology/pr-reviews'],
  // PR reviews named without "PR"
  ['Review Paytm PR', 'technology/pr-reviews'],
  ['Hero Cashback PR Review', 'technology/pr-reviews'],
  ['Review Kisan Backend Changes', 'technology/pr-reviews'],
  ['Code review for subscription service', 'technology/pr-reviews'],
  // "review" that is not a code review
  ['Review analytics dashboard', 'work/analytics'],
  ['Review offer letter for backend candidate', 'work/hiring'],
  ['Appraisal feedback for Rishab', 'work/hiring'],
  ['Compensation benchmarking for SDE2', 'work/hiring'],
  // "payment" that is engineering, analytics or writing
  ['Payment gateway integration plan', 'technology'],
  ['Paytm autopay crash in Android app', 'technology/debugging'],
  ['Payment failure analysis', 'work/analytics'],
  ['Write email to Razorpay about settlement delay', 'writing'],
  ['Autopay mandate not getting created', 'work/payments'],
  ['Cancel subscription and refund', 'work/payments'],
  ['Fix PayU refund flow', 'work/payments', 'a payment failure is still Payments'],
  // "analysis" and analytics
  ['Revenue drop analysis', 'work/analytics'],
  ['Investigate funnel tracking discrepancy', 'work/analytics'],
  ['Mixpanel vs Amplitude event mismatch', 'work/analytics'],
  ['September revenue report', 'work/analytics'],
  // "plan" that is product, engineering or personal
  ['Plan Q4 roadmap', 'work/product'],
  ['PRD for referral program', 'work/product'],
  ['Checkout UX improvements', 'work/product'],
  ['Plan the product launch checklist', 'work/product', 'a checklist (a planning format) about a product launch: the subject wins'],
  ['Database migration plan', 'technology'],
  ['Workout plan', 'personal/health'],
  ['Plan reading list', 'personal/entertainment'],
  // Engineering
  ['Android notification not showing on Xiaomi', 'technology/debugging'],
  ['Explain React hooks', 'technology'],
  ['Postgres index tuning', 'technology'],
  ['Design webhook retries', 'technology'],
  ['Refactor onboarding API', 'technology'],
  ['WebSocket reconnect strategy', 'technology'],
  // Writing
  ['Thank you message to the team', 'writing'],
  ['Summarise meeting notes', 'writing'],
  ['LinkedIn post about launch', 'writing'],
  // Nothing to go on
  ['Weekend trip itinerary ideas', 'personal/travel'],
  ['Kitchen renovation budget', 'personal', 'a home project or a budget: Home or Finance'],
  ['Hello', 'general'],
  ['Improving Team Communication', 'general'],
]
