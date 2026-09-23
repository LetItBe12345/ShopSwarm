import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  AgentBrowserSession,
  createAgentBrowserSessionName,
  getAgentBrowserVersion,
  runBrowserSmoke,
} from './agent-browser.js'
import { resolveRuntimePaths } from './runtime-paths.js'

export interface Config {
  readonly smokeUrl?: string
  readonly smokeMarker?: string
  readonly commandTimeoutMs?: number
}

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
}

export {
  AgentBrowserSession,
  createAgentBrowserSessionName,
  getAgentBrowserVersion,
  resolveRuntimePaths,
  runBrowserSmoke,
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
