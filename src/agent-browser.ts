import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
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

function runLauncher(args: readonly string[], options: { signal?: AbortSignal; timeoutMs: number }): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [launcherPath, ...args],
      {
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
        signal: options.signal,
        timeout: options.timeoutMs,
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
  let opened = false
  try {
    const open = await runLauncher(
      ['--session', session, '--json', 'open', options.url],
      { signal: options.signal, timeoutMs: options.timeoutMs },
    )
    parseEnvelope(open.stdout, 'open')
    opened = true

    const snapshot = await runLauncher(
      ['--session', session, '--json', 'snapshot'],
      { signal: options.signal, timeoutMs: options.timeoutMs },
    )
    const markerFound = snapshotText(parseEnvelope(snapshot.stdout, 'snapshot')).includes(options.marker)
    if (!markerFound) throw new Error(`browser snapshot did not contain marker: ${options.marker}`)
    return { session, url: options.url, marker: options.marker, markerFound }
  } finally {
    if (opened) {
      await runLauncher(['--session', session, '--json', 'close'], { timeoutMs: options.timeoutMs })
    }
  }
}
