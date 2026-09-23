import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const packageJsonPath = require.resolve('agent-browser/package.json')
const launcherPath = join(dirname(packageJsonPath), 'bin', 'agent-browser.js')

interface AgentBrowserEnvelope {
  readonly success?: boolean
  readonly data?: unknown
  readonly error?: string
}

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
        env: options.env,
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

function parseEnvelope(stdout: string, command: string): AgentBrowserEnvelope {
  let value: unknown
  try {
    value = JSON.parse(stdout)
  } catch (error) {
    throw new Error(`agent-browser ${command} returned invalid JSON`, { cause: error })
  }
  if (typeof value !== 'object' || value === null) {
    throw new Error(`agent-browser ${command} returned a non-object result`)
  }
  const envelope = value as AgentBrowserEnvelope
  if (envelope.success === false) {
    throw new Error(`agent-browser ${command} failed: ${envelope.error || 'unknown error'}`)
  }
  return envelope
}

function snapshotText(envelope: AgentBrowserEnvelope): string {
  const data = envelope.data
  if (typeof data === 'string') return data
  if (typeof data === 'object' && data !== null) {
    const snapshot = (data as Record<string, unknown>).snapshot
    if (typeof snapshot === 'string') return snapshot
  }
  return JSON.stringify(data)
}

export async function getAgentBrowserVersion(timeoutMs = 10_000): Promise<string> {
  const result = await runLauncher(['--version'], { timeoutMs })
  return result.stdout.trim()
}

export async function runBrowserSmoke(options: BrowserSmokeOptions): Promise<BrowserSmokeResult> {
  const suffix = createHash('sha256').update(options.owner).digest('hex').slice(0, 16)
  const session = `shopswarm-${suffix}`
  const disposableSocketDir = join(tmpdir(), 'shopswarm-agent-browser')
  const disposableSessionEnv = {
    ...process.env,
    AGENT_BROWSER_DEFAULT_TIMEOUT: String(Math.min(options.timeoutMs, 5_000)),
    AGENT_BROWSER_IDLE_TIMEOUT_MS: String(Math.min(options.timeoutMs, 5_000)),
    AGENT_BROWSER_SOCKET_DIR: disposableSocketDir,
  }
  // The headless DSH host force-exits five seconds after an interrupt. Start a
  // session-specific watchdog before browser work so cleanup still happens if
  // the host cannot finish the tool's finally block. Normal runs close first.
  scheduleDetachedClose(session, disposableSocketDir, 12_000, disposableSessionEnv)
  let opened = false
  let operationFailed = false
  try {
    const open = await runLauncher(
      ['--session', session, '--json', 'open', options.url],
      { signal: options.signal, timeoutMs: options.timeoutMs, env: disposableSessionEnv },
    )
    parseEnvelope(open.stdout, 'open')
    opened = true

    const snapshot = await runLauncher(
      ['--session', session, '--json', 'snapshot'],
      { signal: options.signal, timeoutMs: options.timeoutMs, env: disposableSessionEnv },
    )
    const markerFound = snapshotText(parseEnvelope(snapshot.stdout, 'snapshot')).includes(options.marker)
    if (!markerFound) throw new Error(`browser snapshot did not contain marker: ${options.marker}`)
    return { session, url: options.url, marker: options.marker, markerFound }
  } catch (error) {
    operationFailed = true
    throw error
  } finally {
    try {
      await runLauncher(
        ['--session', session, '--json', 'close'],
        { timeoutMs: options.timeoutMs, env: disposableSessionEnv },
      )
    } catch (closeError) {
      // An aborted or failed open may not have created a session. Preserve the
      // original error in that case. A known-open session must close cleanly.
      if (opened && !operationFailed) throw closeError
    }
  }
}
