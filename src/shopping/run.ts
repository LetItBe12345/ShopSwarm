import { randomUUID } from 'node:crypto'
import { AgentBrowserSession } from '../browser/agent-browser-session.js'
import { runInteractiveSteps, type InteractiveStep, type InteractiveTaskResult } from '../browser/interactive-task.js'
import type { BrowserPageState } from '../browser/types.js'
import { buildActionRequest, chooseAction, executeSelectedAction, JevInputError, BrowserExecutionError } from '../jev.js'
import type { RecentAction } from '../jev.js'
import { pageTextChunk } from '../page-context.js'
import type { ProductSpec } from '../types.js'
interface SourceSnapshot { readonly snapshotId: string; readonly url: string; readonly observedAt: string; readonly revision: number; readonly tree: string }

export interface ShoppingTask {
  readonly startUrl: string
  readonly goal: string
  /** Legacy task context only; not compared with observed strings. */
  readonly model?: string
  readonly specs?: readonly ProductSpec[]
  readonly attributes?: readonly ProductSpec[]
  readonly seller?: string
  readonly constraints?: readonly string[]
  readonly textInputs?: Readonly<Record<string, string>>
}
export type ShoppingStatus = 'ready' | 'blocked' | 'failed' | 'cancelled'
export type ShoppingReason = 'agent_review' | 'jev_done' | 'jev_blocked' | 'more_targets' | 'jev_error' | 'text_required' | 'browser_error' | 'browser_timeout' | 'configuration_error' | 'context_error' | 'cancelled' | 'cleanup_failed'
export type HandoffOwner = 'caller'
export interface ShoppingHandoff { readonly owner: HandoffOwner; readonly reason: string; readonly instruction: string; readonly continuationId?: string }
export interface SourceObservation {
  readonly snapshotId: string
  readonly pageUrl: string
  readonly observedAt: string
  readonly pageRevision: number
  readonly pageExcerpt: string
  readonly offset: number
  readonly nextOffset?: number
  readonly totalLength: number
}
export interface ShoppingResult extends Partial<SourceObservation> {
  readonly status: ShoppingStatus
  readonly reasonCode: ShoppingReason
  readonly reason: string
  readonly userMessage: string
  readonly handoff?: ShoppingHandoff
  readonly nextTargetOffset?: number
  readonly authorAgentId?: string
  readonly decision?: string
  readonly cleanupError?: string
  readonly metrics: { actionDecisionCalls: number; browserActions: number; actionDecisionDurationMs: number; jevInputTokens: number | null; jevOutputTokens: number | null; maxJevRequestBytes: number }
}
export interface JevStepOptions { readonly goal?: string; readonly targetOffset?: number; readonly pageOffset?: number; readonly textInputs?: Readonly<Record<string, string>> }
export interface ShoppingRunOptions {
  readonly owner: string
  readonly signal: AbortSignal
  readonly timeoutMs: number
  readonly jevTimeoutMs?: number
  readonly maxJevTargets?: number
  readonly createBrowser?: (owner: string) => AgentBrowserSession
  readonly choose?: typeof chooseAction
}
export interface ShoppingTaskRun {
  readonly suspended: boolean
  readonly cliConnection: AgentBrowserSession['cliConnection']
  setSignal(signal: AbortSignal): void
  start(): Promise<ShoppingResult>
  browse(steps: readonly InteractiveStep[]): Promise<InteractiveTaskResult>
  resume(): Promise<ShoppingResult>
  read(snapshotId?: string, offset?: number): ShoppingResult
  jev(options?: JevStepOptions): Promise<ShoppingResult>
  close(): Promise<readonly string[]>
}

/** Source Agent owns all semantic decisions; this object owns execution and evidence. */
export function createShoppingTaskRun(task: ShoppingTask, options: ShoppingRunOptions): ShoppingTaskRun {
  const url = new URL(task.startUrl)
  if (!['http:', 'https:'].includes(url.protocol) || !task.goal.trim()) throw new Error('HTTP(S) startUrl and nonempty goal required')
  let signal = options.signal
  const browser = options.createBrowser?.(options.owner) ?? new AgentBrowserSession({ owner: options.owner, signal, timeoutMs: options.timeoutMs })
  const snapshots = new Map<string, SourceSnapshot>()
  let latest: SourceSnapshot | undefined
  let closed = false
  const history: RecentAction[] = []
  const metrics: ShoppingResult['metrics'] = { actionDecisionCalls: 0, browserActions: 0, actionDecisionDurationMs: 0, jevInputTokens: 0, jevOutputTokens: 0, maxJevRequestBytes: 0 }
  const capture = (page: BrowserPageState): void => {
    latest = { snapshotId: randomUUID(), url: page.origin, observedAt: new Date().toISOString(), revision: page.revision, tree: page.tree }
    snapshots.set(latest.snapshotId, latest)
  }
  const observation = (snapshot = latest, offset = 0): Partial<SourceObservation> => {
    if (!snapshot) return {}
    const { text, ...chunk } = pageTextChunk(snapshot.tree, offset)
    return { snapshotId: snapshot.snapshotId, pageUrl: snapshot.url, observedAt: snapshot.observedAt, pageRevision: snapshot.revision, pageExcerpt: text, ...chunk }
  }
  const output = (reasonCode: ShoppingReason = 'agent_review', reason = 'Browser observation only. Caller judges task completion and may continue with Jev or the same-session CLI.', status: ShoppingStatus = 'ready'): ShoppingResult => ({
    status, reasonCode, reason, userMessage: reason, ...observation(), metrics: { ...metrics },
    ...(!closed && !signal.aborted ? { handoff: { owner: 'caller' as const, reason: reasonCode, instruction: 'This session belongs to the calling DSH Agent. Use its CLI connection for fallback; summarize evidence to the Lead and close when done. Do not transfer the handle to another Agent.' } } : {}),
  })
  const ensureOpen = (): void => { if (closed) throw new Error('source session closed') }
  const close = async (): Promise<readonly string[]> => {
    if (closed) return []
    closed = true
    const result = await browser.close()
    return result.status === 'success' ? [] : [result.error.message]
  }
  const refresh = async (): Promise<ShoppingResult> => {
    ensureOpen()
    const result = await browser.snapshot({ compact: false })
    if (result.status !== 'success') return output(signal.aborted ? 'cancelled' : result.error.code === 'timeout' ? 'browser_timeout' : 'browser_error', result.error.message, signal.aborted ? 'cancelled' : 'failed')
    capture(result.page)
    return output()
  }
  return {
    get suspended() { return !closed && !signal.aborted },
    get cliConnection() { return browser.cliConnection },
    setSignal(value) { signal = value; browser.setSignal(value) },
    async start() {
      ensureOpen()
      const result = await browser.open(task.startUrl)
      metrics.browserActions++
      if (result.status !== 'success') {
        if (result.page) capture(result.page)
        return output(signal.aborted ? 'cancelled' : result.error.code === 'timeout' ? 'browser_timeout' : 'browser_error', result.error.message, signal.aborted ? 'cancelled' : 'failed')
      }
      return refresh()
    },
    resume: refresh,
    read(snapshotId, offset = 0) {
      ensureOpen()
      const snapshot = snapshotId ? snapshots.get(snapshotId) : latest
      if (!snapshot && snapshotId) throw new Error('snapshot is unknown or belongs to another source')
      if (!snapshot) return output()
      const { nextOffset: _previousOffset, ...base } = output()
      return { ...base, ...observation(snapshot, offset) }
    },
    async browse(steps) {
      ensureOpen()
      const result = await runInteractiveSteps({ browser, steps, refreshPage: true })
      metrics.browserActions += result.completedSteps
      // Always capture a full final observation; compact action results omit evidence.
      const shot = await browser.snapshot({ compact: false })
      if (shot.status === 'success') {
        capture(shot.page)
        return { ...result, page: shot.page, pageUrl: shot.page.origin, pageExcerpt: shot.page.tree }
      }
      if (result.page) capture(result.page)
      return { ...result, failedAction: result.failedAction || 'snapshot', detail: result.detail || shot.error.message }
    },
    async jev(step = {}) {
      ensureOpen()
      const refreshed = await refresh()
      if (refreshed.status !== 'ready') return refreshed
      const page = browser.currentPage!
      const request = buildActionRequest({ goal: step.goal ?? task.goal, constraints: ['Read-only research: do not buy, pay, place orders or bypass site protections.', ...(task.constraints ?? [])], doneWhen: ['Return control when this browser step is complete.'], progress: [],
        textInputs: step.textInputs ?? task.textInputs ?? {} }, page, history, undefined, {
          ...(options.maxJevTargets ? { maxTargets: options.maxJevTargets } : {}),
          ...(step.targetOffset === undefined ? {} : { targetOffset: step.targetOffset }),
          ...(step.pageOffset === undefined ? {} : { pageOffset: step.pageOffset }),
        })
      metrics.maxJevRequestBytes = Math.max(metrics.maxJevRequestBytes, Buffer.byteLength(JSON.stringify(request.payload)))
      let decisionReceived = false
      try {
        metrics.actionDecisionCalls++
        const selected = await (options.choose ?? chooseAction)(request, { signal, ...(options.jevTimeoutMs === undefined ? {} : { timeoutMs: options.jevTimeoutMs }) })
        decisionReceived = true
        metrics.actionDecisionDurationMs += selected.durationMs
        const usage = selected.usage as Record<string, unknown> | null
        const count = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null
        const input = count(usage?.input_tokens ?? usage?.prompt_tokens ?? usage?.inputTokens)
        const out = count(usage?.output_tokens ?? usage?.completion_tokens ?? usage?.outputTokens)
        metrics.jevInputTokens = input === null || metrics.jevInputTokens === null ? null : metrics.jevInputTokens + input
        metrics.jevOutputTokens = out === null || metrics.jevOutputTokens === null ? null : metrics.jevOutputTokens + out
        if (selected.operation === 'MORE_TARGETS') return { ...output('more_targets'), decision: selected.operation, ...(request.nextTargetOffset === undefined ? {} : { nextTargetOffset: request.nextTargetOffset }) }
        if (selected.operation === 'DONE' || selected.operation === 'BLOCKED') return { ...output(selected.operation === 'DONE' ? 'jev_done' : 'jev_blocked'), decision: selected.operation }
        const values = step.textInputs ?? task.textInputs ?? {}
        const text = selected.target ? values[selected.target.ref] ?? values[selected.target.name] : undefined
        if (selected.operation === 'TYPE_TEXT' && text === undefined) return output('text_required', 'Caller must supply textInputs or fill using the same-session CLI.')
        const acted = await executeSelectedAction(browser, selected, request, text)
        metrics.browserActions++
        const changed = await refresh()
        history.push({ operation: selected.operation, target: selected.target?.name ?? '', status: acted.status === 'success' ? 'success' : 'failure', pageChanged: latest?.tree !== page.tree })
        return acted.status === 'success' ? { ...changed, decision: selected.operation } : output('browser_error', 'error' in acted ? acted.error.message : 'browser step failed', 'failed')
      } catch (error) {
        if (!decisionReceived) { metrics.jevInputTokens = null; metrics.jevOutputTokens = null }
        return output(signal.aborted ? 'cancelled' : error instanceof BrowserExecutionError ? error.code === 'timeout' ? 'browser_timeout' : 'browser_error' : error instanceof JevInputError ? error.kind === 'configuration' ? 'configuration_error' : 'context_error' : 'jev_error', String(error), signal.aborted ? 'cancelled' : 'failed')
      }
    },
    close,
  }
}

/** One-shot observation helper. Host tools use the resumable run above. */
export async function runShoppingTask(task: ShoppingTask, options: ShoppingRunOptions): Promise<ShoppingResult> {
  const run = createShoppingTaskRun(task, options)
  try { return await run.start() } finally { await run.close() }
}
