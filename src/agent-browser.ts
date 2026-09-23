import { execFile, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { AgentBrowserSession, createAgentBrowserSessionName } from './browser/agent-browser-session.js'
import { withoutProxy } from './direct-env.js'

const require = createRequire(import.meta.url)
const packageJsonPath = require.resolve('agent-browser/package.json')
const launcherPath = join(dirname(packageJsonPath), 'bin', 'agent-browser.js')

interface CommandResult {
  readonly stdout: string
  readonly stderr: string
}

export interface BrowserSmokeResult {
  readonly session: string
  readonly url: string
  readonly marker: string
  readonly markerFound: boolean
}

export interface BrowserSmokeOptions {
  readonly url: string
  readonly marker: string
  readonly owner: string
  readonly signal: AbortSignal
  readonly timeoutMs: number
}

function scheduleDetachedClose(
  session: string,
  socketDir: string,
  delayMs: number,
  env: NodeJS.ProcessEnv,
): void {
  const worker = [
    "const { readFileSync } = require('node:fs')",
    "const { join } = require('node:path')",
    'const [session, socketDir, delay] = process.argv.slice(1)',
    'setTimeout(() => {',
    '  try {',
    "    const pid = Number(readFileSync(join(socketDir, session + '.pid'), 'utf8').trim())",
    "    const environ = readFileSync('/proc/' + pid + '/environ', 'utf8').split('\\0')",
    "    if (environ.includes('AGENT_BROWSER_SESSION=' + session)",
    "      && environ.includes('AGENT_BROWSER_SOCKET_DIR=' + socketDir)) process.kill(pid, 'SIGTERM')",
    '  } catch {}',
    '}, Number(delay))',
  ].join(';')
  const child = spawn(
    process.execPath,
    ['-e', worker, session, socketDir, String(delayMs)],
    { detached: true, stdio: 'ignore', env },
  )
  child.unref()
}

function runLauncher(
  args: readonly string[],
  options: { signal?: AbortSignal; timeoutMs: number; env?: NodeJS.ProcessEnv },
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [launcherPath, ...args],
      {
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
        signal: options.signal,
        timeout: options.timeoutMs,
        env: withoutProxy(options.env ?? process.env),
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`agent-browser ${args.join(' ')} failed: ${stderr.trim() || error.message}`, { cause: error }))
          return
        }
        resolve({ stdout, stderr })
      },
    )
  })
}

export async function getAgentBrowserVersion(timeoutMs = 10_000): Promise<string> {
  const result = await runLauncher(['--version'], { timeoutMs })
  return result.stdout.trim()
}

export async function runBrowserSmoke(options: BrowserSmokeOptions): Promise<BrowserSmokeResult> {
  const session = createAgentBrowserSessionName(options.owner)
  const disposableSocketDir = join(tmpdir(), 'shopswarm-agent-browser')
  const disposableSessionEnv = withoutProxy({
    ...process.env,
    AGENT_BROWSER_DEFAULT_TIMEOUT: String(Math.min(options.timeoutMs, 5_000)),
    AGENT_BROWSER_IDLE_TIMEOUT_MS: String(Math.min(options.timeoutMs, 5_000)),
    AGENT_BROWSER_SOCKET_DIR: disposableSocketDir,
  })
  // The headless DSH host force-exits five seconds after an interrupt. Start a
  // session-specific watchdog before browser work so cleanup still happens if
  // the host cannot finish the tool's finally block. Normal runs close first.
  scheduleDetachedClose(session, disposableSocketDir, 12_000, disposableSessionEnv)
  const browser = new AgentBrowserSession({
    owner: options.owner,
    session,
    socketDir: disposableSocketDir,
    env: disposableSessionEnv,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
  })
  let opened = false
  let operationFailed = false
  try {
    const open = await browser.open(options.url)
    if (open.status !== 'success') throw new Error(`browser open failed: ${open.error.message}`)
    opened = true
    if (open.page === undefined) {
      throw new Error(`browser snapshot failed after open: ${open.observationError?.message ?? 'missing page state'}`)
    }
    const markerFound = open.page.tree.includes(options.marker)
    if (!markerFound) throw new Error(`browser snapshot did not contain marker: ${options.marker}`)
    return { session, url: options.url, marker: options.marker, markerFound }
  } catch (error) {
    operationFailed = true
    throw error
  } finally {
    const close = await browser.close()
    // An aborted or failed open may not have created a session. Preserve the
    // original error in that case. A known-open session must close cleanly.
    if (close.status !== 'success' && opened && !operationFailed) {
      throw new Error(`browser close failed: ${close.error.message}`)
    }
  }
}

export { AgentBrowserSession, createAgentBrowserSessionName }
export type {
  AgentBrowserSessionOptions,
  BrowserCommandOptions,
  BrowserCommandOutput,
  BrowserCommandRunner,
} from './browser/agent-browser-session.js'
export type {
  BrowserAction,
  BrowserActionResult,
  BrowserElementRef,
  BrowserError,
  BrowserPageState,
  BrowserScrollDirection,
  BrowserSnapshotResult,
  BrowserWaitCondition,
} from './browser/types.js'
