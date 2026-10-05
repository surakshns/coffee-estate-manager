export function errorMessage(cause: unknown, fallback: string) {
  return cause && typeof cause === 'object' && 'message' in cause && typeof cause.message === 'string' && cause.message.trim()
    ? cause.message : fallback
}
