import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it } from 'vitest'
import { apply, resolveRuntimePaths } from '../src/index.js'

const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(async ctx => ctx.fiber.dispose()))
})

async function setup(): Promise<Context> {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  apply(ctx)
  return ctx
}

describe('ShopSwarm host plugin', () => {
  it('registers and executes the diagnostic tool', async () => {
    const ctx = await setup()
    expect(ctx.tools.schemas().map(schema => schema.name)).toContain('shopswarm_diagnose')

    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('diagnose-test'),
      name: 'shopswarm_diagnose',
      arguments: { checkBrowser: false },
    })

    expect(result.isError).toBe(false)
    if (result.isError) return
    expect(result.value).toMatchObject({
      status: 'ok',
      nodeVersion: process.version,
      agentBrowserVersion: 'agent-browser 0.38.1',
      callId: 'diagnose-test',
      browserChecked: false,
    })
  })

  it('uses XDG directories when they are configured', () => {
    expect(resolveRuntimePaths({
      HOME: '/home/example',
      XDG_CONFIG_HOME: '/tmp/config',
      XDG_STATE_HOME: '/tmp/state',
      XDG_CACHE_HOME: '/tmp/cache',
    })).toEqual({
      configDir: '/tmp/config/shopswarm',
      stateDir: '/tmp/state/shopswarm',
      cacheDir: '/tmp/cache/shopswarm',
    })
  })

  it('rejects a background browse without DSH Agent identity', async () => {
    const ctx = await setup()
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('browse-missing-agent'),
      name: 'shopswarm_browse',
      arguments: { steps: '[{"action":"open","url":"https://example.com/"}]' },
    })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('requires DSH Agent identity')
  })

  it('registers single-site research and refuses to start it without Agent identity', async () => {
    const ctx = await setup()
    expect(ctx.tools.schemas().map(schema => schema.name)).toContain('shopswarm_research')
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('research-missing-agent'),
      name: 'shopswarm_research',
      arguments: {
        startUrl: 'https://example.com/', goal: '查找报价', model: '型号 A', specs: '[]', seller: '',
      },
    })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('requires DSH Agent identity')
  })

  it('does not create a browser without DSH Agent identity', async () => {
    const ctx = await setup()
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('missing-agent'),
      name: 'shopswarm_diagnose',
      arguments: { checkBrowser: true },
    })
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toContain('requires DSH Agent identity')
  })

  it('accepts Agent identity from the execution context', async () => {
    const ctx = await setup()
    const agent = { id: SessionId('test-agent') } as Agent
    const result = await ctx.tools.execute({
      signal: new AbortController().signal,
      callId: ToolCallId('agent-context'),
      name: 'shopswarm_diagnose',
      arguments: { checkBrowser: false },
      agent,
    })
    expect(result.isError).toBe(false)
    if (!result.isError) expect(result.value).toMatchObject({ agentId: 'test-agent' })
  })
})
