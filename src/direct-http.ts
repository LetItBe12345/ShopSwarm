import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'

/** HTTP request that ignores proxy environment variables inherited by the host. */
export function directFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const url = new URL(String(input))
  const request = url.protocol === 'https:' ? httpsRequest : httpRequest
  return new Promise((resolve, reject) => {
    const body = typeof init.body === 'string' ? init.body : undefined
    const req = request(url, {
      method: init.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init.headers).entries()),
    }, response => {
      const chunks: Buffer[] = []
      response.on('data', chunk => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      response.on('end', () => resolve(new Response(Buffer.concat(chunks), {
        status: response.statusCode ?? 500,
        headers: response.headers as Record<string, string>,
      })))
      response.on('error', reject)
    })
    const abort = (): void => { req.destroy(new Error('direct HTTP request aborted')) }
    if (init.signal?.aborted) {
      abort()
      reject(new Error('direct HTTP request aborted'))
      return
    }
    init.signal?.addEventListener('abort', abort, { once: true })
    req.on('error', reject)
    if (body !== undefined) req.write(body)
    req.end()
  })
}
