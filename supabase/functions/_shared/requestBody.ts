// Bound memory use before decoding or parsing caller-controlled JSON.
export class RequestBodyError extends Error {
  constructor(message: string, readonly status: 400 | 413) { super(message); this.name = 'RequestBodyError' }
}

export async function readJsonBody(request: Request, limit = 8192): Promise<Record<string, unknown>> {
  const declared = request.headers.get('Content-Length')
  if (declared && Number(declared) > limit) throw new RequestBodyError('Reminder request is too large.', 413)
  const chunks: Uint8Array[] = []
  let size = 0
  if (request.body) {
    const reader = request.body.getReader()
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > limit) { await reader.cancel().catch(() => {}); throw new RequestBodyError('Reminder request is too large.', 413) }
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  let value: unknown
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes) || '{}') }
  catch { throw new RequestBodyError('Invalid reminder request.', 400) }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RequestBodyError('Invalid reminder request.', 400)
  return value as Record<string, unknown>
}
