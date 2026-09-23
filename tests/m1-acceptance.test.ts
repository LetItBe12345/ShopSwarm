import { execFile, execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, readdir, readFile, readlink, rename, rm, stat, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { withoutProxy } from '../src/direct-env.js'
import {
  AgentBrowserSession,
  type BrowserElementRef,
  type BrowserPageState,
} from '../src/index.js'

const require = createRequire(import.meta.url)
const launcherPath = join(dirname(require.resolve('agent-browser/package.json')), 'bin', 'agent-browser.js')
const pageNames = ['search', 'spec', 'lazy', 'overlay', 'stale'] as const
type PageName = typeof pageNames[number]
const pages = new Map<PageName, string>(await Promise.all(pageNames.map(async name => [
  name,
  await readFile(fileURLToPath(new URL(`./fixtures/pages/baseline-${name}.html`, import.meta.url)), 'utf8'),
] as const)))
const cleanup: Array<() => Promise<void>> = []

interface CliResult {
  readonly exitCode: number
  readonly stdout: string
  readonly stderr: string
}

afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
}, 30_000)

function element(page: BrowserPageState, role: string, name: string): BrowserElementRef {
  const found = page.elements.find(candidate => candidate.role === role && candidate.name === name)
  if (found === undefined) throw new Error(`missing ${role} named ${name} in snapshot:\n${page.tree}`)
  return found
}

function pageOf(result: { readonly page?: BrowserPageState }, label: string): BrowserPageState {
  if (result.page === undefined) throw new Error(`${label} did not return a page`)
  return result.page
}

async function servePages(): Promise<{ readonly baseUrl: string; close(): Promise<void> }> {
  const server: Server = createServer((request, response) => {
    const pageName = request.url?.slice(1) as PageName | undefined
    const html = pageName === undefined ? undefined : pages.get(pageName)
    response.writeHead(html === undefined ? 404 : 200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(html ?? 'not found')
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('fixture server has no TCP address')
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
  }
}

function runCli(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  timeoutMs = 20_000,
): Promise<CliResult> {
  return new Promise(resolve => {
    execFile(
      process.execPath,
      [launcherPath, ...args],
      { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, timeout: timeoutMs, env },
      (error, stdout, stderr) => {
        const exitCode = error && typeof error.code === 'number' ? error.code : error ? 1 : 0
        resolve({ exitCode, stdout, stderr })
      },
    )
  })
}

function browserEnv(socketDir: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return withoutProxy({
    ...process.env,
    ...extra,
    AGENT_BROWSER_SOCKET_DIR: socketDir,
  })
}

async function listSessions(socketDir: string): Promise<readonly string[]> {
  const result = await runCli(['--json', 'session', 'list'], browserEnv(socketDir))
  const parsed: unknown = JSON.parse(result.stdout)
  if (typeof parsed !== 'object' || parsed === null) throw new Error('session list did not return an object')
  const data = (parsed as { data?: unknown }).data
  if (typeof data !== 'object' || data === null) throw new Error(`session list failed: ${result.stderr}`)
  const sessions = (data as { sessions?: unknown }).sessions
  if (!Array.isArray(sessions) || sessions.some(session => typeof session !== 'string')) {
    throw new Error('session list did not return session names')
  }
  return sessions
}

async function daemonPid(socketDir: string, session: string): Promise<number | undefined> {
  try {
    const pid = Number((await readFile(join(socketDir, `${session}.pid`), 'utf8')).trim())
    return Number.isInteger(pid) && pid > 0 ? pid : undefined
  } catch {
    return undefined
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

interface ProcessRow {
  readonly pid: number
  readonly ppid: number
  readonly args: string
}

function processRows(stdout: string): ProcessRow[] {
  const rows: ProcessRow[] = []
  for (const line of stdout.split('\n')) {
    const match = /^ *(\d+) +(\d+) +(.*)$/.exec(line)
    const pid = match?.[1]
    const ppid = match?.[2]
    const args = match?.[3]
    if (pid === undefined || ppid === undefined || args === undefined) continue
    rows.push({ pid: Number(pid), ppid: Number(ppid), args })
  }
  return rows
}

async function processTable(): Promise<ProcessRow[]> {
  const result = await new Promise<CliResult>(resolve => {
    execFile('ps', ['-ww', '-eo', 'pid=,ppid=,args='], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({ exitCode: error ? 1 : 0, stdout, stderr })
    })
  })
  if (result.exitCode !== 0) throw new Error(result.stderr.trim() || 'ps failed')
  return processRows(result.stdout)
}

function descendantArgs(rows: readonly ProcessRow[], root: number): string[] {
  const args: string[] = []
  const queue = rows.filter(row => row.ppid === root).map(row => row.pid)
  const seen = new Set<number>([root])
  while (queue.length > 0) {
    const pid = queue.shift()
    if (pid === undefined || seen.has(pid)) continue
    seen.add(pid)
    const row = rows.find(candidate => candidate.pid === pid)
    if (row !== undefined) args.push(row.args)
    for (const child of rows) {
      if (child.ppid === pid) queue.push(child.pid)
    }
  }
  return args
}

function userDataDirFromArgs(args: string): string | undefined {
  return /--user-data-dir=(\S+)/.exec(args)?.[1]
}

async function ownedBrowser(socketDir: string, session: string): Promise<{ readonly userDataDir?: string; readonly args: readonly string[] }> {
  const pid = await daemonPid(socketDir, session)
  if (pid === undefined) return { args: [] }
  const args = descendantArgs(await processTable(), pid)
  return { userDataDir: args.map(userDataDirFromArgs).find(dir => dir !== undefined), args }
}

async function ownedUserDataDir(socketDir: string, session: string): Promise<string | undefined> {
  const started = Date.now()
  while (Date.now() - started < 5_000) {
    const owned = await ownedBrowser(socketDir, session)
    if (owned.userDataDir !== undefined) return owned.userDataDir
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  return undefined
}

async function waitFor(check: () => Promise<boolean>, timeoutMs: number, label: string): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    if (await check()) return
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`timed out waiting for ${label}`)
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function hashTree(root: string): Promise<string> {
  const hash = createHash('sha256')
  async function walk(directory: string, prefix: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const relative = `${prefix}${entry.name}`
      const full = join(directory, entry.name)
      if (entry.isDirectory()) {
        hash.update(`dir ${relative}\n`)
        await walk(full, `${relative}/`)
      } else if (entry.isSymbolicLink()) {
        hash.update(`link ${relative}\n`)
        hash.update(await readlink(full))
        hash.update('\n')
      } else if (entry.isFile()) {
        hash.update(`file ${relative}\n`)
        hash.update(await readFile(full))
        hash.update('\n')
      }
    }
  }
  await walk(root, '')
  return hash.digest('hex')
}

function activeWindow(): string {
  if (process.env.DISPLAY === undefined || process.env.DISPLAY.length === 0) return 'unavailable: DISPLAY is unset'
  try {
    return execFileSync('xprop', ['-root', '_NET_ACTIVE_WINDOW'], {
      encoding: 'utf8',
      timeout: 2_000,
      env: process.env,
    }).trim()
  } catch (error) {
    return `unavailable: ${error instanceof Error ? error.message : String(error)}`
  }
}

describe('M1.4 stage acceptance', () => {
  it('repeats the basic actions three times and reports a stale element clearly', { timeout: 180_000 }, async () => {
    const fixtureServer = await servePages()
    const socketDir = await mkdtemp(join(tmpdir(), 'shopswarm-m14-actions-'))
    cleanup.push(() => fixtureServer.close(), () => rm(socketDir, { recursive: true, force: true }))
    const runs: Array<{ readonly run: number; readonly staleCode: string; readonly staleMessage: string }> = []

    for (let run = 1; run <= 3; run += 1) {
      const session = `shopswarm-m14-actions-${process.pid}-${run}`
      const browser = new AgentBrowserSession({
        owner: `m14-actions-${run}`,
        session,
        socketDir,
        signal: new AbortController().signal,
        timeoutMs: 15_000,
      })
      cleanup.push(() => browser.close().then(() => undefined))

      const opened = await browser.open(`${fixtureServer.baseUrl}/search`)
      expect(opened.status).toBe('success')
      const snapshot = await browser.snapshot()
      expect(snapshot.status).toBe('success')
      if (snapshot.status !== 'success') throw new Error('snapshot failed')
      expect(snapshot.page.tree).toContain('商品搜索')

      const filled = await browser.fill(element(snapshot.page, 'textbox', '查询商品'), 'NVMe 2TB')
      expect(filled.status).toBe('success')
      const searched = await browser.click(element(pageOf(filled, 'fill'), 'button', '搜索'))
      expect(searched.status).toBe('success')
      expect(pageOf(searched, 'click').tree).toContain('搜索结果：NVMe 2TB')
      expect((await browser.press('Tab')).status).toBe('success')
      expect((await browser.scroll('down', 200)).status).toBe('success')
      const waited = await browser.wait({ kind: 'text', value: '搜索结果：NVMe 2TB', timeoutMs: 2_000 })
      expect(waited.status).toBe('success')

      const spec = await browser.open(`${fixtureServer.baseUrl}/spec`)
      expect(spec.status).toBe('success')
      const selected = await browser.select(element(pageOf(spec, 'open spec'), 'combobox', '容量'), ['2TB'])
      expect(selected.status).toBe('success')
      expect(pageOf(selected, 'select').tree).toContain('已选 2TB')
      const backed = await browser.back()
      expect(backed.status).toBe('success')
      expect(pageOf(backed, 'back').tree).toContain('商品搜索')

      const stalePage = await browser.open(`${fixtureServer.baseUrl}/stale`)
      expect(stalePage.status).toBe('success')
      const staleRef = element(pageOf(stalePage, 'open stale'), 'button', '稍后移除')
      const removed = await browser.click(element(pageOf(stalePage, 'open stale'), 'button', '移除控件'))
      expect(removed.status).toBe('success')
      expect(pageOf(removed, 'remove temporary control').tree).not.toContain('稍后移除')
      const stale = await browser.click(staleRef)
      expect(stale.status).toBe('failure')
      if (stale.status !== 'failure') throw new Error('stale click did not fail')
      expect(stale.error.code).toBe('stale_element_reference')
      expect(stale.error.message.length).toBeGreaterThan(0)
      runs.push({ run, staleCode: stale.error.code, staleMessage: stale.error.message })

      expect((await browser.close()).status).toBe('success')
    }

    console.info(`M1.4_ACTIONS ${JSON.stringify({ repeats: runs.length, runs })}`)
  })

  it('keeps two sessions on their own pages after one closes', { timeout: 90_000 }, async () => {
    const fixtureServer = await servePages()
    const socketDir = await mkdtemp(join(tmpdir(), 'shopswarm-m14-isolation-'))
    cleanup.push(() => fixtureServer.close(), () => rm(socketDir, { recursive: true, force: true }))
    const signal = new AbortController().signal
    const first = new AgentBrowserSession({
      owner: 'm14-isolation-a',
      session: `shopswarm-m14-a-${process.pid}`,
      socketDir,
      signal,
      timeoutMs: 15_000,
    })
    const second = new AgentBrowserSession({
      owner: 'm14-isolation-b',
      session: `shopswarm-m14-b-${process.pid}`,
      socketDir,
      signal,
      timeoutMs: 15_000,
    })
    cleanup.push(() => first.close().then(() => undefined), () => second.close().then(() => undefined))

    expect((await first.open(`${fixtureServer.baseUrl}/search`)).status).toBe('success')
    expect((await second.open(`${fixtureServer.baseUrl}/spec`)).status).toBe('success')
    const firstPage = await first.snapshot()
    const secondPage = await second.snapshot()
    expect(firstPage.status).toBe('success')
    expect(secondPage.status).toBe('success')
    if (firstPage.status !== 'success' || secondPage.status !== 'success') throw new Error('isolation snapshot failed')
    expect(firstPage.page.tree).toContain('商品搜索')
    expect(secondPage.page.tree).toContain('选择容量')
    expect(firstPage.page.session).not.toBe(secondPage.page.session)

    const filled = await first.fill(element(firstPage.page, 'textbox', '查询商品'), '仅第一会话')
    expect(filled.status).toBe('success')
    const secondAfter = await second.snapshot()
    expect(secondAfter.status).toBe('success')
    if (secondAfter.status !== 'success') throw new Error('second snapshot failed')
    expect(secondAfter.page.tree).not.toContain('仅第一会话')
    expect(secondAfter.page.origin).toBe(secondPage.page.origin)

    expect((await first.close()).status).toBe('success')
    expect((await first.snapshot()).status).toBe('failure')
    const selected = await second.select(element(secondAfter.page, 'combobox', '容量'), ['2TB'])
    expect(selected.status).toBe('success')
    expect(pageOf(selected, 'second select').tree).toContain('已选 2TB')
    expect((await second.close()).status).toBe('success')
  })

  it('removes its own browser and temp profile after close and cancel, leaving an external session', { timeout: 120_000 }, async () => {
    const fixtureServer = await servePages()
    const socketDir = await mkdtemp(join(tmpdir(), 'shopswarm-m14-cleanup-'))
    cleanup.push(() => fixtureServer.close(), () => rm(socketDir, { recursive: true, force: true }))
    const externalSession = `external-m14-${process.pid}`
    const env = browserEnv(socketDir)
    const externalOpen = await runCli(
      ['--session', externalSession, '--headed', 'false', '--json', 'open', `${fixtureServer.baseUrl}/overlay`],
      env,
    )
    expect(externalOpen.exitCode).toBe(0)
    const externalPid = await daemonPid(socketDir, externalSession)
    const externalDir = await ownedUserDataDir(socketDir, externalSession)
    if (externalPid === undefined || externalDir === undefined) throw new Error('external session did not start')
    cleanup.push(async () => {
      await runCli(['--session', externalSession, '--headed', 'false', '--json', 'close'], env)
    })

    async function assertReleased(session: string, userDataDir: string): Promise<void> {
      await waitFor(async () => {
        const pid = await daemonPid(socketDir, session)
        const listed = await listSessions(socketDir)
        return (pid === undefined || !isAlive(pid)) && !listed.includes(session) && !await pathExists(userDataDir)
      }, 5_000, `release of ${session}`)
      expect(isAlive(externalPid)).toBe(true)
      expect(await pathExists(externalDir)).toBe(true)
      expect(await listSessions(socketDir)).toContain(externalSession)
    }

    const normalSession = `shopswarm-m14-normal-${process.pid}`
    const normal = new AgentBrowserSession({
      owner: 'm14-cleanup-normal',
      session: normalSession,
      socketDir,
      signal: new AbortController().signal,
      timeoutMs: 15_000,
    })
    expect((await normal.open(`${fixtureServer.baseUrl}/search`)).status).toBe('success')
    const normalBrowser = await ownedBrowser(socketDir, normalSession)
    const normalDir = normalBrowser.userDataDir
    if (normalDir === undefined) throw new Error('normal session did not create a temp profile')
    expect(normalBrowser.args.join('\n')).not.toContain('--proxy-server')
    expect(normalDir).not.toBe(externalDir)
    expect((await normal.close()).status).toBe('success')
    await assertReleased(normalSession, normalDir)

    const cancelSession = `shopswarm-m14-cancel-${process.pid}`
    const controller = new AbortController()
    const cancelled = new AgentBrowserSession({
      owner: 'm14-cleanup-cancel',
      session: cancelSession,
      socketDir,
      signal: controller.signal,
      timeoutMs: 15_000,
    })
    cleanup.push(() => cancelled.close().then(() => undefined))
    expect((await cancelled.open(`${fixtureServer.baseUrl}/lazy`)).status).toBe('success')
    const cancelDir = await ownedUserDataDir(socketDir, cancelSession)
    if (cancelDir === undefined) throw new Error('cancelled session did not create a temp profile')
    const waiting = cancelled.wait({ kind: 'text', value: '不会出现的验收文本', timeoutMs: 8_000 })
    setTimeout(() => controller.abort(), 300)
    const aborted = await waiting
    expect(aborted).toMatchObject({ status: 'uncertain', error: { code: 'cancelled' } })
    await cancelled.close()
    await assertReleased(cancelSession, cancelDir)
    console.info(`M1.4_CLEANUP ${JSON.stringify({
      normalReleased: true,
      cancelReleased: true,
      externalSessionAlive: true,
      externalProfileKept: true,
    })}`)
  })

  it('reads a marker cookie from a copied temp profile and leaves the source unchanged', { timeout: 90_000 }, async () => {
    const fixtureServer = await servePages()
    const root = await mkdtemp(join(tmpdir(), 'shopswarm-m14-profile-'))
    const socketDir = join(root, 'sockets')
    const fakeHome = join(root, 'home')
    const sourceProfile = join(fakeHome, '.config', 'google-chrome')
    const stagingProfile = join(root, 'staging-user-data')
    const markerName = 'shopswarm_m14_marker'
    const markerValue = createHash('sha256').update(`m14-${process.pid}-${Date.now()}`).digest('hex')
    cleanup.push(() => fixtureServer.close(), () => rm(root, { recursive: true, force: true }))
    const setupSession = `shopswarm-m14-profile-setup-${process.pid}`
    const setupEnv = browserEnv(socketDir)
    const pageUrl = `${fixtureServer.baseUrl}/search`
    const setupOpen = await runCli(
      ['--profile', stagingProfile, '--session', setupSession, '--headed', 'false', '--json', 'open', pageUrl],
      setupEnv,
      30_000,
    )
    expect(setupOpen.exitCode, setupOpen.stderr).toBe(0)
    const expires = Math.floor(Date.now() / 1000) + 86_400
    const cookieSet = await runCli(
      ['--profile', stagingProfile, '--session', setupSession, '--headed', 'false', '--json', 'cookies', 'set', markerName, markerValue, '--url', pageUrl, '--expires', String(expires)],
      setupEnv,
    )
    expect(cookieSet.exitCode, cookieSet.stderr).toBe(0)
    expect((await runCli(
      ['--profile', stagingProfile, '--session', setupSession, '--headed', 'false', '--json', 'close'],
      setupEnv,
    )).exitCode).toBe(0)
    await mkdir(join(fakeHome, '.config'), { recursive: true })
    await rename(stagingProfile, sourceProfile)
    const crashReports = join(root, 'crash-reports')
    await mkdir(crashReports)
    await symlink(crashReports, join(sourceProfile, 'Crash Reports'))
    const sourceBefore = await hashTree(sourceProfile)
    const focusBefore = activeWindow()

    const session = `shopswarm-m14-profile-copy-${process.pid}`
    const browser = new AgentBrowserSession({
      owner: 'm14-profile-copy',
      session,
      socketDir,
      profileName: 'Default',
      env: { HOME: fakeHome },
      signal: new AbortController().signal,
      timeoutMs: 20_000,
    })
    cleanup.push(() => browser.close().then(() => undefined))
    expect((await browser.open(`${fixtureServer.baseUrl}/search`)).status).toBe('success')
    const focusDuring = activeWindow()
    const copyDir = await ownedUserDataDir(socketDir, session)
    if (copyDir === undefined) throw new Error('copied profile directory was not found')
    const realChrome = join(process.env.HOME ?? '', '.config', 'google-chrome')
    expect(copyDir.startsWith(realChrome)).toBe(false)
    expect(copyDir).not.toBe(sourceProfile)
    expect(copyDir.includes('agent-browser-profile-')).toBe(true)

    const cookies = await runCli(
      ['--profile', 'Default', '--session', session, '--headed', 'false', '--json', 'cookies', 'get'],
      browserEnv(socketDir, { HOME: fakeHome }),
    )
    expect(cookies.exitCode, cookies.stderr).toBe(0)
    const parsed: unknown = JSON.parse(cookies.stdout)
    const records = typeof parsed === 'object' && parsed !== null
      ? (parsed as { data?: { cookies?: unknown } }).data?.cookies
      : undefined
    const found = Array.isArray(records) && records.some(cookie => {
      if (typeof cookie !== 'object' || cookie === null) return false
      const record = cookie as { name?: unknown; value?: unknown }
      return record.name === markerName && record.value === markerValue
    })
    expect(found).toBe(true)
    expect((await browser.close()).status).toBe('success')
    await waitFor(async () => !await pathExists(copyDir), 5_000, 'removal of the copied profile')
    const sourceAfter = await hashTree(sourceProfile)
    expect(sourceAfter).toBe(sourceBefore)
    const focusAfter = activeWindow()
    console.info(`M1.4_PROFILE ${JSON.stringify({
      profileReadable: true,
      markerCookieReadableFromCopy: true,
      sourceUnchanged: true,
      realStoreLogin: 'not-run',
      focus: { before: focusBefore, during: focusDuring, after: focusAfter },
      copiedProfileRemoved: true,
    })}`)
  })

  it('records browser startup, one CLI call, and page wait separately', { timeout: 90_000 }, async () => {
    const fixtureServer = await servePages()
    const socketDir = await mkdtemp(join(tmpdir(), 'shopswarm-m14-timing-'))
    cleanup.push(() => fixtureServer.close(), () => rm(socketDir, { recursive: true, force: true }))
    const session = `shopswarm-m14-timing-${process.pid}`
    const browser = new AgentBrowserSession({
      owner: 'm14-timing',
      session,
      socketDir,
      signal: new AbortController().signal,
      timeoutMs: 15_000,
    })
    cleanup.push(() => browser.close().then(() => undefined))

    const openStarted = performance.now()
    let browserStartupMs: number | undefined
    let stopWatch = false
    const watch = (async () => {
      while (!stopWatch && browserStartupMs === undefined) {
        const dir = await ownedUserDataDir(socketDir, session)
        if (dir !== undefined) browserStartupMs = Math.max(0, Math.round(performance.now() - openStarted))
        else await new Promise(resolve => setTimeout(resolve, 20))
      }
    })()
    const opened = await browser.open(`${fixtureServer.baseUrl}/lazy`)
    stopWatch = true
    await watch
    expect(opened.status).toBe('success')
    expect(browserStartupMs).toEqual(expect.any(Number))
    if (opened.page === undefined) throw new Error('open did not return a page')
    expect(opened.page.tree).not.toContain('页面标价')

    const cliStarted = performance.now()
    const snapshot = await browser.snapshot()
    const cliCallMs = Math.max(0, Math.round(performance.now() - cliStarted))
    expect(snapshot.status).toBe('success')

    const waitStarted = performance.now()
    const waited = await runCli(
      ['--session', session, '--headed', 'false', '--json', 'wait', '--text', '页面标价：89900 分', '--timeout', '5000'],
      browserEnv(socketDir),
    )
    const pageWaitMs = Math.max(0, Math.round(performance.now() - waitStarted))
    expect(waited.exitCode, waited.stderr).toBe(0)

    const timing = {
      browserStartupMs,
      cliCallMs,
      pageWaitMs,
      node: process.version,
      platform: process.platform,
    }
    expect(Number.isInteger(browserStartupMs) && browserStartupMs >= 0).toBe(true)
    expect(Number.isInteger(cliCallMs) && cliCallMs >= 0).toBe(true)
    expect(Number.isInteger(pageWaitMs) && pageWaitMs >= 0).toBe(true)
    console.info(`M1.4_TIMING ${JSON.stringify(timing)}`)
    expect((await browser.close()).status).toBe('success')
  })
})
