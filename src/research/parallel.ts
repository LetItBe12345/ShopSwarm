/** Result and lifecycle helpers for one multi-source research request. */
export interface SourceTaskContext {
  readonly taskId: string
  readonly agentId: string
  readonly callId: string
  readonly source: string
  readonly signal: AbortSignal
}

export interface SourceTaskResult<T> {
  readonly taskId: string
  readonly agentId: string
  readonly callId: string
  readonly source: string
  readonly status: 'success' | 'failed' | 'blocked' | 'cancelled'
  readonly value?: T
  readonly error?: string
}

export interface ParallelResearchOptions<T> {
  readonly taskId: string
  readonly agentId: string
  readonly callId: string
  readonly signal: AbortSignal
  readonly sources: readonly string[]
  readonly run: (context: SourceTaskContext) => Promise<T>
}

/**
 * Runs independent source calls with one child signal per source. A failed
 * source is recorded and does not reject the other calls. Parent cancellation
 * reaches every child and the function waits for all started work to stop.
 */
export async function runParallelResearch<T>(options: ParallelResearchOptions<T>): Promise<readonly SourceTaskResult<T>[]> {
  const children = options.sources.map(() => new AbortController())
  const forwardAbort = () => children.forEach(child => child.abort())
  if (options.signal.aborted) forwardAbort()
  else options.signal.addEventListener('abort', forwardAbort, { once: true })

  try {
    return await Promise.all(options.sources.map(async (source, index): Promise<SourceTaskResult<T>> => {
      const child = children[index]!
      const context = { taskId: options.taskId, agentId: options.agentId, callId: options.callId, source, signal: child.signal }
      try {
        const value = await options.run(context)
        return { taskId: context.taskId, agentId: context.agentId, callId: context.callId, source,
          status: child.signal.aborted ? 'cancelled' : 'success', ...(child.signal.aborted ? {} : { value }) }
      } catch (error) {
        return { taskId: context.taskId, agentId: context.agentId, callId: context.callId, source,
          status: child.signal.aborted ? 'cancelled' : 'failed', error: String(error) }
      }
    }))
  } finally {
    options.signal.removeEventListener('abort', forwardAbort)
  }
}
