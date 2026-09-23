/** Limits browser-owning tool calls in one ShopSwarm host process. */
export class ResourceLimit {
  private active = 0
  private readonly waiting: Array<{
    signal: AbortSignal
    resolve: (release: () => void) => void
    reject: (error: Error) => void
    abort: () => void
  }> = []

  constructor(readonly maxConcurrent: number) {
    if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1) {
      throw new Error('maxConcurrentBrowserTasks must be a positive safe integer')
    }
  }

  get activeCount(): number { return this.active }
  get waitingCount(): number { return this.waiting.length }

  acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) return Promise.reject(new Error('browser resource wait cancelled'))
    if (this.active < this.maxConcurrent) {
      this.active += 1
      return Promise.resolve(this.releaseOnce())
    }
    return new Promise((resolve, reject) => {
      const entry = {
        signal, resolve, reject,
        abort: () => {
          const index = this.waiting.indexOf(entry)
          if (index >= 0) this.waiting.splice(index, 1)
          reject(new Error('browser resource wait cancelled'))
        },
      }
      this.waiting.push(entry)
      signal.addEventListener('abort', entry.abort, { once: true })
      if (signal.aborted) entry.abort()
    })
  }

  private releaseOnce(): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      for (;;) {
        const next = this.waiting.shift()
        if (!next) {
          this.active -= 1
          return
        }
        next.signal.removeEventListener('abort', next.abort)
        if (next.signal.aborted) {
          next.reject(new Error('browser resource wait cancelled'))
          continue
        }
        next.resolve(this.releaseOnce())
        return
      }
    }
  }
}
