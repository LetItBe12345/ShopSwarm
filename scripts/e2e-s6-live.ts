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
  const handoff = value.handoff as Record<string, unknown> | undefined
  events.push({ tool: name, status: value.status, reasonCode: value.reasonCode,
    handoffOwner: handoff?.owner, hasContinuation: typeof (handoff?.continuationId ?? value.continuationId) === 'string',
    pageUrl: value.pageUrl, completedSteps: value.completedSteps,
    elapsedMs: Math.round(performance.now() - callStarted) })
  return value
}

try {
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  apply(ctx)
  const first = await call('shopswarm_research', {
    startUrl: sourceUrl, goal: '核对 Apple iPhone 16 的 128GB 规格和公开价格，只读取页面',
    model: 'iPhone 16', specs: JSON.stringify([{ name: '容量', value: '128GB' }]), seller: 'Apple',
  }, 's6-live-research')
  const handoff = first.handoff as Record<string, unknown> | undefined
  const continuationId = handoff?.continuationId
  assert(typeof continuationId === 'string', 'live source did not enter the continuation handoff path')
  const browsed = await call('shopswarm_browse', {
    continuationId,
    steps: JSON.stringify([{ action: 'snapshot' }]),
  }, 's6-live-browse')
  assert.equal(browsed.status, 'ok')
  assert.equal(browsed.continuationId, continuationId)
  const resumed = await call('shopswarm_research', { continuationId }, 's6-live-resume')
  const resumedHandoff = resumed.handoff as Record<string, unknown> | undefined
  if (resumedHandoff?.owner === 'subagent') assert.equal(resumedHandoff.continuationId, continuationId)
} finally {
  await ctx.fiber.dispose()
  process.stdout.write(`${JSON.stringify({ sourceUrl, observedAt, events,
    elapsedMs: Math.round(performance.now() - started),
    browserMode: 'headed=false, auto-connect=false',
    focusBefore, focusAfter: focus(),
    proxyNames: Object.keys(process.env).filter(name => /proxy/i.test(name)),
  }, null, 2)}\n`)
}
