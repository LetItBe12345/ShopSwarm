import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { apply } from '../src/index.js'

const fixture = await readFile(fileURLToPath(new URL('../tests/fixtures/pages/browser-actions.html', import.meta.url)))
const server = createServer((request, response) => {
  if (request.url === '/login') {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><html><body><h1>请登录</h1><label>密码<input type="password"></label><button>登录</button></body></html>')
    return
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  response.end(fixture)
})

await new Promise<void>((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
})

const address = server.address()
if (address === null || typeof address === 'string') throw new Error('test server has no address')
const baseUrl = `http://127.0.0.1:${address.port}`
const ctx = new Context()
const agent = { id: SessionId('e2e-dsh-agent') } as Agent
const call = async (name: string, arguments_: Record<string, unknown>, id: string) => {
  const result = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId(id),
    name,
    arguments: arguments_,
    agent,
  })
  if (result.isError) throw new Error(`${name} failed: ${JSON.stringify(result.content)}`)
  return result.value as Record<string, unknown>
}

try {
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  apply(ctx, { smokeUrl: `${baseUrl}/`, smokeMarker: '商品测试页' })

  const cases: Record<string, unknown> = {}

  cases.diagnose = await call('shopswarm_diagnose', { checkBrowser: true }, 'e2e-diagnose')
  assert.equal(cases.diagnose && (cases.diagnose as Record<string, unknown>).status, 'ok')

  cases.directBrowser = await call('shopswarm_browse', {
    steps: JSON.stringify([
      { action: 'open', url: `${baseUrl}/` },
      { action: 'snapshot' },
      { action: 'fill', role: 'textbox', name: '查询商品', value: '2TB 固态硬盘' },
      { action: 'click', role: 'button', name: '搜索' },
      { action: 'waitText', text: '搜索结果：2TB 固态硬盘' },
    ]),
  }, 'e2e-browse')
  assert.equal(cases.directBrowser && (cases.directBrowser as Record<string, unknown>).status, 'ok')

  cases.jevFallback = await call('shopswarm_research', {
    startUrl: `${baseUrl}/`,
    goal: '读取商品测试页的报价',
    model: '2TB 固态硬盘',
    specs: '[]',
    seller: '',
  }, 'e2e-jev-fallback')
  const jevHandoff = (cases.jevFallback as Record<string, unknown>).handoff as Record<string, unknown> | undefined
  assert.equal(jevHandoff?.owner, 'subagent')
  assert.ok(jevHandoff?.reason === 'jev_error' || jevHandoff?.reason === 'no_progress')
  assert.equal(jevHandoff?.instruction, expectHandoff('subagent', String(jevHandoff?.reason)).instruction)

  cases.leadHandoff = await call('shopswarm_research', {
    startUrl: `${baseUrl}/login`,
    goal: '读取商品报价',
    model: '2TB 固态硬盘',
    specs: '[]',
    seller: '',
  }, 'e2e-lead-handoff')
  assert.deepEqual((cases.leadHandoff as Record<string, unknown>).handoff, expectHandoff('lead', 'login_required'))

  process.stdout.write(`${JSON.stringify({ cases }, null, 2)}\n`)
} finally {
  await ctx.fiber.dispose()
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
}

function expectHandoff(owner: string, reason: string): Record<string, string> {
  return {
    owner,
    reason,
    instruction: owner === 'subagent'
      ? '当前来源的 Subagent 继续负责此来源。请使用 shopswarm_browse 读取最新页面并直接点击、填写、选择、滚动或返回；确认页面无法继续后，再把该来源交回 Lead。'
      : '当前来源无法由 Subagent 自动继续。请把该来源结果交回 Lead，由 Lead 请求登录、改换来源或重新分派 Subagent；不要把缺失字段当成成功。',
  }
}
