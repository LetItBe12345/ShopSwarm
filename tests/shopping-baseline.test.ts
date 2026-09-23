import { createServer, type Server } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AgentBrowserSession,
  getAgentBrowserVersion,
  validateOffer,
  type BrowserCommandRunner,
  type BrowserElementRef,
  type BrowserPageState,
  type Offer,
} from '../src/index.js'

const pageNames = ['search', 'spec', 'lazy', 'overlay', 'stale'] as const
type PageName = typeof pageNames[number]
const pages = new Map<PageName, string>(await Promise.all(pageNames.map(async name => [
  name,
  await readFile(fileURLToPath(new URL(`./fixtures/pages/baseline-${name}.html`, import.meta.url)), 'utf8'),
] as const)))
const cleanup: Array<() => Promise<void>> = []

interface TimingRecord {
  readonly phase: 'open' | 'snapshot' | 'action'
  readonly elapsedMs: number
  readonly command: 'open' | 'snapshot' | 'click' | 'fill' | 'select' | 'wait'
  readonly nodeVersion: string
  readonly platform: string
  readonly agentBrowserVersion: string
  readonly page: PageName
}

interface BrowserOps {
  click(target: BrowserElementRef): ReturnType<AgentBrowserSession['click']>
  fill(target: BrowserElementRef, value: string): ReturnType<AgentBrowserSession['fill']>
  select(target: BrowserElementRef, values: readonly [string, ...string[]]): ReturnType<AgentBrowserSession['select']>
  wait(condition: { readonly kind: 'text' | 'load'; readonly value: string | 'load' | 'domcontentloaded' | 'networkidle'; readonly timeoutMs: number }): ReturnType<AgentBrowserSession['wait']>
}

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(close => close()))
})

function element(page: BrowserPageState, role: string, name: string): BrowserElementRef {
  const found = page.elements.find(candidate => candidate.role === role && candidate.name === name)
  if (found === undefined) throw new Error(`missing ${role} named ${name} in snapshot:\n${page.tree}`)
  return found
}

async function servePages(): Promise<{ readonly baseUrl: string; close(): Promise<void> }> {
  const server: Server = createServer((request, response) => {
    const pageName = request.url?.slice(1) as PageName | undefined
    const html = pageName === undefined ? undefined : pages.get(pageName)
    response.writeHead(html === undefined ? 404 : 200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(html ?? 'not found')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('fixture server has no TCP address')
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  }
}

function elapsed(start: number): number {
  return Math.max(0, Math.round(performance.now() - start))
}

function makeOffer(overrides: Partial<Offer> = {}): Offer {
  const now = new Date().toISOString()
  return {
    product: { model: 'Example NVMe', specs: [{ name: '容量', value: '2TB' }] },
    seller: 'Example 自营店',
    currency: 'CNY',
    listedPrice: { status: 'known', value: { currency: 'CNY', minor: 89900 } },
    fees: [],
    url: 'https://example.test/product/1',
    observedAt: now,
    evidence: [{ field: 'listedPrice', url: 'https://example.test/product/1', observedAt: now, excerpt: '标价 ¥899.00' }],
    ...overrides,
  }
}

describe('M1.3 shopping baseline', () => {
  it('validates known prices and explicitly unknown shipping amounts', () => {
    validateOffer(makeOffer())
    validateOffer(makeOffer({ fees: [{ kind: 'shipping', amount: { status: 'unknown' } }] }))
  })

  it('rejects malformed values with a field path', () => {
    expect(() => validateOffer(makeOffer({ fees: [{ kind: 'shipping', amount: { status: 'known', value: { currency: 'USD', minor: 12 } } }] })))
      .toThrow('fees[0].amount.value.currency')
    expect(() => validateOffer(makeOffer({ listedPrice: { status: 'known', value: { currency: 'CNY', minor: Number.MAX_SAFE_INTEGER + 1 } } })))
      .toThrow('listedPrice.value.minor')
    expect(() => validateOffer(makeOffer({ fees: [
      { kind: 'shipping', amount: { status: 'unknown' } },
      { kind: 'shipping', amount: { status: 'unknown' } },
    ] }))).toThrow('duplicate shipping fee')
  })

  it('covers five local page behaviors and records open, snapshot, and action durations', { timeout: 90_000 }, async () => {
    const fixtureServer = await servePages()
    cleanup.push(() => fixtureServer.close())
    const browserVersion = await getAgentBrowserVersion(10_000)
    const records: TimingRecord[] = []

    async function runPage<T>(name: PageName, action: (page: BrowserPageState, browser: BrowserOps) => Promise<T>): Promise<T> {
      const browser = new AgentBrowserSession({
        owner: `shopping-baseline-${name}-${process.pid}`,
        session: `shopswarm-baseline-${name}-${process.pid}`,
        signal: new AbortController().signal,
        timeoutMs: 10_000,
      })
      const startOpen = performance.now()
      const opened = await browser.open(`${fixtureServer.baseUrl}/${name}`)
      records.push({ phase: 'open', elapsedMs: elapsed(startOpen), command: 'open', nodeVersion: process.version, platform: process.platform, agentBrowserVersion: browserVersion, page: name })
      expect(opened.status).toBe('success')
      const startSnapshot = performance.now()
      const snapshot = await browser.snapshot()
      records.push({ phase: 'snapshot', elapsedMs: elapsed(startSnapshot), command: 'snapshot', nodeVersion: process.version, platform: process.platform, agentBrowserVersion: browserVersion, page: name })
      expect(snapshot.status).toBe('success')
      if (snapshot.status !== 'success') throw new Error(`snapshot failed for ${name}`)
      cleanup.push(async () => { await browser.close() })
      async function recordAction<T>(command: TimingRecord['command'], run: () => Promise<T>): Promise<T> {
        const start = performance.now()
        try {
          return await run()
        } finally {
          records.push({ phase: 'action', elapsedMs: elapsed(start), command, nodeVersion: process.version, platform: process.platform, agentBrowserVersion: browserVersion, page: name })
        }
      }
      const ops: BrowserOps = {
        click: target => recordAction('click', () => browser.click(target)),
        fill: (target, value) => recordAction('fill', () => browser.fill(target, value)),
        select: (target, values) => recordAction('select', () => browser.select(target, values)),
        wait: condition => recordAction('wait', () => browser.wait(condition)),
      }
      return action(snapshot.page, ops)
    }

    const queryResult = await runPage('search', async (page, browser) => {
      const filled = await browser.fill(element(page, 'textbox', '查询商品'), 'NVMe 2TB')
      expect(filled.status).toBe('success')
      if (filled.page === undefined) throw new Error('fill did not return a page')
      const clicked = await browser.click(element(filled.page, 'button', '搜索'))
      expect(clicked.status).toBe('success')
      return clicked.page?.tree ?? ''
    })
    expect(queryResult).toContain('搜索结果：NVMe 2TB')

    const selectedResult = await runPage('spec', async (page, browser) => {
      const selected = await browser.select(element(page, 'combobox', '容量'), ['2TB'])
      expect(selected.status).toBe('success')
      return selected.page?.tree ?? ''
    })
    expect(selectedResult).toContain('已选 2TB')
    expect(selectedResult).toContain('1TB')

    const lazyResult = await runPage('lazy', async (page, browser) => {
      expect(page.tree).not.toContain('页面标价')
      const waited = await browser.wait({ kind: 'text', value: '页面标价：89900 分', timeoutMs: 2_000 })
      expect(waited.status).toBe('success')
      return waited.page?.tree ?? ''
    })
    expect(lazyResult).toContain('页面标价：89900 分')

    const overlayResult = await runPage('overlay', async (page, browser) => {
      expect(page.elements.some(candidate => candidate.name === '2TB')).toBe(false)
      const closed = await browser.click(element(page, 'button', '关闭提示'))
      expect(closed.status).toBe('success')
      if (closed.page === undefined) throw new Error('overlay close did not return a page')
      expect(closed.page.elements.some(candidate => candidate.name === '2TB')).toBe(true)
      const selected = await browser.click(element(closed.page, 'button', '2TB'))
      expect(selected.status).toBe('success')
      return selected.page?.tree ?? ''
    })
    expect(overlayResult).toContain('已选 2TB')

    const staleResult = await runPage('stale', async (page, browser) => {
      const oldRef = element(page, 'button', '稍后移除')
      await new Promise(resolve => setTimeout(resolve, 400))
      const refreshed = await browser.wait({ kind: 'load', value: 'domcontentloaded', timeoutMs: 2_000 })
      expect(refreshed.status).toBe('success')
      return browser.click(oldRef)
    })
    expect(staleResult).toMatchObject({ status: 'failure', error: { code: 'stale_element_reference' } })

    for (const name of pageNames) {
      expect(records.some(record => record.page === name && record.phase === 'open')).toBe(true)
      expect(records.some(record => record.page === name && record.phase === 'snapshot')).toBe(true)
      expect(records.some(record => record.page === name && record.phase === 'action')).toBe(true)
    }
    expect(records.every(record => Number.isInteger(record.elapsedMs) && record.elapsedMs >= 0)).toBe(true)
    expect(records.every(record => record.nodeVersion === process.version && record.platform === process.platform && record.agentBrowserVersion.includes('0.38.1'))).toBe(true)
    console.info(`M1.3_TIMING ${JSON.stringify(records)}`)
  })
})
