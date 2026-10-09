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

const fixture = await readFile(fileURLToPath(new URL('../tests/fixtures/pages/smoke.html', import.meta.url)))
const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  response.end(fixture)
})

await new Promise<void>((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
})

const address = server.address()
if (address === null || typeof address === 'string') throw new Error('failed to obtain smoke server port')
const url = `http://127.0.0.1:${address.port}/`
const ctx = new Context()

try {
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(SkillRegistry)
  apply(ctx)
  const result = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: ToolCallId('browser-smoke'),
    name: 'shopswarm_browser',
    arguments: { action: 'open', startUrl: url, goal: '读取 smoke 页面' },
    agent: { id: SessionId('browser-smoke-agent') } as Agent,
  })
  if (result.isError) throw new Error(result.error.message)
  process.stdout.write(`${JSON.stringify(result.value, null, 2)}\n`)
} finally {
  await ctx.fiber.dispose()
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
}
