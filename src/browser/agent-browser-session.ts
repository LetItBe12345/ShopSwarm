import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type {
  BrowserAction,
  BrowserActionResult,
  BrowserElementRef,
  BrowserError,
  BrowserPageState,
  BrowserScrollDirection,
  BrowserSnapshotResult,
  BrowserWaitCondition,
} from './types.js'

const require = createRequire(import.meta.url)
const packageJsonPath = require.resolve('agent-browser/package.json')
const defaultLauncherPath = join(dirname(packageJsonPath), 'bin', 'agent-browser.js')
const MAX_COMMAND_TIMEOUT_MS = 30_000

interface AgentBrowserEnvelope {
  readonly success?: boolean
  readonly data?: unknown
  readonly error?: string | null
}

export interface BrowserCommandOutput {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

export interface BrowserCommandOptions {
  readonly env: NodeJS.ProcessEnv
  readonly signal?: AbortSignal
  readonly timeoutMs: number
}

export type BrowserCommandRunner = (
  args: readonly string[],
  options: BrowserCommandOptions,
) => Promise<BrowserCommandOutput>

export interface AgentBrowserSessionOptions {
  readonly owner: string
  readonly signal: AbortSignal
  readonly timeoutMs: number
  readonly profileName?: string
  readonly session?: string
  readonly socketDir?: string
  readonly env?: NodeJS.ProcessEnv
  readonly commandRunner?: BrowserCommandRunner
}

class CommandTransportError extends Error {}

function defaultCommandRunner(
  args: readonly string[],
  options: BrowserCommandOptions,
): Promise<BrowserCommandOutput> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [defaultLauncherPath, ...args],
      {
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
        signal: options.signal,
        timeout: options.timeoutMs,
        env: options.env,
      },
      (error, stdout, stderr) => {
        if (error && (error.name === 'AbortError' || error.killed || error.signal != null)) {
          reject(new CommandTransportError(stderr.trim() || error.message, { cause: error }))
          return
        }
        const exitCode = error && typeof error.code === 'number' ? error.code : 0
        resolve({ exitCode, stdout, stderr })
      },
    )
  })
}

export function createAgentBrowserSessionName(owner: string): string {
  const suffix = createHash('sha256').update(owner).digest('hex').slice(0, 16)
  return `shopswarm-${suffix}`
}

function error(code: BrowserError['code'], message: string): BrowserError {
  return { code, message }
}

function parseEnvelope(output: BrowserCommandOutput, command: string): AgentBrowserEnvelope {
  let value: unknown
  try {
    value = JSON.parse(output.stdout)
  } catch (cause) {
    throw new Error(`agent-browser ${command} returned invalid JSON`, { cause })
  }
  if (typeof value !== 'object' || value === null) {
    throw new Error(`agent-browser ${command} returned a non-object result`)
  }
  return value as AgentBrowserEnvelope
}

function commandError(envelope: AgentBrowserEnvelope, output: BrowserCommandOutput): string {
  if (typeof envelope.error === 'string' && envelope.error.length > 0) return envelope.error
  if (output.stderr.trim().length > 0) return output.stderr.trim()
  return `agent-browser exited with code ${output.exitCode}`
}

function isUnknownRef(message: string): boolean {
  return /unknown ref|element not found|page reloaded/i.test(message)
}

export class AgentBrowserSession {
  readonly session: string
  readonly socketDir: string
  readonly environment: NodeJS.ProcessEnv

  #currentPage: BrowserPageState | undefined
  #revision = 0
  #closed = false
  readonly #runner: BrowserCommandRunner
  readonly #signal: AbortSignal
  readonly #timeoutMs: number
  readonly #profileName: string | undefined

  constructor(options: AgentBrowserSessionOptions) {
    if (options.owner.trim().length === 0) throw new Error('browser session owner must not be empty')
    if (!Number.isInteger(options.timeoutMs) || options.timeoutMs <= 0 || options.timeoutMs > MAX_COMMAND_TIMEOUT_MS) {
      throw new Error('browser command timeout must be a positive integer no greater than 30000 ms')
    }
    if (options.profileName !== undefined && (options.profileName.length === 0 || /[\\/]/.test(options.profileName))) {
      throw new Error('browser profile must be a Chrome profile name, not a path')
    }
    this.session = options.session ?? createAgentBrowserSessionName(options.owner)
    this.socketDir = options.socketDir ?? join(tmpdir(), 'shopswarm-agent-browser')
    this.environment = {
      ...process.env,
      ...options.env,
      AGENT_BROWSER_SOCKET_DIR: this.socketDir,
    }
    this.#runner = options.commandRunner ?? defaultCommandRunner
    this.#signal = options.signal
    this.#timeoutMs = options.timeoutMs
    this.#profileName = options.profileName
  }

  get currentPage(): BrowserPageState | undefined {
    return this.#currentPage
  }

  async open(url: string): Promise<BrowserActionResult> {
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return this.#failure('open', error('invalid_argument', `invalid URL: ${url}`))
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return this.#failure('open', error('invalid_argument', `unsupported URL protocol: ${parsed.protocol}`))
    }
    return this.#perform('open', ['open', parsed.href])
  }

  async snapshot(): Promise<BrowserSnapshotResult> {
    if (this.#closed) {
      return { status: 'failure', error: error('command_failed', 'browser session is closed') }
    }
    try {
      const output = await this.#run(['snapshot', '--compact'], true)
      const envelope = parseEnvelope(output, 'snapshot')
      if (envelope.success !== true || output.exitCode !== 0) {
        return { status: 'failure', error: error('command_failed', commandError(envelope, output)) }
      }
      const page = this.#parsePage(envelope.data)
      this.#currentPage = page
      return { status: 'success', page }
    } catch (cause) {
      return {
        status: 'failure',
        error: error(
          this.#signal.aborted ? 'cancelled' : cause instanceof CommandTransportError ? 'transport_error' : 'invalid_result',
          cause instanceof Error ? cause.message : String(cause),
        ),
      }
    }
  }

  async click(target: BrowserElementRef): Promise<BrowserActionResult> {
    return this.#performTargeted('click', target, ['click', `@${target.ref}`])
  }

  async fill(target: BrowserElementRef, value: string): Promise<BrowserActionResult> {
    return this.#performTargeted('fill', target, ['fill', `@${target.ref}`, value])
  }

  async select(target: BrowserElementRef, values: readonly [string, ...string[]]): Promise<BrowserActionResult> {
    return this.#performTargeted('select', target, ['select', `@${target.ref}`, ...values])
  }

  async press(key: string): Promise<BrowserActionResult> {
    if (key.length === 0) return this.#failure('press', error('invalid_argument', 'key must not be empty'))
    return this.#perform('press', ['press', key])
  }

  async scroll(direction: BrowserScrollDirection, amount = 500): Promise<BrowserActionResult> {
    if (!Number.isInteger(amount) || amount <= 0) {
      return this.#failure('scroll', error('invalid_argument', 'scroll amount must be a positive integer'))
    }
    return this.#perform('scroll', ['scroll', direction, String(amount)])
  }

  async wait(condition: BrowserWaitCondition): Promise<BrowserActionResult> {
    if (condition.value.length === 0) {
      return this.#failure('wait', error('invalid_argument', 'wait value must not be empty'))
    }
    const flag = condition.kind === 'load' ? '--load' : condition.kind === 'text' ? '--text' : '--url'
    const args = ['wait', flag, condition.value]
    if (!Number.isInteger(condition.timeoutMs) || condition.timeoutMs <= 0 || condition.timeoutMs > this.#timeoutMs) {
      return this.#failure('wait', error('invalid_argument', `wait timeout must be a positive integer no greater than ${this.#timeoutMs} ms`))
    }
    args.push('--timeout', String(condition.timeoutMs))
    return this.#perform('wait', args, false)
  }

  async back(): Promise<BrowserActionResult> {
    return this.#perform('back', ['back'])
  }

  async close(): Promise<BrowserActionResult> {
    if (this.#closed) return { status: 'success', action: 'close' }
    try {
      const output = await this.#run(['close'], false)
      const envelope = parseEnvelope(output, 'close')
      if (envelope.success !== true || output.exitCode !== 0) {
        return this.#failure('close', error('command_failed', commandError(envelope, output)))
      }
      this.#closed = true
      this.#currentPage = undefined
      return { status: 'success', action: 'close' }
    } catch (cause) {
      return this.#failure('close', error('transport_error', cause instanceof Error ? cause.message : String(cause)))
    }
  }

  async #performTargeted(
    action: BrowserAction,
    target: BrowserElementRef,
    args: readonly string[],
  ): Promise<BrowserActionResult> {
    const targetError = this.#validateTarget(target)
    if (targetError !== undefined) return this.#failure(action, targetError, this.#currentPage)
    return this.#perform(action, args, true)
  }

  async #perform(
    action: BrowserAction,
    args: readonly string[],
    targetMayBecomeInvalid = false,
  ): Promise<BrowserActionResult> {
    if (this.#closed) return this.#failure(action, error('command_failed', 'browser session is closed'))
    if (this.#signal.aborted) return this.#failure(action, error('cancelled', 'browser task was cancelled'))

    let output: BrowserCommandOutput
    let envelope: AgentBrowserEnvelope
    try {
      output = await this.#run(args, true)
      envelope = parseEnvelope(output, action)
    } catch (cause) {
      return this.#uncertainWithObservation(
        action,
        error(
          this.#signal.aborted ? 'cancelled' : cause instanceof CommandTransportError ? 'transport_error' : 'invalid_result',
          cause instanceof Error ? cause.message : String(cause),
        ),
      )
    }

    if (envelope.success !== true || output.exitCode !== 0) {
      const message = commandError(envelope, output)
      if (targetMayBecomeInvalid && isUnknownRef(message) && !this.#signal.aborted) {
        const observation = await this.snapshot()
        if (observation.status === 'success') {
          return this.#failure(action, error('stale_element_reference', message), observation.page)
        }
        return this.#failure(action, error('stale_element_reference', message), undefined, observation.error)
      }
      return this.#failure(action, error('command_failed', message), this.#currentPage)
    }

    if (action === 'close') return { status: 'success', action }
    const observation = await this.snapshot()
    if (observation.status === 'success') return { status: 'success', action, page: observation.page }
    return { status: 'success', action, observationError: observation.error }
  }

  async #uncertainWithObservation(action: BrowserAction, actionError: BrowserError): Promise<BrowserActionResult> {
    if (this.#signal.aborted) return { status: 'uncertain', action, error: actionError }
    const observation = await this.snapshot()
    if (observation.status === 'success') {
      return { status: 'uncertain', action, error: actionError, page: observation.page }
    }
    return { status: 'uncertain', action, error: actionError, observationError: observation.error }
  }

  #validateTarget(target: BrowserElementRef): BrowserError | undefined {
    const current = this.#currentPage
    if (
      current === undefined
      || target.session !== this.session
      || target.pageRevision !== current.revision
      || !current.elements.some(element => element.ref === target.ref)
    ) {
      return error('stale_element_reference', `element @${target.ref} is not part of the current page snapshot`)
    }
    return undefined
  }

  #parsePage(data: unknown): BrowserPageState {
    if (typeof data !== 'object' || data === null) throw new Error('agent-browser snapshot data is not an object')
    const record = data as Record<string, unknown>
    if (typeof record.snapshot !== 'string') throw new Error('agent-browser snapshot is missing text')
    if (typeof record.origin !== 'string') throw new Error('agent-browser snapshot is missing origin')
    if (typeof record.refs !== 'object' || record.refs === null || Array.isArray(record.refs)) {
      throw new Error('agent-browser snapshot is missing refs')
    }

    const revision = this.#revision + 1
    const elements: BrowserElementRef[] = []
    for (const [ref, raw] of Object.entries(record.refs as Record<string, unknown>)) {
      if (!/^e\d+$/.test(ref) || typeof raw !== 'object' || raw === null) continue
      const metadata = raw as Record<string, unknown>
      elements.push({
        session: this.session,
        pageRevision: revision,
        ref: ref as `e${number}`,
        role: typeof metadata.role === 'string' ? metadata.role : '',
        name: typeof metadata.name === 'string' ? metadata.name : '',
      })
    }
    this.#revision = revision
    return {
      session: this.session,
      revision,
      origin: record.origin,
      tree: record.snapshot,
      elements,
      removedRefs: Array.isArray(record.removedRefs)
        ? record.removedRefs.filter((value): value is string => typeof value === 'string')
        : [],
    }
  }

  #failure(
    action: BrowserAction,
    actionError: BrowserError,
    page?: BrowserPageState,
    observationError?: BrowserError,
  ): BrowserActionResult {
    return {
      status: 'failure',
      action,
      error: actionError,
      ...(page === undefined ? {} : { page }),
      ...(observationError === undefined ? {} : { observationError }),
    }
  }

  #run(command: readonly string[], useSignal: boolean): Promise<BrowserCommandOutput> {
    const profileArgs = this.#profileName === undefined ? [] : ['--profile', this.#profileName]
    return this.#runner(
      [...profileArgs, '--session', this.session, '--json', ...command],
      {
        timeoutMs: this.#timeoutMs,
        env: this.environment,
        ...(useSignal ? { signal: this.#signal } : {}),
      },
    )
  }
}
