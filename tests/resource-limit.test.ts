import { describe, expect, it } from 'vitest'
import { ResourceLimit } from '../src/resource-limit.js'

describe('browser resource limit', () => {
  it('admits waiting calls in order without exceeding the configured cap', async () => {
    const limit = new ResourceLimit(2)
    const signal = new AbortController().signal
    const release1 = await limit.acquire(signal)
    const release2 = await limit.acquire(signal)
    const order: number[] = []
    const third = limit.acquire(signal).then(release => { order.push(3); return release })
    const fourth = limit.acquire(signal).then(release => { order.push(4); return release })
    expect([limit.activeCount, limit.waitingCount]).toEqual([2, 2])
    release1()
    release1()
    const release3 = await third
    expect([order, limit.activeCount, limit.waitingCount]).toEqual([[3], 2, 1])
    release2()
    const release4 = await fourth
    expect([order, limit.activeCount, limit.waitingCount]).toEqual([[3, 4], 2, 0])
    release3()
    release4()
    expect(limit.activeCount).toBe(0)
  })

  it('removes a cancelled waiter without consuming a slot', async () => {
    const limit = new ResourceLimit(1)
    const release = await limit.acquire(new AbortController().signal)
    const abort = new AbortController()
    const waiting = limit.acquire(abort.signal)
    abort.abort()
    await expect(waiting).rejects.toThrow('cancelled')
    expect(limit.waitingCount).toBe(0)
    release()
    expect(limit.activeCount).toBe(0)
  })

  it('rejects invalid limits and already-cancelled calls', async () => {
    expect(() => new ResourceLimit(0)).toThrow('positive safe integer')
    expect(() => new ResourceLimit(1.5)).toThrow('positive safe integer')
    const abort = new AbortController()
    abort.abort()
    await expect(new ResourceLimit(1).acquire(abort.signal)).rejects.toThrow('cancelled')
  })
})
