import { execFileSync } from 'node:child_process'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { apply } from '../src/index.js'

const sourceUrl = 'https://www.apple.com/shop/buy-iphone/iphone-16'
const observedAt = new Date().toISOString()
const started = performance.now()
const ctx = new Context()
const agent = { id: SessionId('s6-live-source') } as Agent
const events: Record<string, unknown>[] = []

function focus(): string {
  if (!process.env.DISPLAY) return 'no-display'
  try {
    return execFileSync('xprop', ['-root', '_NET_ACTIVE_WINDOW'], { encoding: 'utf8', timeout: 3_000 }).trim()
  } catch {
    return 'unavailable'
  }
}

const focusBefore = focus()
async function call(name: string, args: Record<string, unknown>, id: string): Promise<Record<string, unknown>> {
  const callStarted = performance.now()
  const result = await ctx.tools.execute({
    signal: AbortSignal.timeout(120_000),
    callId: ToolCallId(id), name, arguments: args, agent,
  })
  if (result.isError) throw new Error(`${name}: ${JSON.stringify(result.content)}`)
  const value = result.value as Record<string, unknown>
  events.push({ tool: name, status: value.status, reasonCode: value.reasonCode,
    hasSession: typeof value.sessionId === 'string', pageUrl: value.pageUrl,
    elapsedMs: Math.round(performance.now() - callStarted) })
  return value
}

try {
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  apply(ctx)
  const first = await call('shopswarm_browser', { action: 'open', startUrl: sourceUrl, goal: '查看 Apple 商品页，不购买' }, 'live-open')
  assert(typeof first.sessionId === 'string', 'live source must retain the browser')
  await call('shopswarm_browser', { sessionId: first.sessionId, action: 'act', goal: '阅读当前页；无需操作时返回 DONE', maxSteps: 1 }, 'live-jev')
  await call('shopswarm_browser', { sessionId: first.sessionId, action: 'close' }, 'live-close')
} finally {
  await ctx.fiber.dispose()
  process.stdout.write(`${JSON.stringify({ sourceUrl, observedAt, events,
    elapsedMs: Math.round(performance.now() - started),
    browserMode: 'headed=false, auto-connect=false',
    focusBefore, focusAfter: focus(),
    proxyNames: Object.keys(process.env).filter(name => /proxy/i.test(name)),
  }, null, 2)}\n`)
}
