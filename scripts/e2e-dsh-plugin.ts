import { execFileSync } from 'node:child_process'
import { backgroundBrowserEnv } from '../src/direct-env.js'
// Local host-tool integration only; real CLI shopping cases use evaluate:shopping.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SkillRegistry from '@deepseek-ai/dsh-skill'
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
  process.stderr.write(`starting ${id}\n`)
  const started = performance.now()
  const result = await ctx.tools.execute({
    signal: AbortSignal.timeout(60_000),
    callId: ToolCallId(id),
    name,
    arguments: arguments_,
    agent,
  })
  process.stderr.write(`finished ${id} in ${Math.round(performance.now() - started)}ms\n`)
  if (result.isError) throw new Error(`${name} failed: ${JSON.stringify(result.content)}`)
  return result.value as Record<string, unknown>
}

try {
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  apply(ctx)
  const source = await call('shopswarm_browser', { action: 'open', startUrl: `${baseUrl}/`, goal: '读取测试页' }, 'open-source')
  assert.equal(source.status, 'ready')
  const cli = source.cli as { executable: string; args: string[]; env: NodeJS.ProcessEnv }
  const runCli = (args: string[]) => JSON.parse(execFileSync(cli.executable, [...cli.args, ...args], { encoding: 'utf8', env: { ...backgroundBrowserEnv(), ...cli.env } }))
  assert(runCli(['snapshot']).success)
  assert(runCli(['find', 'role', 'textbox', 'fill', '2TB 固态硬盘', '--name', '查询商品']).success)
  assert(runCli(['find', 'role', 'button', 'click', '--name', '搜索']).success)
  const observation = await call('shopswarm_browser', { action: 'observe', sessionId: source.sessionId }, 'observe-cli')
  assert(String(observation.pageExcerpt).includes('搜索结果：2TB 固态硬盘'))
  const closed = await call('shopswarm_browser', { action: 'close', sessionId: source.sessionId }, 'close-source')
  assert.equal(closed.status, 'closed')
  console.log(JSON.stringify({ sameSessionCliFallback: true, rawObservation: true, closed: true }))
} finally {
  await ctx.fiber.dispose()
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
}
