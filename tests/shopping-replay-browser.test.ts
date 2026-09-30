import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { AgentBrowserSession, createShoppingTaskRun } from '../src/index.js'

describe('M2.2 browser replay', () => {
  it('waits for a delayed new document and really reloads the same URL on replay', async () => {
    let visits = 0
    const server = createServer((request, response) => {
      if (request.url !== '/item') { response.writeHead(204); response.end(); return }
      visits += 1
      const content = `<!doctype html><title>商品</title><main>Version ${visits}</main>`
      setTimeout(() => {
        response.writeHead(200, { 'content-type': 'text/html' })
        response.end(content)
      }, 150)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('server has no port')
    const url = `http://127.0.0.1:${address.port}/item`
    const browser = new AgentBrowserSession({ owner: 'delayed-navigation', signal: new AbortController().signal, timeoutMs: 5000 })
    try {
      const first = await browser.open(url)
      expect(first.status).toBe('success')
      expect(first.page?.origin).toBe(url)
      const firstShot = await browser.snapshot({ compact: false })
      expect(firstShot.status === 'success' && firstShot.page.tree).toContain('Version 1')
      const second = await browser.open(url)
      expect(second.status).toBe('success')
      const secondShot = await browser.snapshot({ compact: false })
      expect(secondShot.status === 'success' && secondShot.page.tree).toContain('Version 2')
      expect(visits).toBeGreaterThanOrEqual(2)
    } finally {
      await browser.close()
      await new Promise<void>(resolve => server.close(() => resolve()))
    }
  })
  it('returns a loaded blank document for Agent judgment instead of waiting for guessed content', async () => {
    const server = createServer((_request, response) => { response.writeHead(200, { 'content-type': 'text/html' }); response.end('<!doctype html><html><body></body></html>') })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('server has no port')
    const url = `http://127.0.0.1:${address.port}/empty`
    const browser = new AgentBrowserSession({ owner: 'blank-document', signal: new AbortController().signal, timeoutMs: 3000 })
    try {
      expect(await browser.open(url)).toMatchObject({ status: 'success' })
      const shot = await browser.snapshot({ compact: false })
      expect(shot.status === 'success' && shot.page.origin).toBe(url)
    } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())) }
  })
  it('lets the source Agent choose a same-session revisit instead of forcing replay', { timeout: 90_000 }, async () => {
    let visits = 0
    const server = createServer((request, response) => {
      if (request.url !== '/item') { response.writeHead(204); response.end(); return }
      visits++
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(`<h1>商品</h1><p>报价 ${visits === 1 ? '398' : '399'} €</p>`)
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('server has no port')
    const url = `http://127.0.0.1:${address.port}/item`
    const run = createShoppingTaskRun({ startUrl: url, goal: '读报价' }, { owner: 'agent-revisit', signal: new AbortController().signal, timeoutMs: 10000 })
    try {
      const first = await run.start()
      expect(first.pageExcerpt).toContain('398')
      await run.browse([{ action: 'open', url }])
      const second = run.read()
      expect(second.pageExcerpt).toContain('399')
      expect(run.read(first.snapshotId).pageExcerpt).toContain('398')
      expect(visits).toBe(2)
    } finally { await run.close(); await new Promise<void>(resolve => server.close(() => resolve())) }
  })
})
