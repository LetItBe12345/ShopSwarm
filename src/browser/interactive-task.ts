import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentBrowserSession, type BrowserCommandRunner } from './agent-browser-session.js'
import type { BrowserElementRef, BrowserPageState, BrowserScrollDirection } from './types.js'

export interface InteractiveStep {
  readonly action: 'open' | 'click' | 'fill' | 'select' | 'press' | 'scroll' | 'back' | 'waitText' | 'snapshot'
  readonly url?: string
  readonly role?: string
  readonly name?: string
  readonly value?: string
  readonly key?: string
  readonly direction?: BrowserScrollDirection
  readonly amount?: number
  readonly text?: string
  readonly timeoutMs?: number
}

export interface InteractiveTaskResult {
  readonly session: string
  readonly completedSteps: number
  readonly failedAction: string
  readonly detail: string
  readonly pageUrl: string
  readonly pageExcerpt: string
  readonly page?: BrowserPageState
}

function excerpt(page: BrowserPageState | undefined): string {
  return (page?.tree ?? '').slice(0, 4_000)
}

function target(page: BrowserPageState | undefined, role: string, name: string): BrowserElementRef | undefined {
  return page?.elements.find(element => element.role === role && element.name === name)
}

export function parseInteractiveSteps(value: unknown): InteractiveStep[] | string {
  if (!Array.isArray(value) || value.length === 0) return 'steps must contain at least one action'
  const steps: InteractiveStep[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) return 'each step must be an object'
    const record = entry as Record<string, unknown>
    const action = record.action
    if (action !== 'open' && action !== 'click' && action !== 'fill' && action !== 'select'
      && action !== 'press' && action !== 'scroll' && action !== 'back' && action !== 'waitText' && action !== 'snapshot') {
      return 'step action must be open, snapshot, click, fill, select, press, scroll, back, or waitText'
    }
    const step: InteractiveStep = { action }
    if (typeof record.url === 'string') steps.push({ ...step, url: record.url })
    else if (action === 'open') return 'open requires a url'
    else steps.push(step)
    const current = steps.at(-1)
    if (current === undefined) return 'step was not recorded'
    if ((action === 'click' || action === 'fill' || action === 'select')
      && (typeof record.role !== 'string' || typeof record.name !== 'string')) {
      return `${action} requires role and name`
    }
    if ((action === 'fill' || action === 'select') && typeof record.value !== 'string') return `${action} requires a value`
    if (action === 'press' && typeof record.key !== 'string') return 'press requires a key'
    if (action === 'scroll' && record.direction !== 'up' && record.direction !== 'down'
      && record.direction !== 'left' && record.direction !== 'right') return 'scroll requires direction up, down, left, or right'
    if (action === 'waitText' && typeof record.text !== 'string') return 'waitText requires text'
    if (record.timeoutMs !== undefined && (typeof record.timeoutMs !== 'number' || !Number.isInteger(record.timeoutMs) || record.timeoutMs <= 0)) {
      return 'timeoutMs must be a positive integer'
    }
    if (record.amount !== undefined && (typeof record.amount !== 'number' || !Number.isInteger(record.amount) || record.amount <= 0)) {
      return 'amount must be a positive integer'
    }
    steps[steps.length - 1] = {
      ...current,
      ...(typeof record.role === 'string' ? { role: record.role } : {}),
      ...(typeof record.name === 'string' ? { name: record.name } : {}),
      ...(typeof record.value === 'string' ? { value: record.value } : {}),
      ...(typeof record.key === 'string' ? { key: record.key } : {}),
      ...(typeof record.direction === 'string' ? { direction: record.direction as BrowserScrollDirection } : {}),
      ...(typeof record.amount === 'number' ? { amount: record.amount } : {}),
      ...(typeof record.text === 'string' ? { text: record.text } : {}),
      ...(typeof record.timeoutMs === 'number' ? { timeoutMs: record.timeoutMs } : {}),
    }
  }
  return steps
}

/** Execute a finite action batch on an existing browser session without closing it. */
export async function runInteractiveSteps(options: {
  readonly browser: AgentBrowserSession
  readonly steps: readonly InteractiveStep[]
  readonly refreshPage?: boolean
}): Promise<InteractiveTaskResult> {
  let page = options.browser.currentPage
  let completedSteps = 0
  let failedAction = ''
  let detail = ''

  if (options.refreshPage || (page === undefined
    && options.steps[0]?.action !== 'open' && options.steps[0]?.action !== 'snapshot')) {
    const shot = await options.browser.snapshot({ compact: false })
    if (shot.status !== 'success') {
      return {
        session: options.browser.session,
        completedSteps,
        failedAction: 'snapshot',
        detail: shot.error.message,
        pageUrl: page?.origin ?? '',
        pageExcerpt: excerpt(page),
        ...(page ? { page } : {}),
      }
    }
    page = shot.page
  }

  for (const step of options.steps) {
    if (step.action === 'open') {
      const opened = await options.browser.open(step.url ?? '')
      if (opened.status !== 'success') {
        failedAction = 'open'
        detail = opened.status === 'failure' || opened.status === 'uncertain' ? opened.error.message : 'open failed'
        break
      }
      page = opened.page ?? options.browser.currentPage ?? page
    } else if (step.action === 'snapshot') {
      const shot = await options.browser.snapshot({ compact: false })
      if (shot.status !== 'success') {
        failedAction = 'snapshot'
        detail = shot.error.message
        break
      }
      page = shot.page
    } else if (step.action === 'click' || step.action === 'fill' || step.action === 'select') {
      const element = target(page, step.role ?? '', step.name ?? '')
      if (element === undefined) {
        failedAction = step.action
        detail = `missing ${step.role} named ${step.name}`
        break
      }
      const acted = step.action === 'click'
        ? await options.browser.click(element)
        : step.action === 'fill'
          ? await options.browser.fill(element, step.value ?? '')
          : await options.browser.select(element, [step.value ?? ''])
      if (acted.status !== 'success') {
        failedAction = step.action
        detail = acted.error.message
        page = acted.page ?? options.browser.currentPage ?? page
        break
      }
      page = acted.page ?? options.browser.currentPage ?? page
    } else if (step.action === 'press') {
      const pressed = await options.browser.press(step.key ?? '')
      if (pressed.status !== 'success') {
        failedAction = 'press'
        detail = pressed.error.message
        page = pressed.page ?? options.browser.currentPage ?? page
        break
      }
      page = pressed.page ?? options.browser.currentPage ?? page
    } else if (step.action === 'scroll') {
      const scrolled = await options.browser.scroll(step.direction ?? 'down', step.amount)
      if (scrolled.status !== 'success') {
        failedAction = 'scroll'
        detail = scrolled.error.message
        page = scrolled.page ?? options.browser.currentPage ?? page
        break
      }
      page = scrolled.page ?? options.browser.currentPage ?? page
    } else if (step.action === 'back') {
      const backed = await options.browser.back()
      if (backed.status !== 'success') {
        failedAction = 'back'
        detail = backed.error.message
        page = backed.page ?? options.browser.currentPage ?? page
        break
      }
      page = backed.page ?? options.browser.currentPage ?? page
    } else {
      const waited = await options.browser.wait({ kind: 'text', value: step.text ?? '', timeoutMs: step.timeoutMs ?? 2_000 })
      if (waited.status !== 'success') {
        failedAction = 'waitText'
        detail = waited.error.message
        page = waited.page ?? options.browser.currentPage ?? page
        break
      }
      page = waited.page ?? options.browser.currentPage ?? page
    }
    completedSteps += 1
  }

  return {
    session: options.browser.session,
    completedSteps,
    failedAction,
    detail,
    pageUrl: page?.origin ?? '',
    pageExcerpt: excerpt(page),
    ...(page ? { page } : {}),
  }
}

export async function runInteractiveTask(options: {
  readonly owner: string
  readonly signal: AbortSignal
  readonly timeoutMs: number
  readonly steps: readonly InteractiveStep[]
  readonly session?: string
  readonly socketDir?: string
  readonly commandRunner?: BrowserCommandRunner
}): Promise<InteractiveTaskResult> {
  const socketDir = options.socketDir ?? await mkdtemp(join(tmpdir(), 'shopswarm-task-'))
  const removeSocketDir = options.socketDir === undefined
  const browser = new AgentBrowserSession({
    owner: options.owner,
    signal: options.signal,
    timeoutMs: options.timeoutMs,
    ...(options.session === undefined ? {} : { session: options.session }),
    ...(options.commandRunner === undefined ? {} : { commandRunner: options.commandRunner }),
    socketDir,
  })
  try {
    return await runInteractiveSteps({ browser, steps: options.steps })
  } finally {
    await browser.close()
    if (removeSocketDir) await rm(socketDir, { recursive: true, force: true })
  }
}
