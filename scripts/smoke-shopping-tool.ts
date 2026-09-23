import { createServer } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { apply } from '../src/index.js'

const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  response.end('<!doctype html><html lang="zh-CN"><body><h1>请登录</h1><label>密码<input type="password"></label><button>登录</button></body></html>')
})
await new Promise<void>((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
})
const ctx = new Context()
try {
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  apply(ctx)
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('server has no port')
  const result = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId('m22-login-smoke'),
    name: 'shopswarm_research',
    arguments: {
      startUrl: `http://127.0.0.1:${address.port}/login`,
      goal: '读取 示例型号 的标价', model: '示例型号', specs: '[]', seller: '',
    },
    agent: { id: SessionId('m22-test-agent') } as Agent,
  })
  if (result.isError) throw new Error(`DSH tool error: ${JSON.stringify(result.content)}`)
  const value = result.value as { status?: string; reasonCode?: string; userMessage?: string }
  console.log(JSON.stringify({ status: value.status, reasonCode: value.reasonCode, hasLoginMessage: Boolean(value.userMessage) }))
  if (value.status !== 'blocked' || value.reasonCode !== 'login_required' || !value.userMessage) process.exitCode = 1
} finally {
  await ctx.fiber.dispose()
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
}
