import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentBrowserSession, apply } from '../src/index.js'
import * as jev from '../src/jev.js'

const contexts: Context[] = []
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())); vi.restoreAllMocks() })
async function setup(capacity = 4) {
  const page = { session: 'unit-source', revision: 1, origin: 'https://example.test/item', tree: '- heading "Item"\n- text "398 €"', elements: [], removedRefs: [] }
  vi.spyOn(AgentBrowserSession.prototype, 'open').mockResolvedValue({ status: 'success', action: 'open', page })
  vi.spyOn(AgentBrowserSession.prototype, 'currentPage', 'get').mockReturnValue(page)
  vi.spyOn(AgentBrowserSession.prototype, 'snapshot').mockResolvedValue({ status: 'success', page })
  const close = vi.spyOn(AgentBrowserSession.prototype, 'close').mockResolvedValue({ status: 'success', action: 'close' })
  const ctx = new Context(); contexts.push(ctx)
  await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime); apply(ctx, { maxConcurrentBrowserTasks: capacity })
  let id = 0
  const invoke = (args: Record<string, unknown>, owner = 'source-1', signal = new AbortController().signal) => ctx.tools.execute({ signal, callId: ToolCallId(`test-${++id}`), name: 'shopswarm_browser', arguments: args, agent: { id: SessionId(owner) } as Agent })
  return { ctx, invoke, close }
}
const start = { action: 'open', startUrl: 'https://example.test/item', goal: 'read price' }
describe('single browser adapter', () => {
  it('registers one tool and returns only public CLI coordinates, not runtime credentials', async () => {
    const { ctx, invoke } = await setup()
    expect(ctx.tools.schemas().map(x => x.name)).toEqual(['shopswarm_browser'])
    const result = await invoke(start)
    expect(result.isError).toBe(false)
    expect(result.value).toMatchObject({ status: 'ready', ownerAgentId: 'source-1', handoff: { owner: 'caller' }, cli: { args: expect.arrayContaining(['--headed', 'false', '--auto-connect']) } })
    expect(Object.keys((result.value as any).cli.env).sort()).toEqual(['AGENT_BROWSER_CONFIG', 'AGENT_BROWSER_SOCKET_DIR'])
  })
  it('opens a URL without requiring a Jev goal', async () => {
    const { invoke } = await setup()
    const choose = vi.spyOn(jev, 'chooseAction')
    const result = await invoke({ action: 'open', startUrl: start.startUrl })
    expect(result.isError).toBe(false)
    expect(result.value).toMatchObject({ status: 'ready', steps: 0, cli: expect.any(Object) })
    expect(choose).not.toHaveBeenCalled()
  })
  it('protects ownership, describes busy slots and frees an explicitly closed session', async () => {
    const { invoke, close } = await setup(1)
    const id = (await invoke(start)).value as any
    expect((await invoke(start)).value).toMatchObject({ reasonCode: 'resource_busy', ownedSessions: [id.sessionId] })
    expect((await invoke(start, 'other')).value).toMatchObject({ ownedSessions: [] })
    expect((await invoke({ action: 'close', sessionId: id.sessionId }, 'other')).isError).toBe(true)
    expect(close).not.toHaveBeenCalled()
    expect((await invoke({ action: 'close', sessionId: id.sessionId })).value).toMatchObject({ status: 'closed' })
    expect((await invoke({ action: 'observe', sessionId: id.sessionId })).isError).toBe(true)
    expect((await invoke(start)).isError).toBe(false)
  })
  it('returns DONE as a hint, keeps the browser and has no report/checklist gate', async () => {
    const { invoke, close } = await setup()
    const choose = vi.spyOn(jev, 'chooseAction').mockImplementation(async request => jev.resolveAction({ answers: { operation: { choice: 'DONE' } } }, request, 1))
    const first = (await invoke({ ...start, action: 'act' })).value as any
    expect(first).toMatchObject({ status: 'ready', reasonCode: 'jev_done', steps: 1 })
    expect(first.report).toBeUndefined(); expect(close).not.toHaveBeenCalled(); expect(choose).toHaveBeenCalledOnce()
    expect((await invoke({ action: 'observe', sessionId: first.sessionId })).value).toMatchObject({ status: 'ready', cli: first.cli })
    expect((await invoke({ action: 'close', sessionId: first.sessionId })).value).toMatchObject({ status: 'closed' })
  })
  it('retains same-session CLI fallback after Jev failure', async () => {
    const { invoke, close } = await setup()
    vi.spyOn(jev, 'chooseAction').mockRejectedValue(new Error('gateway failed'))
    const first = (await invoke({ ...start, action: 'act' })).value as any
    expect(first).toMatchObject({ status: 'failed', reasonCode: 'jev_error', steps: 1, cli: expect.any(Object) })
    expect(close).not.toHaveBeenCalled()
    expect((await invoke({ action: 'observe', sessionId: first.sessionId })).value).toMatchObject({ status: 'ready', cli: first.cli })
  })
  it('classifies a post-decision snapshot failure as browser timeout and preserves Jev usage', async () => {
    const { invoke, close } = await setup()
    vi.spyOn(jev, 'chooseAction').mockImplementation(async request => {
      expect((request.payload.state as any).task.constraints.join(' ')).toContain('Read-only')
      vi.spyOn(AgentBrowserSession.prototype, 'snapshot').mockResolvedValue({ status: 'failure', error: { code: 'timeout', message: 'snapshot timed out' } })
      return jev.resolveAction({ answers: { operation: { choice: 'SCROLL_DOWN' } }, usage: { input_tokens: 100, output_tokens: 20 } }, request, 7)
    })
    const result = (await invoke({ ...start, action: 'act' })).value as any
    expect(result).toMatchObject({ status: 'failed', reasonCode: 'browser_timeout', metrics: { jevInputTokens: 100, jevOutputTokens: 20 }, cli: expect.any(Object) })
    expect(result.reason).toContain('snapshot timed out')
    expect(close).not.toHaveBeenCalled()
  })
  it('stops at the execution budget without making a semantic completion claim', async () => {
    const { invoke } = await setup()
    vi.spyOn(jev, 'chooseAction').mockImplementation(async request => jev.resolveAction({ answers: { operation: { choice: 'SCROLL_DOWN' } } }, request, 1))
    vi.spyOn(AgentBrowserSession.prototype, 'scroll').mockResolvedValue({ action: 'scroll', status: 'success' })
    const result = (await invoke({ ...start, action: 'act', maxSteps: 2 })).value as any
    expect(result).toMatchObject({ status: 'ready', steps: 2, metrics: { actionDecisionCalls: 2 } })
    expect(result.reason).toContain('step limit')
  })
  it('requires identity and validates inputs before acquiring resources', async () => {
    const { ctx, invoke, close } = await setup()
    expect((await ctx.tools.execute({ signal: new AbortController().signal, callId: ToolCallId('no-owner'), name: 'shopswarm_browser', arguments: start })).isError).toBe(true)
    expect((await invoke({ ...start, maxSteps: 0 })).isError).toBe(true)
    expect((await invoke({ ...start, textInputs: '{"e1":1}' })).isError).toBe(true)
    expect(close).not.toHaveBeenCalled()
  })
  it('cleans an active session on cancellation and releases capacity', async () => {
    const { invoke, close } = await setup(1)
    const first = (await invoke(start)).value as any
    const controller = new AbortController()
    vi.spyOn(AgentBrowserSession.prototype, 'snapshot').mockImplementation(async () => { controller.abort(); return { status: 'failure', error: { code: 'cancelled', message: 'cancelled' } } })
    await invoke({ action: 'observe', sessionId: first.sessionId }, 'source-1', controller.signal)
    expect(close).toHaveBeenCalledOnce()
  })
})
