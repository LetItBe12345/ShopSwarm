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
import { runShoppingTask } from './shopping/run.js'
export { buildActionRequest, chooseAction, DEFAULT_JEV_BASE_URL, DEFAULT_JEV_MODEL, executeSelectedAction, resolveAction } from './jev.js'
export type { ActionRequest, RecentAction, SelectedAction, SemanticOperation, ShoppingTaskContext } from './jev.js'
export { resolveTextInput } from './text-input.js'
export type { TextInputMetrics, TextInputResult } from './text-input.js'
export { runShoppingTask } from './shopping/run.js'
export type { ShoppingTask, ShoppingResult, ShoppingStatus, ShoppingReason } from './shopping/run.js'
export { checkObservedOffer, sameOfferIdentity } from './shopping/verify.js'
export type { OfferRequirements, ObservedFields, PageCheck } from './shopping/verify.js'

export interface Config {
  readonly smokeUrl?: string
  readonly smokeMarker?: string
  readonly commandTimeoutMs?: number
  /** Maximum simultaneous browser-owning tool calls in this DSH host process. */
  readonly maxConcurrentBrowserTasks?: number
}

const browseResultSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string' },
    session: { type: 'string' },
    completedSteps: { type: 'integer' },
    failedAction: { type: 'string' },
    detail: { type: 'string' },
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

export function apply(ctx: Context, config: Config = {}): void {
  const smokeUrl = config.smokeUrl ?? 'https://example.com/'
  const smokeMarker = config.smokeMarker ?? 'Example Domain'
  const commandTimeoutMs = config.commandTimeoutMs ?? 30_000
  const browserTasks = new ResourceLimit(config.maxConcurrentBrowserTasks ?? 2)

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
    description: 'Run interactive browser actions in a background headless Chrome session. Does not attach to the user\'s open browser and does not use Jev.',
    parameters: {
      steps: {
        type: 'string',
        description: 'JSON array of 1 to 8 actions. Each item has action open, snapshot, click, fill, press, or waitText. open uses url. click and fill use role and name from the latest snapshot. fill also uses value. press uses key. waitText uses text and timeoutMs.',
      },
    },
    output: {
      schema: browseResultSchema,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      if (!exec.agent) throw new Error('shopswarm_browse requires DSH Agent identity before creating a browser session')
      if (typeof args.steps !== 'string') throw new Error('steps must be a JSON array')
      let parsed: unknown
      try {
        parsed = JSON.parse(args.steps)
      } catch {
        throw new Error('steps must be a JSON array')
      }
      const steps = parseInteractiveSteps(parsed)
      if (typeof steps === 'string') throw new Error(steps)
      const release = await browserTasks.acquire(exec.signal)
      try {
        const result = await runInteractiveTask({
          owner: `${String(exec.agent.id)}:${String(exec.callId)}`,
          signal: exec.signal,
          timeoutMs: commandTimeoutMs,
          steps,
        })
        return {
          status: result.failedAction === '' ? 'ok' : 'failed',
          session: result.session,
          completedSteps: result.completedSteps,
          failedAction: result.failedAction,
          detail: result.detail,
          pageExcerpt: result.pageExcerpt,
        }
      } finally {
        release()
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'shopswarm_research',
    description: 'Verify one candidate page for a shopping-research subtask with Jev and an independent replay. A DSH/Lead Agent may derive this subtask from a natural-language shopping request. The current M2 compatibility contract still requires an exact target label plus optional specs/seller. Returns login, captcha, rate-limit, or no-progress reasons. Does not buy or pay.',
    parameters: {
      startUrl: { type: 'string', description: 'HTTP(S) site or product URL.' },
      goal: { type: 'string', description: 'Page goal supplied by the caller, such as a product price or a listed token price.' },
      model: { type: 'string', description: 'Exact product model or model id required by the task.' },
      specs: { type: 'string', description: 'JSON array of required specs, e.g. [{"name":"容量","value":"2TB"}] or [{"name":"计费","value":"按量"}]. Use [] if none.' },
      seller: { type: 'string', description: 'Required seller or provider, or empty string when unspecified.' },
    },
    output: {
      schema: shoppingResultSchema,
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      if (!exec.agent) throw new Error('shopswarm_research requires DSH Agent identity')
      if (typeof args.startUrl !== 'string' || typeof args.goal !== 'string'
        || typeof args.model !== 'string' || typeof args.specs !== 'string') {
        throw new Error('startUrl, goal, model and specs are required')
      }
      const task = {
        startUrl: args.startUrl,
        goal: args.goal,
        model: args.model,
        specs: parseSpecs(args.specs),
        ...(args.seller?.trim() ? { seller: args.seller } : {}),
      }
      const release = await browserTasks.acquire(exec.signal)
      try {
        const result = await runShoppingTask(task, {
          owner: `${String(exec.agent.id)}:${String(exec.callId)}`,
          signal: exec.signal,
          timeoutMs: commandTimeoutMs,
          profileName: 'Default',
        })
        // DSH's JSON Schema output is mutable JSON; remove TypeScript readonly markers at the tool boundary.
        return JSON.parse(JSON.stringify(result))
      } finally {
        release()
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
