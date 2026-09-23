import { describe, expect, it } from 'vitest'
import { runParallelResearch } from '../src/research/parallel.js'

describe('parallel research result association', () => {
  it('keeps source metadata and local failures', async () => {
    const result = await runParallelResearch({
      taskId: 'task-1', agentId: 'agent-1', callId: 'call-1', signal: new AbortController().signal,
      sources: ['zhipu', 'xmodel'],
      run: async context => {
        expect(context.taskId).toBe('task-1')
        if (context.source === 'zhipu') throw new Error('captcha')
        return { listedPrice: { status: 'unknown' as const } }
      },
    })
    expect(result).toEqual([
      { taskId: 'task-1', agentId: 'agent-1', callId: 'call-1', source: 'zhipu', status: 'failed', error: 'Error: captcha' },
      { taskId: 'task-1', agentId: 'agent-1', callId: 'call-1', source: 'xmodel', status: 'success', value: { listedPrice: { status: 'unknown' } } },
    ])
  })

  it('propagates parent cancellation and waits for both children', async () => {
    const parent = new AbortController()
    const seen: string[] = []
    const resultPromise = runParallelResearch({
      taskId: 'task-2', agentId: 'agent-2', callId: 'call-2', signal: parent.signal,
      sources: ['a', 'b'],
      run: async context => await new Promise((_resolve, reject) => {
        context.signal.addEventListener('abort', () => { seen.push(context.source); reject(new Error('stopped')) }, { once: true })
      }),
    })
    parent.abort()
    const result = await resultPromise
    expect(seen.sort()).toEqual(['a', 'b'])
    expect(result.every(item => item.status === 'cancelled')).toBe(true)
  })
})
