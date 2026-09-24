import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InteractiveTaskResult } from '../src/browser/interactive-task.js'
import type { ShoppingResult, ShoppingTaskRun } from '../src/shopping/run.js'
import { ShoppingRunRegistry } from '../src/shopping/run-registry.js'

function suspendedRun(onClose: () => void): ShoppingTaskRun {
  const result: ShoppingResult = {
    status: 'failed', reasonCode: 'jev_error', reason: 'timeout', userMessage: 'fallback',
    handoff: { owner: 'subagent', reason: 'jev_error', instruction: 'fallback' },
    progress: [], missing: [], pageUrl: 'https://example.test/', pageExcerpt: '',
    metrics: {
      actionDecisionCalls: 1, extractionCalls: 0, browserActions: 0,
      actionDecisionDurationMs: 0, extractionDurationMs: 0, textModelDurationMs: 0,
      extractionInputTokens: 0, extractionOutputTokens: 0,
    },
  }
  const browseResult: InteractiveTaskResult = {
    session: 'internal', completedSteps: 0, failedAction: '', detail: '', pageUrl: 'https://example.test/', pageExcerpt: '',
  }
  return {
    suspended: true,
    setSignal: () => {},
    start: async () => result,
    browse: async () => browseResult,
    resume: async () => result,
    close: async () => { onClose(); return [] },
  }
}

afterEach(() => vi.useRealTimers())

describe('ShoppingRunRegistry', () => {
  it('keeps a continuation bound to its source Agent until that Agent finishes it', async () => {
    const registry = new ShoppingRunRegistry(60_000)
    let closes = 0
    let releases = 0
    const run = suspendedRun(() => { closes += 1 })
    registry.register('continuation-1', 'agent-1', run, () => { releases += 1 })

    expect(() => registry.claim('continuation-1', 'agent-2')).toThrow('different DSH Agent')
    expect(registry.claim('continuation-1', 'agent-1')).toBe(run)
    expect(() => registry.claim('continuation-1', 'agent-1')).toThrow('already in use')
    registry.release('continuation-1')
    expect(await registry.finish('continuation-1')).toEqual([])
    expect(registry.size).toBe(0)
    expect(closes).toBe(1)
    expect(releases).toBe(1)
  })

  it('closes an abandoned continuation after its idle timeout', async () => {
    vi.useFakeTimers()
    const registry = new ShoppingRunRegistry(100)
    let closes = 0
    let releases = 0
    registry.register('continuation-1', 'agent-1', suspendedRun(() => { closes += 1 }), () => { releases += 1 })

    await vi.advanceTimersByTimeAsync(100)

    expect(registry.size).toBe(0)
    expect(closes).toBe(1)
    expect(releases).toBe(1)
  })
})
