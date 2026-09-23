import assert from 'node:assert/strict'
import { execFile, spawn } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const dshPackagePath = require.resolve('@deepseek-ai/dsh/package.json')
const dshPackage = require(dshPackagePath) as { bin: { dsh: string } }
const dshBin = join(dirname(dshPackagePath), dshPackage.bin.dsh)
const agentBrowserPackagePath = require.resolve('agent-browser/package.json')
const agentBrowserBin = join(dirname(agentBrowserPackagePath), 'bin', 'agent-browser.js')
const projectDir = process.cwd()

interface CommandResult {
  readonly stdout: string
  readonly stderr: string
  readonly exitCode: number
}

interface JsonEvent {
  readonly type?: string
  readonly tool?: string
  readonly status?: string
  readonly result?: string
  readonly text?: string
  readonly reason?: unknown
}

function execute(
  file: string,
  args: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    execFile(file, [...args], {
      cwd: options.cwd ?? projectDir,
      env: options.env ?? process.env,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
      timeout: options.timeoutMs ?? 120_000,
    }, (error, stdout, stderr) => {
      const exitCode = error && typeof error === 'object' && 'code' in error && typeof error.code === 'number'
        ? error.code
        : error ? 1 : 0
      resolve({ stdout, stderr, exitCode })
    })
  })
}

async function executeOk(
  file: string,
  args: readonly string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number } = {},
): Promise<CommandResult> {
  const result = await execute(file, args, options)
  if (result.exitCode !== 0) {
    throw new Error(`${file} ${args.join(' ')} failed (${result.exitCode}): ${result.stderr || result.stdout}`)
  }
  return result
}

function parseJsonLines(stdout: string): JsonEvent[] {
  return stdout.split('\n').flatMap(line => {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) return []
    return [JSON.parse(trimmed) as JsonEvent]
  })
}

async function runDsh(task: string, env: NodeJS.ProcessEnv): Promise<JsonEvent[]> {
  const result = await executeOk(process.execPath, [dshBin, '--profile', 'headless', '--json', task], {
    env,
    timeoutMs: 180_000,
  })
  return parseJsonLines(result.stdout)
}

function startCancelledDsh(task: string, env: NodeJS.ProcessEnv): Promise<{ events: JsonEvent[]; exitCode: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [dshBin, '--profile', 'headless', '--json', task],
      { cwd: projectDir, env, stdio: ['ignore', 'pipe', 'pipe'] },
    )
    const events: JsonEvent[] = []
    let stdoutBuffer = ''
    let stderr = ''
    let cancellationSent = false
    const hardStop = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error(`cancelled DSH run did not exit; stderr: ${stderr.slice(-2000)}`))
    }, 180_000)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.stdout.on('data', chunk => {
      stdoutBuffer += String(chunk)
      const lines = stdoutBuffer.split('\n')
      stdoutBuffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim().startsWith('{')) continue
        const event = JSON.parse(line) as JsonEvent
        events.push(event)
        if (!cancellationSent && event.type === 'tool_call' && event.tool === 'shopswarm_diagnose') {
          cancellationSent = true
          setTimeout(() => child.kill('SIGINT'), 500)
        }
      }
    })
    child.once('error', error => {
      clearTimeout(hardStop)
      reject(error)
    })
    child.once('close', exitCode => {
      clearTimeout(hardStop)
      if (!cancellationSent) {
        reject(new Error(`DSH run ended before the diagnostic tool call; stderr: ${stderr.slice(-2000)}`))
        return
      }
      resolve({ events, exitCode })
    })
  })
}

function toolResults(events: readonly JsonEvent[]): JsonEvent[] {
  return events.filter(event => event.type === 'tool_result')
}

async function writeProfilePatch(profileDir: string, url: string, marker: string, timeoutMs = 30_000): Promise<void> {
  await writeFile(join(profileDir, 'cordis.patch.yml'), [
    '- id: shopswarm',
    '  config:',
    `    smokeUrl: ${JSON.stringify(url)}`,
    `    smokeMarker: ${JSON.stringify(marker)}`,
    `    commandTimeoutMs: ${timeoutMs}`,
    '',
  ].join('\n'))
}

async function agentBrowser(
  args: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<Record<string, unknown>> {
  const result = await executeOk(process.execPath, [agentBrowserBin, ...args], { timeoutMs: 60_000, env })
  return JSON.parse(result.stdout) as Record<string, unknown>
}

async function sessions(env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const result = await agentBrowser(['session', 'list', '--json'], env)
  const data = result.data as { sessions?: unknown } | undefined
  assert(Array.isArray(data?.sessions), 'agent-browser session list did not return an array')
  return data.sessions.filter((value): value is string => typeof value === 'string')
}

async function waitForSessions(
  expected: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  timeoutMs = 15_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let current: string[] = []
  while (Date.now() < deadline) {
    current = await sessions(env)
    if (current.length === expected.length && current.every((value, index) => value === expected[index])) return
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  assert.deepEqual(current, expected)
}

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert(address && typeof address !== 'string')
  return address.port
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>(resolve => server.close(() => resolve()))
}

if (!process.env.DEEPSEEK_API_KEY) {
  throw new Error('DEEPSEEK_API_KEY is required; put it in the ignored .env file or export it')
}

const acceptanceDir = await mkdtemp(join(tmpdir(), 'shopswarm-m0-acceptance-'))
const dshHome = join(acceptanceDir, 'dsh-home')
const profileDir = join(dshHome, 'profiles', 'headless')
const tarball = join(acceptanceDir, 'shopswarm-0.0.0.tgz')
const foreignSession = `shopswarm-m0-foreign-${process.pid}`
const shopswarmBrowserEnv = {
  ...process.env,
  AGENT_BROWSER_SOCKET_DIR: join(tmpdir(), 'shopswarm-agent-browser'),
}
const sockets = new Set<import('node:net').Socket>()
const server = createServer((request, response) => {
  if (request.url === '/slow') return
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  response.end('<!doctype html><h1>SHOPSWARM_M0_ACCEPTANCE_OK</h1>')
})
server.on('connection', socket => {
  sockets.add(socket)
  socket.once('close', () => sockets.delete(socket))
})

let foreignOpened = false
try {
  const port = await listen(server)
  const okUrl = `http://127.0.0.1:${port}/ok`
  const slowUrl = `http://127.0.0.1:${port}/slow`
  const dshEnv = { ...process.env, DSH_HOME: dshHome }

  await executeOk('pnpm', ['build'])
  await executeOk('pnpm', ['pack', '--pack-destination', acceptanceDir])
  await executeOk(process.execPath, [dshBin, 'plugin', '--profile', 'headless', 'install'], { env: dshEnv })
  await writeFile(join(profileDir, 'pnpm-workspace.yaml'), [
    'packages:',
    '  - .',
    '',
    'nodeLinker: hoisted',
    'autoInstallPeers: false',
    'allowBuilds:',
    '  agent-browser: true',
    '',
  ].join('\n'))
  await executeOk(process.execPath, [dshBin, 'plugin', '--profile', 'headless', 'add', tarball], { env: dshEnv })

  const manifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
    dsh?: { profile?: { bundles?: string[] } }
  }
  assert(manifest.dependencies?.shopswarm)
  assert(manifest.dsh?.profile?.bundles?.includes('shopswarm'))

  await agentBrowser(['--session', foreignSession, '--json', 'open', okUrl])
  foreignOpened = true

  await writeProfilePatch(profileDir, okUrl, 'SHOPSWARM_M0_ACCEPTANCE_OK')
  const normalEvents = await runDsh(
    '请只调用一次 shopswarm_diagnose，参数 checkBrowser 必须设为 true。工具返回后，简短报告 status 和 markerFound。',
    dshEnv,
  )
  assert(normalEvents.some(event => event.type === 'tool_call' && event.tool === 'shopswarm_diagnose'))
  const normalResult = toolResults(normalEvents).find(event => event.status === 'completed')
  assert(normalResult && typeof normalResult.result === 'string')
  assert(normalResult.result.includes('"status":"ok"'))
  assert(normalResult.result.includes('"markerFound":true'))
  await waitForSessions([foreignSession])
  await waitForSessions([], shopswarmBrowserEnv)

  await writeProfilePatch(profileDir, okUrl, 'SHOPSWARM_MARKER_THAT_DOES_NOT_EXIST')
  const failureEvents = await runDsh(
    '请只调用一次 shopswarm_diagnose，参数 checkBrowser 必须设为 true。即使工具失败也不要重试，只说明失败原因。',
    dshEnv,
  )
  const failureResult = toolResults(failureEvents).find(event => event.status !== 'completed')
  assert(failureResult, 'expected a failed diagnostic tool result')
  await waitForSessions([foreignSession])
  await waitForSessions([], shopswarmBrowserEnv)

  await writeProfilePatch(profileDir, slowUrl, 'SHOPSWARM_M0_ACCEPTANCE_OK', 60_000)
  const cancelled = await startCancelledDsh(
    '请立即调用 shopswarm_diagnose，参数 checkBrowser 必须设为 true，不要执行其他工具。',
    dshEnv,
  )
  assert.notEqual(cancelled.exitCode, 0)
  await waitForSessions([foreignSession])
  await waitForSessions([], shopswarmBrowserEnv, 30_000)

  await agentBrowser(['--session', foreignSession, '--json', 'close'])
  foreignOpened = false
  await waitForSessions([])

  await executeOk(process.execPath, [dshBin, 'plugin', '--profile', 'headless', 'remove', 'shopswarm'], { env: dshEnv })
  const removedManifest = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>
    dsh?: { profile?: { bundles?: string[] } }
  }
  assert.equal(removedManifest.dependencies?.shopswarm, undefined)
  assert.equal(removedManifest.dsh?.profile?.bundles?.includes('shopswarm'), false)
  await executeOk(process.execPath, [dshBin, '--profile', 'headless', '--help'], { env: dshEnv })

  process.stdout.write(`${JSON.stringify({
    status: 'ok',
    profileInstall: true,
    naturalLanguageToolCall: true,
    normalCleanup: true,
    failureCleanup: true,
    cancellationCleanup: true,
    foreignSessionPreserved: true,
    removal: true,
  }, null, 2)}\n`)
} finally {
  if (foreignOpened) {
    await agentBrowser(['--session', foreignSession, '--json', 'close']).catch(() => undefined)
  }
  for (const socket of sockets) socket.destroy()
  await closeServer(server)
  await rm(acceptanceDir, { recursive: true, force: true })
}
