import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentBrowserSession, type BrowserCommandRunner } from './agent-browser-session.js'
import type { BrowserElementRef, BrowserPageState } from './types.js'

export interface InteractiveStep {
  readonly action: 'open' | 'click' | 'fill' | 'press' | 'waitText' | 'snapshot'
  readonly url?: string
  readonly role?: string
  readonly name?: string
  readonly value?: string
  readonly key?: string
  readonly text?: string
  readonly timeoutMs?: number
}

export interface InteractiveTaskResult {
  readonly session: string
  readonly completedSteps: number
  readonly failedAction: string
  readonly detail: string
  readonly pageExcerpt: string
}

function excerpt(page: BrowserPageState | undefined): string {
  return (page?.tree ?? '').slice(0, 4_000)
}

function target(page: BrowserPageState | undefined, role: string, name: string): BrowserElementRef | undefined {
  return page?.elements.find(element => element.role === role && element.name === name)
}

export function parseInteractiveSteps(value: unknown): InteractiveStep[] | string {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) {
    return 'steps must contain 1 to 8 actions'
  }
  const steps: InteractiveStep[] = []
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) return 'each step must be an object'
    const record = entry as Record<string, unknown>
    const action = record.action
    if (action !== 'open' && action !== 'click' && action !== 'fill' && action !== 'press' && action !== 'waitText' && action !== 'snapshot') {
      return 'step action must be open, click, fill, press, waitText, or snapshot'
    }
    const step: InteractiveStep = { action }
    if (typeof record.url === 'string') steps.push({ ...step, url: record.url })
    else if (action === 'open') return 'open requires a url'
    else steps.push(step)
    const current = steps.at(-1)
    if (current === undefined) return 'step was not recorded'
    if ((action === 'click' || action === 'fill') && (typeof record.role !== 'string' || typeof record.name !== 'string')) {
      return `${action} requires role and name`
    }
    if (action === 'fill' && typeof record.value !== 'string') return 'fill requires a value'
    if (action === 'press' && typeof record.key !== 'string') return 'press requires a key'
    if (action === 'waitText' && typeof record.text !== 'string') return 'waitText requires text'
    const timeoutMs = record.timeoutMs
    steps[steps.length - 1] = {
      ...current,
      ...(typeof record.role === 'string' ? { role: record.role } : {}),
      ...(typeof record.name === 'string' ? { name: record.name } : {}),
      ...(typeof record.value === 'string' ? { value: record.value } : {}),
      ...(typeof record.key === 'string' ? { key: record.key } : {}),
      ...(typeof record.text === 'string' ? { text: record.text } : {}),
      ...(typeof timeoutMs === 'number' ? { timeoutMs } : {}),
    }
  }
  return steps
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
  let page: BrowserPageState | undefined
  let completedSteps = 0
  let failedAction = ''
  let detail = ''
  try {
    for (const step of options.steps) {
      if (step.action === 'open') {
        const opened = await browser.open(step.url ?? '')
        if (opened.status !== 'success') {
          failedAction = 'open'
          detail = opened.status === 'failure' || opened.status === 'uncertain' ? opened.error.message : 'open failed'
          break
        }
        page = opened.page ?? page
      } else if (step.action === 'snapshot') {
        const shot = await browser.snapshot()
        if (shot.status !== 'success') {
          failedAction = 'snapshot'
          detail = shot.error.message
          break
        }
        page = shot.page
      } else if (step.action === 'click' || step.action === 'fill') {
        const element = target(page, step.role ?? '', step.name ?? '')
        if (element === undefined) {
          failedAction = step.action
          detail = `missing ${step.role} named ${step.name}`
          break
        }
        const acted = step.action === 'click'
          ? await browser.click(element)
          : await browser.fill(element, step.value ?? '')
        if (acted.status !== 'success') {
          failedAction = step.action
          detail = acted.error.message
          break
        }
        page = acted.page ?? page
      } else if (step.action === 'press') {
        const pressed = await browser.press(step.key ?? '')
        if (pressed.status !== 'success') {
          failedAction = 'press'
          detail = pressed.error.message
          break
        }
        page = pressed.page ?? page
      } else {
        const waited = await browser.wait({ kind: 'text', value: step.text ?? '', timeoutMs: step.timeoutMs ?? 2_000 })
        if (waited.status !== 'success') {
          failedAction = 'waitText'
          detail = waited.error.message
          break
        }
        page = waited.page ?? page
      }
      completedSteps += 1
    }
  } finally {
    await browser.close()
    if (removeSocketDir) await rm(socketDir, { recursive: true, force: true })
  }
  return {
    session: browser.session,
    completedSteps,
    failedAction,
    detail,
    pageExcerpt: excerpt(page),
  }
}
