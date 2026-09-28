export const TOGGLE_MESSAGE = 'chp:toggle' as const

export interface ToggleMessage {
  type: typeof TOGGLE_MESSAGE
}

export function isToggleMessage(m: unknown): m is ToggleMessage {
  return !!m && typeof m === 'object' && (m as { type?: unknown }).type === TOGGLE_MESSAGE
}
