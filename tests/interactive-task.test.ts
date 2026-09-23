import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { runInteractiveTask, type BrowserCommandRunner } from '../src/index.js'

function activeWindow(): string | undefined {
  if (process.env.DISPLAY === undefined || process.env.DISPLAY.length === 0) return undefined
  try {
    return execFileSync('xprop', ['-root', '_NET_ACTIVE_WINDOW'], { encoding: 'utf8', timeout: 2_000 }).trim()
  } catch {
    return undefined
  }
}

describe('interactive background browser task', () => {
  it('fills and clicks a local page without taking the foreground window', { timeout: 40_000 }, async () => {
    const html = await readFile(fileURLToPath(new URL('./fixtures/pages/browser-actions.html', import.meta.url)))
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(html)
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('fixture server has no port')
    const before = activeWindow()
    try {
      const result = await runInteractiveTask({
        owner: 'interactive-local',
        signal: new AbortController().signal,
        timeoutMs: 15_000,
        steps: [
          { action: 'open', url: `http://127.0.0.1:${address.port}/` },
          { action: 'fill', role: 'textbox', name: '查询商品', value: 'NVMe 2TB' },
          { action: 'click', role: 'button', name: '搜索' },
        ],
      })
      expect(result.failedAction).toBe('')
      expect(result.completedSteps).toBe(3)
      expect(result.pageExcerpt).toContain('搜索结果：NVMe 2TB')
      const after = activeWindow()
      if (before !== undefined && after !== undefined) expect(after).toBe(before)
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })

  it('keeps the session headless and off the terminal proxy', async () => {
    const commands: string[] = []
    let env: NodeJS.ProcessEnv | undefined
    const runner: BrowserCommandRunner = async (args, options) => {
      commands.push(args.join(' '))
      env = options.env
      const command = args[args.indexOf('--json') + 1]
      if (command === 'snapshot' || args.includes('snapshot')) {
        return {
          exitCode: 0,
          stderr: '',
          stdout: JSON.stringify({
            success: true,
            data: {
              origin: 'https://example.test/',
              snapshot: '- textbox "查询商品"\n- button "搜索"',
              refs: {
                e1: { role: 'textbox', name: '查询商品' },
                e2: { role: 'button', name: '搜索' },
              },
              removedRefs: [],
            },
            error: null,
          }),
        }
      }
      return { exitCode: 0, stderr: '', stdout: JSON.stringify({ success: true, data: {}, error: null }) }
    }
    const result = await runInteractiveTask({
      owner: 'interactive-flags',
      signal: new AbortController().signal,
      timeoutMs: 1_000,
      steps: [
        { action: 'open', url: 'https://example.test/' },
        { action: 'fill', role: 'textbox', name: '查询商品', value: 'NVMe' },
      ],
      commandRunner: runner,
    })
    expect(result.failedAction).toBe('')
    expect(commands.every(command => command.includes('--headed false --auto-connect false'))).toBe(true)
    expect(env?.HTTP_PROXY).toBeUndefined()
    expect(env?.AGENT_BROWSER_AUTO_CONNECT).toBeUndefined()
    expect(env?.AGENT_BROWSER_HEADED).toBeUndefined()
  })
})
