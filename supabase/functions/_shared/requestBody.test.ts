import { describe, expect, it, vi } from 'vitest'
import { readJsonBody } from './requestBody'
const request = (body: string, headers?: HeadersInit) => new Request('https://example.invalid', { method: 'POST', body, headers })
describe('bounded reminder request parsing', () => {
  it('reads an object, including Unicode, and accepts an empty body', async () => {
    expect(await readJsonBody(request('{"action":"status","note":"ಕಾಫಿ"}'))).toEqual({ action: 'status', note: 'ಕಾಫಿ' })
    expect(await readJsonBody(request(''))).toEqual({})
  })
  it.each(['[]', 'null', '"status"', '42', '{broken'])('rejects invalid request bodies: %s', async body => {
    await expect(readJsonBody(request(body))).rejects.toThrow()
  })
  it('limits UTF-8 bytes, including when the length header is absent or understated', async () => {
    await expect(readJsonBody(request(JSON.stringify({ note: 'ಕ'.repeat(3000) }), { 'Content-Length': '1' }))).rejects.toThrow('too large')
    await expect(readJsonBody(request('{}', { 'Content-Length': '9000' }))).rejects.toThrow('too large')
  })
  it('cancels an oversized stream before consuming the remaining body', async () => {
    const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(8193)) }, cancel })
    const init = { method: 'POST', body, duplex: 'half' }
    await expect(readJsonBody(new Request('https://example.invalid', init as RequestInit))).rejects.toThrow('too large')
    expect(cancel).toHaveBeenCalledOnce()
  })
})
