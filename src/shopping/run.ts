import { AgentBrowserSession } from '../browser/agent-browser-session.js'
import type { BrowserActionResult, BrowserError, BrowserPageState } from '../browser/types.js'
import { buildActionRequest, chooseAction, executeSelectedAction } from '../jev.js'
import type { RecentAction, ShoppingTaskContext } from '../jev.js'
import { resolveTextInput } from '../text-input.js'
import type { Offer, ProductSpec } from '../types.js'
import { extractObservedFields } from './extract.js'
import { checkObservedOffer, sameOfferIdentity } from './verify.js'
import type { OfferRequirements } from './verify.js'

/** M2 single-source exact-target compatibility contract. Top-level natural-language shopping tasks are decomposed by DSH/Skill; M4 will generalize this schema. */
export interface ShoppingTask {
  readonly startUrl: string
  readonly goal: string
  readonly model: string
  readonly specs: readonly ProductSpec[]
  readonly seller?: string
  readonly constraints?: readonly string[]
  readonly textInputs?: Readonly<Record<string, string>>
}

export type ShoppingStatus = 'success' | 'blocked' | 'failed' | 'cancelled'
export type ShoppingReason =
  | 'completed' | 'login_required' | 'captcha' | 'site_rate_limited' | 'no_progress' | 'verification_failed'
  | 'browser_timeout' | 'browser_error' | 'jev_error' | 'text_error' | 'offer_error' | 'cancelled' | 'cleanup_failed'

export interface ShoppingResult {
  readonly status: ShoppingStatus
  readonly reasonCode: ShoppingReason
  readonly reason: string
  readonly userMessage: string
  readonly progress: readonly string[]
  readonly missing: readonly string[]
  readonly pageUrl: string
  readonly pageExcerpt: string
  readonly offer?: Offer
  readonly candidate?: Offer
  readonly metrics: {
    readonly actionDecisionCalls: number
    readonly extractionCalls: number
    readonly browserActions: number
    readonly actionDecisionDurationMs: number
    readonly extractionDurationMs: number
    readonly textModelDurationMs: number
    readonly extractionInputTokens: number | null
    readonly extractionOutputTokens: number | null
  }
  readonly cleanupError?: string
}

export interface ShoppingRunOptions {
  readonly owner: string
  readonly signal: AbortSignal
  readonly timeoutMs: number
  readonly profileName?: string
  readonly createBrowser?: (owner: string) => AgentBrowserSession
  readonly choose?: typeof chooseAction
  readonly extract?: typeof extractObservedFields
  readonly textInput?: typeof resolveTextInput
}

class ShoppingBrowserError extends Error {
  constructor(readonly browserError: BrowserError) {
    super(browserError.message)
  }
}

function blocker(page: BrowserPageState): 'captcha' | 'login_required' | 'site_rate_limited' | undefined {
  const text = page.tree
  if (/访问频繁导致无法搜索|访问过于频繁|请求过于频繁|too many requests|rate limit/i.test(text)) return 'site_rate_limited'
  if (/安全验证|滑动验证|请完成验证|人机验证|图形验证码|captcha|drag the slider to verify|verify to ensure normal access/i.test(text)) return 'captcha'
  if (/\/(login|signin|passport)(?:[./?#]|$)/i.test(page.origin)
    || (/登录|登陆|sign in|log in/i.test(text) && /密码|password/i.test(text) && /textbox|input|button/i.test(text))) {
    return 'login_required'
  }
  return undefined
}

function result(
  status: ShoppingStatus,
  reasonCode: ShoppingReason,
  reason: string,
  page: BrowserPageState | undefined,
  progress: readonly string[],
  missing: readonly string[],
  metrics: ShoppingResult['metrics'],
  offer?: Offer,
  candidate?: Offer,
): ShoppingResult {
  return {
    status, reasonCode, reason,
    userMessage: reasonCode === 'login_required'
      ? '请在自己的 Chrome Default Profile 中重新登录该站点，然后回复“已登录”。ShopSwarm 会用原任务新建浏览器会话并重新核验。'
      : '',
    progress, missing,
    pageUrl: page?.origin ?? '',
    pageExcerpt: page?.tree.slice(0, 3_000) ?? '',
    ...(offer ? { offer } : {}),
    ...(candidate ? { candidate } : {}),
    metrics,
  }
}

function browserProblem(error: BrowserError): { status: ShoppingStatus; code: ShoppingReason } {
  if (error.code === 'cancelled') return { status: 'cancelled', code: 'cancelled' }
  if (error.code === 'timeout') return { status: 'failed', code: 'browser_timeout' }
  return { status: 'failed', code: 'browser_error' }
}

async function restoreNativeSpecs(browser: AgentBrowserSession, page: BrowserPageState, specs: readonly ProductSpec[]): Promise<BrowserPageState> {
  let current = page
  for (const spec of specs) {
    const control = current.elements.find(element => element.role === 'combobox' && element.name === spec.name)
    if (!control || !current.tree.includes(`option "${spec.value}"`)) continue
    const selected = await browser.select(control, [spec.value])
    if (selected.status !== 'success') throw new ShoppingBrowserError(selected.error)
    const observed = await browser.snapshot({ compact: false })
    if (observed.status !== 'success') throw new ShoppingBrowserError(observed.error)
    current = observed.page
  }
  return current
}

/** One DSH tool call owns one action session and, on DONE, a separate replay session. */
export async function runShoppingTask(task: ShoppingTask, options: ShoppingRunOptions): Promise<ShoppingResult> {
  if (!task.goal.trim() || !task.model.trim() || !/^https?:\/\//.test(task.startUrl)) throw new Error('goal, model and HTTP startUrl are required')
  const requirements: OfferRequirements = {
    model: task.model,
    specs: task.specs,
    ...(task.seller ? { seller: task.seller } : {}),
  }
  const create = options.createBrowser ?? (owner => new AgentBrowserSession({
    owner, signal: options.signal, timeoutMs: options.timeoutMs,
    ...(options.profileName ? { profileName: options.profileName } : {}),
  }))
  const actionBrowser = create(options.owner)
  let replayBrowser: AgentBrowserSession | undefined
  let page: BrowserPageState | undefined
  let progress: readonly string[] = []
  let missing: readonly string[] = []
  let rejectedDone = ''
  let lastStall = ''
  const history: RecentAction[] = []
  const metrics = {
    actionDecisionCalls: 0, extractionCalls: 0, browserActions: 0,
    actionDecisionDurationMs: 0, extractionDurationMs: 0, textModelDurationMs: 0,
    extractionInputTokens: 0 as number | null, extractionOutputTokens: 0 as number | null,
  }
  const addExtraction = (measurement: Awaited<ReturnType<typeof extractObservedFields>>['metrics']): void => {
    metrics.extractionDurationMs += measurement.durationMs
    metrics.extractionInputTokens = measurement.inputTokens === null || metrics.extractionInputTokens === null
      ? null : metrics.extractionInputTokens + measurement.inputTokens
    metrics.extractionOutputTokens = measurement.outputTokens === null || metrics.extractionOutputTokens === null
      ? null : metrics.extractionOutputTokens + measurement.outputTokens
  }
  let output: ShoppingResult

  try {
    const opened = await actionBrowser.open(task.startUrl)
    if (opened.status !== 'success') {
      const problem = browserProblem(opened.error)
      output = result(problem.status, problem.code, opened.error.message, opened.page, progress, missing, metrics)
    } else {
      const firstShot = await actionBrowser.snapshot({ compact: false })
      page = firstShot.status === 'success' ? firstShot.page : undefined
      if (!page) {
        const problem = browserProblem(firstShot.status === 'failure' ? firstShot.error : { code: 'invalid_result', message: 'browser opened without a page snapshot' })
        output = result(problem.status, problem.code, firstShot.status === 'failure' ? firstShot.error.message : 'browser opened without a page snapshot', page, progress, missing, metrics)
      } else output = await (async (): Promise<ShoppingResult> => {
        while (true) {
          if (options.signal.aborted) return result('cancelled', 'cancelled', 'task cancelled', page, progress, missing, metrics)
          const obstruction = blocker(page!)
          if (obstruction) return result('blocked', obstruction, obstruction, page, progress, missing, metrics)
          const context: ShoppingTaskContext = {
            goal: task.goal,
            constraints: task.constraints ?? [],
            doneWhen: [`型号 ${task.model}`, ...task.specs.map(spec => `${spec.name}=${spec.value}`), '卖家和明确标价有页面证据'],
            progress,
            verificationGaps: missing,
            ...(task.textInputs ? { textInputs: task.textInputs } : {}),
          }
          const request = buildActionRequest(context, page!, history)
          let selected
          try {
            metrics.actionDecisionCalls += 1
            selected = await (options.choose ?? chooseAction)(request, { signal: options.signal })
            metrics.actionDecisionDurationMs += selected.durationMs
          } catch (error) {
            if (options.signal.aborted) return result('cancelled', 'cancelled', 'task cancelled', page, progress, missing, metrics)
            return result('failed', 'jev_error', String(error), page, progress, missing, metrics)
          }
          if (selected.operation === 'BLOCKED') {
            return result('blocked', 'no_progress', 'Jev found no available action; DSH Agent should inspect the page and progress', page, progress, missing, metrics)
          }
          if (selected.operation === 'DONE') {
            let extracted
            try {
              metrics.extractionCalls += 1
              extracted = await (options.extract ?? extractObservedFields)(page!, requirements, { signal: options.signal })
              addExtraction(extracted.metrics)
            } catch (error) {
              if (options.signal.aborted) return result('cancelled', 'cancelled', 'task cancelled', page, progress, missing, metrics)
              return result('failed', 'offer_error', String(error), page, progress, missing, metrics)
            }
            const first = checkObservedOffer(page!, requirements, extracted.fields)
            progress = first.progress
            missing = first.missing
            if (!first.offer) {
              const signature = JSON.stringify({ url: page!.origin, tree: page!.tree, progress, missing })
              if (signature === rejectedDone) {
                return result('blocked', 'no_progress', 'same page and missing evidence after repeated DONE', page, progress, missing, metrics)
              }
              rejectedDone = signature
              history.push({ operation: 'DONE', status: 'failure', pageChanged: false, detail: `Missing: ${missing.join(', ')}` })
              continue
            }
            const candidate = first.offer
            replayBrowser = create(`${options.owner}:verify`)
            const replayOpen = await replayBrowser.open(candidate.url)
            if (replayOpen.status !== 'success') {
              const problem = browserProblem(replayOpen.error)
              return result(problem.status, problem.code, `replay open: ${replayOpen.error.message}`, page, progress, missing, metrics, undefined, candidate)
            }
            const replayShot = await replayBrowser.snapshot({ compact: false })
            if (replayShot.status !== 'success') return result('failed', browserProblem(replayShot.error).code, replayShot.error.message, page, progress, missing, metrics, undefined, candidate)
            let replayPage = replayShot.page
            const replayBlocker = blocker(replayPage)
            if (replayBlocker) return result('blocked', replayBlocker, replayBlocker, replayPage, progress, missing, metrics, undefined, candidate)
            try {
              replayPage = await restoreNativeSpecs(replayBrowser, replayPage, task.specs)
              metrics.extractionCalls += 1
              const replayFields = await (options.extract ?? extractObservedFields)(replayPage, requirements, { signal: options.signal })
              addExtraction(replayFields.metrics)
              const second = checkObservedOffer(replayPage, requirements, replayFields.fields)
              if (!second.offer || !sameOfferIdentity(candidate, second.offer)) {
                return result('blocked', 'verification_failed', 'reopened page did not reproduce the required product, selection, seller and price evidence', replayPage, second.progress, second.missing, metrics, undefined, candidate)
              }
              return result('success', 'completed', 'offer reproduced in a separate browser session', replayPage, second.progress, [], metrics, second.offer)
            } catch (error) {
              if (options.signal.aborted) return result('cancelled', 'cancelled', 'task cancelled', replayPage, progress, missing, metrics, undefined, candidate)
              if (error instanceof ShoppingBrowserError) {
                const problem = browserProblem(error.browserError)
                return result(problem.status, problem.code, error.message, replayPage, progress, missing, metrics, undefined, candidate)
              }
              return result('blocked', 'verification_failed', String(error), replayPage, progress, missing, metrics, undefined, candidate)
            }
          }
          let text: string | undefined
          if (selected.operation === 'TYPE_TEXT') {
            try {
              const value = await (options.textInput ?? resolveTextInput)(context, page!, selected.target!, { signal: options.signal })
              metrics.textModelDurationMs += value.metrics.durationMs
              if (value.status === 'missing') return result('blocked', 'text_error', 'text input could not be determined', page, progress, missing, metrics)
              text = value.text
            } catch (error) {
              if (options.signal.aborted) return result('cancelled', 'cancelled', 'task cancelled', page, progress, missing, metrics)
              return result('failed', 'text_error', String(error), page, progress, missing, metrics)
            }
          }
          let performed: BrowserActionResult
          try {
            performed = await executeSelectedAction(actionBrowser, selected, request, text) as BrowserActionResult
          } catch (error) {
            if (options.signal.aborted) return result('cancelled', 'cancelled', 'task cancelled', page, progress, missing, metrics)
            return result('failed', 'browser_error', String(error), page, progress, missing, metrics)
          }
          metrics.browserActions += 1
          if (performed.status === 'failure') {
            history.push({ operation: selected.operation, status: 'failure', pageChanged: false, detail: performed.error.message })
            const problem = browserProblem(performed.error)
            return result(problem.status, problem.code, performed.error.message, performed.page ?? page, progress, missing, metrics)
          }
          const observed = await actionBrowser.snapshot({ compact: false })
          if (observed.status !== 'success') {
            const problem = browserProblem(observed.error)
            return result(problem.status, problem.code, observed.error.message, page, progress, missing, metrics)
          }
          const changed = observed.page.origin !== page!.origin || observed.page.tree !== page!.tree
          history.push({
            operation: selected.operation,
            ...(selected.target ? { target: selected.target.name } : {}),
            status: performed.status,
            pageChanged: changed,
            ...(performed.status === 'success' ? {} : { detail: performed.error.message }),
          })
          page = observed.page
          if (changed) {
            progress = []; missing = []; rejectedDone = ''; lastStall = ''
          } else {
            const stall = `${selected.operation}:${selected.targetId ?? ''}:${page.origin}:${page.tree}`
            if (stall === lastStall) {
              return result('blocked', 'no_progress', 'same action produced no observable change twice; DSH Agent should inspect the page', page, progress, missing, metrics)
            }
            lastStall = stall
          }
        }
      })()
    }
  } catch (error) {
    output = result(options.signal.aborted ? 'cancelled' : 'failed', options.signal.aborted ? 'cancelled' : 'browser_error', String(error), page, progress, missing, metrics)
  }
  const cleanup: string[] = []
  for (const browser of [replayBrowser, actionBrowser]) {
    if (!browser) continue
    const closed = await browser.close()
    if (closed.status !== 'success') cleanup.push(`${browser.session}: ${closed.error.message}`)
  }
  if (cleanup.length > 0) {
    return { ...output!, status: 'failed', reasonCode: 'cleanup_failed', reason: cleanup.join('; '), cleanupError: cleanup.join('; ') }
  }
  return output!
}
