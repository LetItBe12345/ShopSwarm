import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  AgentBrowserSession,
  type BrowserCommandRunner,
  type BrowserElementRef,
  type BrowserPageState,
} from '../src/index.js'

const fixture = await readFile(fileURLToPath(new URL('./fixtures/pages/browser-actions.html', import.meta.url)))
const cleanup: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map(fn => fn()))
})

function element(page: BrowserPageState, role: string, name: string): BrowserElementRef {
  const match = page.elements.find(candidate => candidate.role === role && candidate.name === name)
  if (match === undefined) throw new Error(`missing ${role} named ${name} in snapshot:\n${page.tree}`)
  return match
}

async function startFixtureServer(): Promise<{ readonly url: string; close(): Promise<void> }> {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(request.url === '/next'
      ? '<!doctype html><html lang="zh-CN"><title>详情</title><h1>商品详情页</h1><button>完成</button></html>'
      : fixture)
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('fixture server has no TCP address')
  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
    }),
  }
}

describe('AgentBrowserSession', () => {
  it('executes the supported actions and refreshes page references', { timeout: 45_000 }, async () => {
    const fixtureServer = await startFixtureServer()
    const socketDir = await mkdtemp(join(tmpdir(), 'shopswarm-m1-test-'))
    const browser = new AgentBrowserSession({
      owner: 'browser-actions-test',
      session: `shopswarm-m1-${process.pid}`,
      socketDir,
      signal: new AbortController().signal,
      timeoutMs: 10_000,
    })
    cleanup.push(async () => {
      await browser.close()
      await fixtureServer.close()
      await rm(socketDir, { recursive: true, force: true })
    })

    const opened = await browser.open(fixtureServer.url)
    expect(opened.status).toBe('success')
    if (opened.status !== 'success' || opened.page === undefined) return
    expect(opened.page.tree).toContain('商品测试页')

    const observed = await browser.snapshot()
    expect(observed.status).toBe('success')
    if (observed.status !== 'success') return

    const failedWait = await browser.wait({ kind: 'text', value: '不会出现的文本', timeoutMs: 100 })
    expect(failedWait).toMatchObject({ status: 'failure', error: { code: 'command_failed' } })

    const originalSearchButton = element(observed.page, 'button', '搜索')
    const filled = await browser.fill(element(observed.page, 'textbox', '查询商品'), 'NVMe 2TB')
    expect(filled.status).toBe('success')
    if (filled.page === undefined) return
    expect(filled.page.revision).toBeGreaterThan(opened.page.revision)
    expect(filled.page.tree).toContain('NVMe 2TB')

    const stale = await browser.click(originalSearchButton)
    expect(stale).toMatchObject({
      status: 'failure',
      error: { code: 'stale_element_reference' },
    })

    const clicked = await browser.click(element(filled.page, 'button', '搜索'))
    expect(clicked.status).toBe('success')
    if (clicked.page === undefined) return
    expect(clicked.page.tree).toContain('搜索结果：NVMe 2TB')

    const selected = await browser.select(element(clicked.page, 'combobox', '容量'), ['2TB'])
    expect(selected.status).toBe('success')
    if (selected.page === undefined) return
    expect(selected.page.tree).toContain('已选 2TB')

    const pressed = await browser.press('Tab')
    expect(pressed.status).toBe('success')
    const scrolled = await browser.scroll('down', 200)
    expect(scrolled.status).toBe('success')
    const waited = await browser.wait({ kind: 'text', value: '搜索结果：NVMe 2TB', timeoutMs: 1_000 })
    expect(waited.status).toBe('success')
    if (waited.page === undefined) return

    const navigated = await browser.click(element(waited.page, 'link', '查看详情'))
    expect(navigated.status).toBe('success')
    if (navigated.page === undefined) return
    expect(navigated.page.origin).toMatch(/\/next$/)
    expect(navigated.page.tree).toContain('商品详情页')

    const backed = await browser.back()
    expect(backed.status).toBe('success')
    if (backed.page === undefined) return
    expect(backed.page.origin).toBe(fixtureServer.url)
    expect(backed.page.tree).toContain('NVMe 2TB')

    await expect(browser.close()).resolves.toMatchObject({ status: 'success', action: 'close' })
    await expect(browser.close()).resolves.toMatchObject({ status: 'success', action: 'close' })
  })

  it('requires observable wait conditions with bounded timeouts', async () => {
    const calls: Array<{ args: readonly string[]; timeoutMs: number }> = []
    const runner: BrowserCommandRunner = async (args, options) => {
      calls.push({ args, timeoutMs: options.timeoutMs })
      if (args.includes('snapshot')) {
        return { exitCode: 0, stderr: '', stdout: JSON.stringify({
          success: true,
          data: { origin: 'https://example.test/', snapshot: '', refs: {}, removedRefs: [] },
          error: null,
        }) }
      }
      return { exitCode: 0, stderr: '', stdout: JSON.stringify({ success: true, data: {}, error: null }) }
    }
    const browser = new AgentBrowserSession({ owner: 'wait-bounds', signal: new AbortController().signal, timeoutMs: 30_000, commandRunner: runner })
    const missing = await browser.wait({ kind: 'text', value: 'ready' } as never)
    expect(missing).toMatchObject({ status: 'failure', error: { code: 'invalid_argument' } })
    const tooLong = await browser.wait({ kind: 'url', value: '/done', timeoutMs: 30_001 })
    expect(tooLong).toMatchObject({ status: 'failure', error: { code: 'invalid_argument' } })
    const accepted = await browser.wait({ kind: 'load', value: 'domcontentloaded', timeoutMs: 30_000 })
    expect(accepted.status).toBe('success')
    expect(calls[0]?.args).toEqual(['--session', expect.any(String), '--headed', 'false', '--json', 'wait', '--load', 'domcontentloaded', '--timeout', '30000'])
    expect(calls.every(call => call.timeoutMs === 30_000)).toBe(true)
  })

  it('does not pass proxy variables to agent-browser', async () => {
    let seen: NodeJS.ProcessEnv | undefined
    const runner: BrowserCommandRunner = async (_args, options) => {
      seen = options.env
      return {
        exitCode: 0,
        stderr: '',
        stdout: JSON.stringify({
          success: true,
          data: { origin: 'https://example.test/', snapshot: '', refs: {}, removedRefs: [] },
          error: null,
        }),
      }
    }
    const browser = new AgentBrowserSession({
      owner: 'no-proxy',
      signal: new AbortController().signal,
      timeoutMs: 1_000,
      env: { HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9', AGENT_BROWSER_PROXY: 'http://127.0.0.1:9' },
      commandRunner: runner,
    })
    expect((await browser.open('https://example.test/')).status).toBe('success')
    expect(seen?.HTTP_PROXY).toBeUndefined()
    expect(seen?.HTTPS_PROXY).toBeUndefined()
    expect(seen?.AGENT_BROWSER_PROXY).toBeUndefined()
    expect(seen?.http_proxy).toBeUndefined()
  })

  it('rejects command timeouts above 30 seconds and profile paths', () => {
    const base = { owner: 'invalid-config', signal: new AbortController().signal }
    expect(() => new AgentBrowserSession({ ...base, timeoutMs: 30_001 })).toThrow(/no greater than 30000/)
    expect(() => new AgentBrowserSession({ ...base, timeoutMs: 30_000, profileName: '/home/user/Chrome' })).toThrow(/profile name, not a path/)
  })

  it('closes only the owning session and passes a profile name without enabling headed mode', async () => {
    const calls: Array<readonly string[]> = []
    const runner: BrowserCommandRunner = async args => {
      calls.push(args)
      return { exitCode: 0, stderr: '', stdout: JSON.stringify({
        success: true,
        data: args.includes('snapshot') ? { origin: 'about:blank', snapshot: '', refs: {}, removedRefs: [] } : {},
        error: null,
      }) }
    }
    const signal = new AbortController().signal
    const first = new AgentBrowserSession({ owner: 'isolation-a', session: 'shopswarm-isolation-a', profileName: 'Default', signal, timeoutMs: 1_000, commandRunner: runner })
    const second = new AgentBrowserSession({ owner: 'isolation-b', session: 'shopswarm-isolation-b', signal, timeoutMs: 1_000, commandRunner: runner })
    await first.open('https://example.test/')
    await second.open('https://example.test/')
    await first.close()
    expect(await first.snapshot()).toMatchObject({ status: 'failure' })
    expect(await second.snapshot()).toMatchObject({ status: 'success' })
    expect(calls[0]).toEqual(['--profile', 'Default', '--session', 'shopswarm-isolation-a', '--headed', 'false', '--json', 'open', 'https://example.test/'])
    expect(calls.filter(args => args.at(-1) === 'close')).toEqual([['--profile', 'Default', '--session', 'shopswarm-isolation-a', '--headed', 'false', '--json', 'close']])
  })

  it('does not retry an uncertain action and observes the page once', async () => {
    const commands: string[] = []
    let snapshotNumber = 0
    const runner: BrowserCommandRunner = async args => {
      const command = args[5] ?? ''
      commands.push(command)
      if (command === 'click') throw new Error('response channel closed')
      if (command === 'snapshot') {
        snapshotNumber += 1
        return {
          exitCode: 0,
          stderr: '',
          stdout: JSON.stringify({
            success: true,
            data: {
              origin: 'https://example.test/',
              snapshot: `- button "继续" [ref=e${snapshotNumber}]`,
              refs: { [`e${snapshotNumber}`]: { role: 'button', name: '继续' } },
              removedRefs: [],
            },
            error: null,
          }),
        }
      }
      return {
        exitCode: 0,
        stderr: '',
        stdout: JSON.stringify({ success: true, data: {}, error: null }),
      }
    }
    const browser = new AgentBrowserSession({
      owner: 'uncertain-test',
      signal: new AbortController().signal,
      timeoutMs: 1_000,
      commandRunner: runner,
    })

    const opened = await browser.open('https://example.test/')
    expect(opened.status).toBe('success')
    if (opened.status !== 'success' || opened.page === undefined) return
    const result = await browser.click(element(opened.page, 'button', '继续'))

    expect(result).toMatchObject({
      status: 'uncertain',
      action: 'click',
      page: { revision: 2 },
    })
    expect(commands).toEqual(['open', 'snapshot', 'click', 'snapshot'])
  })

  it('refreshes the page after the CLI reports an expired element reference', async () => {
    const calls: Array<readonly string[]> = []
    let snapshotNumber = 0
    const runner: BrowserCommandRunner = async args => {
      calls.push(args)
      const command = args[5]
      if (command === 'click') {
        return {
          exitCode: 1,
          stderr: '',
          stdout: JSON.stringify({ success: false, data: null, error: 'Unknown ref: e1' }),
        }
      }
      if (command === 'snapshot') {
        snapshotNumber += 1
        return {
          exitCode: 0,
          stderr: '',
          stdout: JSON.stringify({
            success: true,
            data: {
              origin: 'https://example.test/',
              snapshot: `- button "继续" [ref=e${snapshotNumber}]`,
              refs: { [`e${snapshotNumber}`]: { role: 'button', name: '继续' } },
              removedRefs: [],
            },
            error: null,
          }),
        }
      }
      return {
        exitCode: 0,
        stderr: '',
        stdout: JSON.stringify({ success: true, data: {}, error: null }),
      }
    }
    const browser = new AgentBrowserSession({
      owner: 'expired-ref-test',
      session: 'shopswarm-expired-ref',
      signal: new AbortController().signal,
      timeoutMs: 1_000,
      commandRunner: runner,
    })

    const opened = await browser.open('https://example.test/')
    expect(opened.status).toBe('success')
    if (opened.status !== 'success' || opened.page === undefined) return
    const result = await browser.click(element(opened.page, 'button', '继续'))

    expect(result).toMatchObject({
      status: 'failure',
      error: { code: 'stale_element_reference' },
      page: { revision: 2 },
    })
    expect(calls.map(args => args.slice(0, 2))).toEqual(Array(4).fill(['--session', 'shopswarm-expired-ref']))
    expect(calls.map(args => args[5])).toEqual(['open', 'snapshot', 'click', 'snapshot'])
  })
})
