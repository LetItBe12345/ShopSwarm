import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  AgentBrowserSession,
  createAgentBrowserSessionName,
  getAgentBrowserVersion,
  runBrowserSmoke,
} from './agent-browser.js'
import { parseInteractiveSteps, runInteractiveTask } from './browser/interactive-task.js'
import { resolveRuntimePaths } from './runtime-paths.js'
import { ResourceLimit } from './resource-limit.js'
import { createShoppingTaskRun } from './shopping/run.js'
import type { ShoppingResult } from './shopping/run.js'
import type { ShoppingTaskRun } from './shopping/run.js'
import { ShoppingRunRegistry } from './shopping/run-registry.js'
export { buildActionRequest, chooseAction, DEFAULT_JEV_BASE_URL, DEFAULT_JEV_MODEL, executeSelectedAction, resolveAction } from './jev.js'
export type { ActionRequest, RecentAction, SelectedAction, SemanticOperation, ShoppingTaskContext } from './jev.js'
export { resolveTextInput } from './text-input.js'
export type { TextInputMetrics, TextInputResult } from './text-input.js'
export { createShoppingTaskRun, runShoppingTask } from './shopping/run.js'
export type { HandoffOwner, ShoppingHandoff, ShoppingTask, ShoppingResult, ShoppingStatus, ShoppingReason, ShoppingTaskRun } from './shopping/run.js'
export { checkObservedOffer, sameOfferIdentity } from './shopping/verify.js'
export type { OfferRequirements, ObservedFields, PageCheck } from './shopping/verify.js'

export interface Config {
  readonly smokeUrl?: string
  readonly smokeMarker?: string
  readonly commandTimeoutMs?: number
  /** Jev action-decision deadline. Defaults to the browser command timeout. */
  readonly jevTimeoutMs?: number
  /** Maximum simultaneous active or suspended source browser sessions in this DSH host process. */
  readonly maxConcurrentBrowserTasks?: number
  /** How long an idle Subagent continuation retains its browser session. */
  readonly continuationTimeoutMs?: number
}

const browseResultSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string' },
    continuationId: { type: 'string' },
    completedSteps: { type: 'integer' },
    failedAction: { type: 'string' },
    detail: { type: 'string' },
    pageUrl: { type: 'string' },
    pageExcerpt: { type: 'string' },
  },
} as const

const resultSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string' },
    nodeVersion: { type: 'string' },
    agentBrowserVersion: { type: 'string' },
    agentId: { type: 'string' },
    callId: { type: 'string' },
    configDir: { type: 'string' },
    stateDir: { type: 'string' },
    cacheDir: { type: 'string' },
    browserChecked: { type: 'boolean' },
    browserSession: { type: 'string' },
    browserUrl: { type: 'string' },
    marker: { type: 'string' },
    markerFound: { type: 'boolean' },
  },
} as const

const shoppingResultSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string' },
    reasonCode: { type: 'string' },
    reason: { type: 'string' },
    userMessage: { type: 'string' },
    progress: { type: 'array', items: { type: 'string' } },
    missing: { type: 'array', items: { type: 'string' } },
    pageUrl: { type: 'string' },
    pageExcerpt: { type: 'string' },
    handoff: { type: 'object', additionalProperties: true },
    offer: { type: 'object', additionalProperties: true },
    candidate: { type: 'object', additionalProperties: true },
    metrics: { type: 'object', additionalProperties: true },
    cleanupError: { type: 'string' },
  },
} as const

function parseSpecs(raw: string): readonly { name: string; value: string }[] {
  let value: unknown
  try { value = JSON.parse(raw) } catch { throw new Error('specs must be a JSON array') }
  if (!Array.isArray(value) || value.length > 20) throw new Error('specs must be an array with at most 20 items')
  return value.map((item, index) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new Error(`specs[${index}] must be an object`)
    const spec = item as Record<string, unknown>
    if (typeof spec.name !== 'string' || !spec.name.trim() || typeof spec.value !== 'string' || !spec.value.trim()) {
      throw new Error(`specs[${index}] needs nonempty name and value`)
    }
    return { name: spec.name, value: spec.value }
  })
}

function attachContinuation(result: ShoppingResult, continuationId: string): ShoppingResult {
  if (result.handoff?.owner !== 'subagent') throw new Error('only Subagent handoffs can retain a continuation')
  return { ...result, handoff: { ...result.handoff, continuationId } }
}

function mutableJson(value: ShoppingResult) {
  return JSON.parse(JSON.stringify(value))
}

export function apply(ctx: Context, config: Config = {}): void {
  const smokeUrl = config.smokeUrl ?? 'http://example.org/'
  const smokeMarker = config.smokeMarker ?? 'Example Domain'
  const commandTimeoutMs = config.commandTimeoutMs ?? 30_000
  const jevTimeoutMs = config.jevTimeoutMs ?? commandTimeoutMs
  const browserTasks = new ResourceLimit(config.maxConcurrentBrowserTasks ?? 1)
  const sourceRuns = new ShoppingRunRegistry(config.continuationTimeoutMs ?? 5 * 60_000)

  ctx.effect(() => async () => { await sourceRuns.dispose() }, 'shopswarm source browser sessions')

  ctx.tools.register(defineTool({
    name: 'shopswarm_diagnose',
    description: 'Check the ShopSwarm runtime and optionally verify a disposable agent-browser session.',
    parameters: {
      checkBrowser: {
        type: 'boolean',
        description: 'Open the configured smoke page, read its snapshot, and close the isolated browser session.',
      },
    },
    output: {
      schema: resultSchema,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      const paths = resolveRuntimePaths()
      const agentId = exec.agent ? String(exec.agent.id) : ''
      const callId = String(exec.callId)
      if (args.checkBrowser && !exec.agent) {
        throw new Error('shopswarm_diagnose requires DSH Agent identity before creating a browser session')
      }
      const release = args.checkBrowser ? await browserTasks.acquire(exec.signal) : undefined
      try {
        const browser = args.checkBrowser
          ? await runBrowserSmoke({
              url: smokeUrl,
              marker: smokeMarker,
              owner: `${agentId}:${callId}`,
              signal: exec.signal,
              timeoutMs: commandTimeoutMs,
            })
          : undefined

        return {
          status: 'ok',
          nodeVersion: process.version,
          agentBrowserVersion: await getAgentBrowserVersion(commandTimeoutMs),
          agentId,
          callId,
          configDir: paths.configDir,
          stateDir: paths.stateDir,
          cacheDir: paths.cacheDir,
          browserChecked: browser !== undefined,
          browserSession: browser?.session ?? '',
          browserUrl: browser?.url ?? '',
          marker: browser?.marker ?? '',
          markerFound: browser?.markerFound ?? false,
        }
      } finally {
        release?.()
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'shopswarm_browse',
    description: 'Temporary recovery tool for the current source Subagent after Jev fails or cannot progress. Requires the continuationId from shopswarm_research and continues in that same background browser session. After the page is usable, pass the same continuationId to shopswarm_research to resume Jev.',
    parameters: {
      continuationId: {
        type: 'string',
        required: true,
        description: 'The continuationId returned by this source\'s shopswarm_research handoff.',
      },
      steps: {
        type: 'string',
        required: true,
        description: 'JSON array of explicit actions for the current page. It has no fixed action-count limit. Actions: open, snapshot, click, fill, select, press, scroll, back, waitText. click, fill and select use role and name from the latest snapshot; fill and select also use value. scroll uses direction and optional amount.',
      },
    },
    output: {
      schema: browseResultSchema,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      if (!exec.agent) throw new Error('shopswarm_browse requires DSH Agent identity')
      if (typeof args.continuationId !== 'string' || args.continuationId.length === 0) throw new Error('continuationId is required')
      if (typeof args.steps !== 'string') throw new Error('steps must be a JSON array')
      let parsed: unknown
      try {
        parsed = JSON.parse(args.steps)
      } catch {
        throw new Error('steps must be a JSON array')
      }
      const steps = parseInteractiveSteps(parsed)
      if (typeof steps === 'string') throw new Error(steps)
      const continuationId = args.continuationId
      const run = sourceRuns.claim(continuationId, String(exec.agent.id))
      let finish = false
      try {
        run.setSignal(exec.signal)
        const browsed = await run.browse(steps)
        finish = exec.signal.aborted
        return {
          status: browsed.failedAction === '' ? 'ok' : 'failed',
          continuationId,
          completedSteps: browsed.completedSteps,
          failedAction: browsed.failedAction,
          detail: browsed.detail,
          pageUrl: browsed.pageUrl,
          pageExcerpt: browsed.pageExcerpt,
        }
      } finally {
        if (finish) await sourceRuns.finish(continuationId)
        else sourceRuns.release(continuationId)
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'shopswarm_research',
    description: 'Start one source research with Jev as the default action selector, or resume a suspended source using continuationId. On Jev timeout, invalid action, or no progress, the current source Subagent may use shopswarm_browse on the same browser session and then resume Jev. Browser errors, login, captcha, rate limits, and unverifiable results do not trigger Subagent browser fallback. Do not buy or pay.',
    parameters: {
      continuationId: { type: 'string', description: 'Resume a suspended source run. When supplied, omit startUrl, goal, model, specs and seller.' },
      startUrl: { type: 'string', description: 'Required when starting a source. Concrete HTTP(S) product or pricing page URL, not a homepage, search result, or forum thread.' },
      goal: { type: 'string', description: 'Required when starting a source. One narrow page goal for one product and one seller, such as reading its monthly listed price.' },
      model: { type: 'string', description: 'Required when starting a source. Exact product model or model id required by the task.' },
      specs: { type: 'string', description: 'Required when starting a source. JSON array of required specs, e.g. [{"name":"容量","value":"2TB"}] or [{"name":"计费","value":"按量"}]. Use [] if none.' },
      seller: { type: 'string', description: 'Optional seller or provider when starting a source.' },
    },
    output: {
      schema: shoppingResultSchema,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      if (!exec.agent) throw new Error('shopswarm_research requires DSH Agent identity')
      const agentId = String(exec.agent.id)
      if (args.continuationId !== undefined) {
        if (typeof args.continuationId !== 'string' || args.continuationId.length === 0) throw new Error('continuationId must be a nonempty string')
        if (args.startUrl !== undefined || args.goal !== undefined || args.model !== undefined || args.specs !== undefined || args.seller !== undefined) {
          throw new Error('resume with continuationId only; do not include new source parameters')
        }
        const continuationId = args.continuationId
        const run = sourceRuns.claim(continuationId, agentId)
        let finish = false
        try {
          run.setSignal(exec.signal)
          const resumed = await run.resume()
          finish = !run.suspended || exec.signal.aborted
          return mutableJson(run.suspended && !exec.signal.aborted ? attachContinuation(resumed, continuationId) : resumed)
        } finally {
          if (finish) await sourceRuns.finish(continuationId)
          else sourceRuns.release(continuationId)
        }
      }
      if (typeof args.startUrl !== 'string' || typeof args.goal !== 'string'
        || typeof args.model !== 'string' || typeof args.specs !== 'string'
        || (args.seller !== undefined && typeof args.seller !== 'string')) {
        throw new Error('startUrl, goal, model and specs are required when starting a source')
      }
      const task = {
        startUrl: args.startUrl,
        goal: args.goal,
        model: args.model,
        specs: parseSpecs(args.specs),
        ...(args.seller?.trim() ? { seller: args.seller } : {}),
      }
      const release = await browserTasks.acquire(exec.signal)
      const continuationId = randomUUID()
      let run: ShoppingTaskRun | undefined
      let retained = false
      try {
        run = createShoppingTaskRun(task, {
          owner: `${agentId}:${continuationId}`,
          signal: exec.signal,
          timeoutMs: commandTimeoutMs,
          jevTimeoutMs,
          profileName: 'Default',
        })
        const started = await run.start()
        if (run.suspended && !exec.signal.aborted) {
          sourceRuns.register(continuationId, agentId, run, release)
          retained = true
          return mutableJson(attachContinuation(started, continuationId))
        }
        return mutableJson(started)
      } finally {
        if (!retained) {
          await run?.close()
          release()
        }
      }
    },
  }))
}

export {
  AgentBrowserSession,
  createAgentBrowserSessionName,
  getAgentBrowserVersion,
  resolveRuntimePaths,
  runBrowserSmoke,
  runInteractiveTask,
}
export type {
  AgentBrowserSessionOptions,
  BrowserAction,
  BrowserActionResult,
  BrowserCommandOptions,
  BrowserCommandOutput,
  BrowserCommandRunner,
  BrowserElementRef,
  BrowserError,
  BrowserPageState,
  BrowserScrollDirection,
  BrowserSnapshotResult,
  BrowserWaitCondition,
} from './agent-browser.js'
export { validateOffer } from './types.js'
export type {
  Evidence,
  FeeItem,
  FeeKind,
  KnownOrUnknown,
  Money,
  Offer,
  OfferField,
  ProductIdentity,
  ProductSpec,
} from './types.js'
