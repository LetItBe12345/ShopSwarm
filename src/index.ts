import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-skill'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { AgentBrowserSession, createAgentBrowserSessionName, getAgentBrowserVersion, runBrowserSmoke } from './agent-browser.js'
import { runInteractiveTask } from './browser/interactive-task.js'
import { resolveRuntimePaths } from './runtime-paths.js'
import { ResourceLimit } from './resource-limit.js'
import { createShoppingTaskRun, type ShoppingTaskRun, type ShoppingResult, type JevDecisionTrace } from './shopping/run.js'
import { ShoppingRunRegistry } from './shopping/run-registry.js'
export { buildActionRequest, chooseAction, DEFAULT_JEV_BASE_URL, DEFAULT_JEV_MODEL, executeSelectedAction, resolveAction } from './jev.js'
export type { ActionRequest, RecentAction, SelectedAction, SemanticOperation, ShoppingTaskContext } from './jev.js'
export { resolveTextInput } from './text-input.js'
export type { TextInputMetrics, TextInputResult } from './text-input.js'
export { createShoppingTaskRun, runShoppingTask } from './shopping/run.js'
export type { HandoffOwner, ShoppingHandoff, ShoppingTask, ShoppingResult, ShoppingStatus, ShoppingReason, ShoppingTaskRun } from './shopping/run.js'

export interface Config {
  readonly commandTimeoutMs?: number
  readonly jevTimeoutMs?: number
  readonly maxConcurrentBrowserTasks?: number
  readonly continuationTimeoutMs?: number
}

/** One browser adapter; DSH owns delegation and product reasoning. */
export function apply(ctx: Context, config: Config = {}): void {
  const skillPath = fileURLToPath(new URL('../skills/shopping-research/SKILL.md', import.meta.url))
  ctx.skills.register({
    name: 'shopping-research',
    description: 'Use ShopSwarm for shopping research and price comparison. Page interactions go through Jev act first; CLI recovers only the current blocked step.',
    content: readFileSync(skillPath, 'utf8').replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim(),
    source: 'bundled',
    path: skillPath,
    resourceBase: { kind: 'directory', path: fileURLToPath(new URL('../skills/shopping-research/', import.meta.url)) },
  })
  const timeoutMs = config.commandTimeoutMs ?? 30_000
  const idleTimeoutMs = config.continuationTimeoutMs ?? 15 * 60_000
  const resources = new ResourceLimit(config.maxConcurrentBrowserTasks ?? 4)
  const sessions = new ShoppingRunRegistry(idleTimeoutMs)
  ctx.effect(() => async () => { await sessions.dispose() }, 'shopswarm browser sessions')
  ctx.tools.register(defineTool({
    name: 'shopswarm_browser',
    description: 'Persistent headless shopping browser. Use act FIRST for page interactions: clicking links/buttons, typing searches, selecting options, filtering, scrolling or going back. Jev chooses one concrete action; the adapter executes it. Do not bypass act with bash/CLI/eval interactions just because CLI coordinates are available. open/observe/read and read-only CLI inspect facts without Jev. CLI navigation to a known URL is allowed because act has no URL-navigation action. Interactive CLI fallback requires a failed/blocked/limited act for the current interaction or an unsupported action; state the reason, recover only that step, then return to act for later interactions. MORE_TARGETS auto-pages within maxSteps; one executed action returns for review. DONE is not shopping success. Delegate sources first; handles belong to the caller. close releases the session.',
    parameters: {
      sessionId: { type: 'string', description: 'Owned session ID from this tool. Omit for a new source; do not pass another Agent its handle.' },
      action: { type: 'string', description: 'act (default, required first for page interactions), open (inspect starting URL without Jev), observe (fresh snapshot), read (saved chunk), close.' },
      startUrl: { type: 'string', description: 'HTTP(S) starting URL, required for a new session. For an existing session navigate with its CLI.' },
      goal: { type: 'string', description: 'ONE concrete page interaction for Jev, required for act; optional for open. Example: click the Citybike link. Do not combine navigation, filtering and product research in one goal. Product meaning and final answer belong to the caller.' },
      maxSteps: { type: 'integer', description: 'Decision budget per call, default 4, maximum 12. MORE_TARGETS auto-pages; one actual action returns control. Limit preserves the browser.' },
      textInputs: { type: 'string', description: 'Optional JSON map of current ref/name to exact text input. No extra text model.' },
      targetOffset: { type: 'integer', description: 'Jev candidate batch offset when more_targets is returned.' },
      pageOffset: { type: 'integer', description: 'Page text offset for Jev context.' },
      snapshotId: { type: 'string', description: 'Saved observation ID for read, defaults to latest.' },
      offset: { type: 'integer', description: 'Read Unicode offset; follow nextOffset for remaining raw text.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      if (!exec.agent) throw new Error('shopswarm_browser requires DSH Agent identity')
      const agentId = String(exec.agent.id)
      const action = args.action ?? 'act'
      if (!['act', 'open', 'observe', 'read', 'close'].includes(action)) throw new Error('unknown browser action')
      const maxSteps = args.maxSteps ?? 4
      if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 12) throw new Error('maxSteps must be an integer from 1 to 12')
      let textInputs: Record<string, string> | undefined
      if (args.textInputs !== undefined) {
        const value: unknown = JSON.parse(args.textInputs)
        if (!value || typeof value !== 'object' || Array.isArray(value) || Object.values(value).some(item => typeof item !== 'string')) throw new Error('textInputs must map refs/names to strings')
        textInputs = value as Record<string, string>
      }
      if (action === 'act' && !args.goal?.trim()) throw new Error('act requires a concrete goal')
      let sessionId = args.sessionId
      let run: ShoppingTaskRun
      let initial: ShoppingResult | undefined
      if (sessionId !== undefined) {
        if (!sessionId.trim()) throw new Error('sessionId must be nonempty')
        if (args.startUrl !== undefined) throw new Error('use the existing session CLI to navigate; startUrl creates a new session')
        run = sessions.claim(sessionId, agentId)
        run.setSignal(exec.signal)
      } else {
        if (!['act', 'open'].includes(action)) throw new Error(`${action} requires sessionId`)
        if (!args.startUrl) throw new Error('new session requires startUrl')
        const release = resources.tryAcquire(exec.signal)
        if (!release) return { status: 'blocked', reasonCode: 'resource_busy', ownedSessions: sessions.ownedContinuations(agentId), reason: 'Browser capacity is occupied. Resume or close an owned session; another Agent must close its own session.' }
        sessionId = randomUUID()
        let created: ShoppingTaskRun | undefined
        try {
          created = createShoppingTaskRun({ startUrl: args.startUrl, goal: args.goal?.trim() || 'Observe the current page for the calling Agent.' }, {
            owner: `${agentId}:${sessionId}`, signal: exec.signal, timeoutMs,
            jevTimeoutMs: config.jevTimeoutMs ?? timeoutMs,
            createBrowser: owner => new AgentBrowserSession({ owner, signal: exec.signal, timeoutMs,
              socketDir: join(process.cwd(), 'runtime', 'shopswarm-browser'), }),
          })
          initial = await created.start()
          sessions.register(sessionId, agentId, created, release)
          run = sessions.claim(sessionId, agentId)
        } catch (error) { await created?.close(); release(); throw error }
      }
      try {
        if (action === 'close') {
          const errors = await sessions.finish(sessionId)
          return { status: errors.length ? 'failed' : 'closed', reasonCode: errors.length ? 'cleanup_failed' : 'session_closed', reason: errors.join('; ') || 'Browser closed; resource released.' }
        }
        let result = initial ?? (action === 'read' ? run.read(args.snapshotId, args.offset) : await run.resume())
        let steps = 0
        const trace: JevDecisionTrace[] = []
        let targetOffset = args.targetOffset
        if (action === 'act' && result.status === 'ready') {
          for (; steps < maxSteps; ) {
            result = await run.jev({ goal: args.goal!, ...(textInputs ? { textInputs } : {}),
              ...(targetOffset === undefined ? {} : { targetOffset }),
              ...(args.pageOffset === undefined ? {} : { pageOffset: args.pageOffset }) })
            steps++
            trace.push(...(result.trace ?? []))
            if (result.status !== 'ready' || result.reasonCode !== 'more_targets' || result.nextTargetOffset === undefined) break
            // A changed DOM resets the run's cursor before selecting a new batch.
            targetOffset = undefined
          }
          if (steps === maxSteps && result.reasonCode === 'more_targets') result = { ...result, reason: 'Jev decision limit reached. Same goal resumes at nextTargetOffset automatically; or use the same-session CLI.' }
        }
        return JSON.parse(JSON.stringify({ ...result, ...(action === 'act' ? { trace } : {}), sessionId, ownerAgentId: agentId, steps,
          cli: run.cliConnection, idleTimeoutMs,
          instruction: 'Next page interaction: call action=act with this sessionId and ONE concrete goal. Load shopping-research skill before continuing. CLI coordinates are not permission to bypass Jev. Read-only CLI inspection and navigation to a known URL are allowed. Interactive CLI may recover only the current failed/blocked/limited act or unsupported action; explain why, then return to act. Use the returned cli.executable, cli.args and cli.env EXACTLY; remove cli.unsetEnv first. Never invent a session/socket/config, launch a separate browser, or run CLI concurrently with this tool. A denied source is finished; choose a different store, not alternate URLs on the denied site. Judge live evidence yourself and close this session when finished.' }))
      } finally {
        if (exec.signal.aborted || !run.suspended) await sessions.finish(sessionId)
        else sessions.release(sessionId)
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
