import type { ShoppingTaskRun } from './run.js'

interface ShoppingRunEntry {
  readonly ownerAgentId: string
  readonly run: ShoppingTaskRun
  readonly releaseBrowser: () => void
  inUse: boolean
  expiry?: ReturnType<typeof setTimeout>
}

/** Retain suspended source runs until the same DSH Agent resumes or expires them. */
export class ShoppingRunRegistry {
  readonly #entries = new Map<string, ShoppingRunEntry>()

  constructor(readonly idleTimeoutMs: number) {
    if (!Number.isSafeInteger(idleTimeoutMs) || idleTimeoutMs <= 0) {
      throw new Error('continuationTimeoutMs must be a positive safe integer')
    }
  }

  get size(): number { return this.#entries.size }

  register(id: string, ownerAgentId: string, run: ShoppingTaskRun, releaseBrowser: () => void): void {
    if (!id || !ownerAgentId || !run.suspended) throw new Error('only suspended source runs can be registered')
    if (this.#entries.has(id)) throw new Error('continuationId is already registered')
    const entry: ShoppingRunEntry = { ownerAgentId, run, releaseBrowser, inUse: false }
    this.#entries.set(id, entry)
    this.#scheduleExpiry(id, entry)
  }

  claim(id: string, ownerAgentId: string): ShoppingTaskRun {
    const entry = this.#entries.get(id)
    if (!entry) throw new Error('continuationId is unknown or expired; the source browser session has been closed')
    if (entry.ownerAgentId !== ownerAgentId) throw new Error('continuationId belongs to a different DSH Agent')
    if (entry.inUse) throw new Error('continuationId is already in use')
    if (entry.expiry) clearTimeout(entry.expiry)
    delete entry.expiry
    entry.inUse = true
    return entry.run
  }

  release(id: string): void {
    const entry = this.#entries.get(id)
    if (!entry) return
    entry.inUse = false
    this.#scheduleExpiry(id, entry)
  }

  async finish(id: string): Promise<readonly string[]> {
    const entry = this.#entries.get(id)
    if (!entry) return []
    this.#entries.delete(id)
    if (entry.expiry) clearTimeout(entry.expiry)
    try {
      return await entry.run.close()
    } finally {
      entry.releaseBrowser()
    }
  }

  async dispose(): Promise<void> {
    const entries = [...this.#entries.entries()]
    this.#entries.clear()
    await Promise.allSettled(entries.map(async ([, entry]) => {
      if (entry.expiry) clearTimeout(entry.expiry)
      try {
        await entry.run.close()
      } finally {
        entry.releaseBrowser()
      }
    }))
  }

  #scheduleExpiry(id: string, entry: ShoppingRunEntry): void {
    entry.expiry = setTimeout(() => { void this.finish(id) }, this.idleTimeoutMs)
    entry.expiry.unref()
  }
}
