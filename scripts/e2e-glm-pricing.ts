import { execFileSync } from 'node:child_process'
import { AgentBrowserSession } from '../src/browser/agent-browser-session.js'
import { buildActionRequest, chooseAction, executeSelectedAction } from '../src/jev.js'
import { chooseLlmAction } from '../src/llm-action.js'
import type { ActionRequest, RecentAction, SelectedAction } from '../src/jev.js'
import type { BrowserPageState } from '../src/browser/types.js'

// Action-selection trace on live public pages; this does not verify a final price.
if (!process.env.JEV_API_KEY || !process.env.DEEPSEEK_API_KEY) {
  throw new Error('JEV_API_KEY and DEEPSEEK_API_KEY are required')
}

const pages = [
  { id: 'zai-pricing', url: 'https://docs.z.ai/guides/overview/pricing' },
  { id: 'openrouter', url: 'https://openrouter.ai/z-ai/glm-5.3' },
  { id: 'bigmodel-coding-plan', url: 'https://docs.bigmodel.cn/cn/coding-plan/overview' },
] as const

const goal = '在当前公开页面找到 GLM-5.3 的输入、缓存输入和输出单价，保留币种和计费单位。不要打开登录或支付。'
const doneWhen = ['当前快照能读到 GLM-5.3', '能读到输入单价和输出单价', '能读到币种或计费单位']

function focus(): string {
  if (!process.env.DISPLAY) return 'no-display'
  try {
    return execFileSync('xprop', ['-root', '_NET_ACTIVE_WINDOW'], { encoding: 'utf8', timeout: 3_000 }).trim()
  } catch (error) {
    return `unread:${error instanceof Error ? error.message : String(error)}`
  }
}

function excerpt(tree: string): string {
  const at = tree.search(/GLM-?\s*5\.3/i)
  if (at < 0) return tree.slice(0, 500)
  return tree.slice(Math.max(0, at - 180), at + 420).replace(/\s+/g, ' ')
}

async function drive(
  label: string,
  url: string,
  choose: (request: ActionRequest) => Promise<SelectedAction>,
): Promise<Record<string, unknown>> {
  const browser = new AgentBrowserSession({ owner: `glm-${label}`, timeoutMs: 30_000, signal: AbortSignal.timeout(180_000) })
  const started = performance.now()
  const actions: Record<string, unknown>[] = []
  const history: RecentAction[] = []
  let page: BrowserPageState | undefined
  try {
    const opened = await browser.open(url)
    if (opened.status !== 'success') {
      return { label, url, browserOk: false, error: opened.error.message, elapsedMs: Math.round(performance.now() - started) }
    }
    for (let step = 0; step < 3; step += 1) {
      const shot = await browser.snapshot()
      if (shot.status !== 'success') {
        return { label, url, browserOk: false, error: shot.error.message, actions, elapsedMs: Math.round(performance.now() - started) }
      }
      page = shot.page
      const request = buildActionRequest({ goal, constraints: ['只记录 GLM-5.3，不把 GLM-5.3-Flash 当成 GLM-5.3'], doneWhen, progress: [] }, page, history)
      const selected = await choose(request)
      actions.push({
        operation: selected.operation,
        target: selected.target?.name,
        model: selected.model,
        durationMs: selected.durationMs,
        usage: selected.usage,
      })
      const executed = await executeSelectedAction(browser, selected, request)
      if ('operation' in executed && executed.status === 'decision') break
      if (executed.status !== 'success') {
        history.push({ operation: selected.operation, status: 'failure', pageChanged: false, detail: executed.error.message })
        break
      }
      history.push({ operation: selected.operation, status: 'success', pageChanged: true })
    }
    const finalShot = await browser.snapshot()
    const finalPage = finalShot.status === 'success' ? finalShot.page : page
    return {
      label, url, browserOk: true, finalUrl: finalPage?.origin, actions,
      excerpt: finalPage ? excerpt(finalPage.tree) : '',
      elapsedMs: Math.round(performance.now() - started),
    }
  } catch (error) {
    return { label, url, browserOk: false, error: error instanceof Error ? error.message : String(error), actions, excerpt: page ? excerpt(page.tree) : '', elapsedMs: Math.round(performance.now() - started) }
  } finally {
    await browser.close()
  }
}

const before = focus()
const results = []
for (const page of pages) {
  results.push(await drive(`${page.id}-jev`, page.url, request => chooseAction(request)))
  results.push(await drive(`${page.id}-deepseek-v4-flash`, page.url, request => chooseLlmAction(request, { model: 'deepseek-v4-flash' })))
}
const after = focus()
console.log(JSON.stringify({ observedAt: new Date().toISOString(), focus: { before, after, changed: before !== after }, results }, null, 2))
