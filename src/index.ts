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
export { buildActionRequest, chooseAction, executeSelectedAction, resolveAction } from './jev.js'
export type { ActionRequest, RecentAction, SelectedAction, SemanticOperation, ShoppingTaskContext } from './jev.js'
export { resolveTextInput } from './text-input.js'
export type { TextInputMetrics, TextInputResult } from './text-input.js'

export interface Config {
  readonly smokeUrl?: string
  readonly smokeMarker?: string
  readonly commandTimeoutMs?: number
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

export function apply(ctx: Context, config: Config = {}): void {
  const smokeUrl = config.smokeUrl ?? 'https://example.com/'
  const smokeMarker = config.smokeMarker ?? 'Example Domain'
  const commandTimeoutMs = config.commandTimeoutMs ?? 30_000

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
