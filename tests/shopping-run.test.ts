import { describe, expect, it } from 'vitest'
import {
  AgentBrowserSession, resolveAction, runShoppingTask,
  type BrowserCommandRunner, type ObservedFields,
} from '../src/index.js'

const url = 'https://shop.example/item/1'
const tree = '- heading "示例型号"\n- combobox "容量":\n  - option "1TB"\n  - option "2TB" [selected]\n- text "示例提供方"\n- text "￥1,299.00"'
const task = { startUrl: url, goal: '读取 示例型号 已选规格的标价', model: '示例型号', specs: [{ name: '容量', value: '2TB' }], seller: '示例提供方' }

function fields(currentTree: string): ObservedFields {
  return {
    model: '示例型号', modelExcerpt: 'heading "示例型号"',
    specs: [{ name: '容量', value: '2TB', excerpt: 'option "2TB" [selected]' }],
    seller: '示例提供方', sellerExcerpt: 'text "示例提供方"',
    priceExcerpt: currentTree.includes('1,199.00') ? 'text "￥1,199.00"' : 'text "￥1,299.00"',
  }
}

function harness(firstTree: string, replayTree = firstTree, pageUrl = url) {
  const commands: { owner: string; command: string }[] = []
  const createBrowser = (owner: string): AgentBrowserSession => {
    const runner: BrowserCommandRunner = async args => {
      const command = args[args.indexOf('--json') + 1]!
      commands.push({ owner, command })
      const currentTree = owner.endsWith(':verify') ? replayTree : firstTree
      return { exitCode: 0, stderr: '', stdout: JSON.stringify({ success: true, data: {
        origin: pageUrl, snapshot: currentTree,
        refs: { e1: { role: 'combobox', name: '容量' } }, removedRefs: [],
      } }) }
    }
    return new AgentBrowserSession({ owner, signal: new AbortController().signal, timeoutMs: 1_000, commandRunner: runner })
  }
  return { commands, createBrowser }
}

const chooseDone = async (request: Parameters<typeof resolveAction>[1]) =>
  resolveAction({ answers: { operation: { choice: 'DONE' } } }, request, 1)
const extract = async (page: { tree: string }) => ({ fields: fields(page.tree), metrics: {
  model: 'test', durationMs: 0, inputTokens: 0, outputTokens: 0, costUsd: null as null,
} })

describe('M2.2 shopping loop and result', () => {
  it('reopens the product in a second session and uses the replay price', async () => {
    const { commands, createBrowser } = harness(tree, tree.replace('1,299.00', '1,199.00'))
    const output = await runShoppingTask(task, {
      owner: 'task-1', signal: new AbortController().signal, timeoutMs: 1_000,
      createBrowser, choose: chooseDone, extract,
    })
    expect(output.status).toBe('success')
    expect(output.offer?.listedPrice).toEqual({ status: 'known', value: { currency: 'CNY', minor: 119900 } })
    expect(commands.filter(item => item.command === 'eval')).toHaveLength(2)
    expect(commands.filter(item => item.command === 'close')).toHaveLength(2)
  })

  it('hands repeated false DONE to DSH with missing evidence', async () => {
    const noPrice = tree.replace('￥1,299.00', '价格待登录查看')
    const { commands, createBrowser } = harness(noPrice)
    const output = await runShoppingTask(task, {
      owner: 'task-2', signal: new AbortController().signal, timeoutMs: 1_000,
      createBrowser, choose: chooseDone, extract,
    })
    expect(output).toMatchObject({ status: 'blocked', reasonCode: 'no_progress' })
    expect(output.missing).toContain('明确标价或币种证据')
    expect(output.offer).toBeUndefined()
    expect(output.metrics.actionDecisionCalls).toBe(2)
    expect(commands.filter(item => item.command === 'eval')).toHaveLength(1)
  })

  it('does not accept a changed selected spec on replay', async () => {
    const { createBrowser } = harness(tree, tree.replace('option "2TB" [selected]', 'option "2TB"'))
    const output = await runShoppingTask(task, {
      owner: 'task-3', signal: new AbortController().signal, timeoutMs: 1_000,
      createBrowser, choose: chooseDone, extract,
    })
    expect(output).toMatchObject({ status: 'blocked', reasonCode: 'verification_failed' })
    expect(output.offer).toBeUndefined()
    expect(output.candidate).toBeDefined()
  })

  it('returns a login instruction and does not call Jev', async () => {
    const { createBrowser } = harness('- heading "请登录"\n- textbox "密码"\n- button "登录"')
    const output = await runShoppingTask(task, {
      owner: 'task-4', signal: new AbortController().signal, timeoutMs: 1_000,
      createBrowser, choose: chooseDone, extract,
    })
    expect(output).toMatchObject({ status: 'blocked', reasonCode: 'login_required' })
    expect(output.userMessage).toContain('重新登录')
    expect(output.metrics.actionDecisionCalls).toBe(0)
  })

  it('reports a shopping site rate limit before asking either model for an action', async () => {
    const { createBrowser } = harness('- text "抱歉由于访问频繁导致无法搜索，请稍后再试！"')
    const output = await runShoppingTask(task, {
      owner: 'rate-limit', signal: new AbortController().signal, timeoutMs: 1_000,
      createBrowser, choose: chooseDone, extract,
    })
    expect(output).toMatchObject({ status: 'blocked', reasonCode: 'site_rate_limited' })
    expect(output.metrics.actionDecisionCalls).toBe(0)
  })

  it('recognizes a login redirect before asking for an action', async () => {
    const { createBrowser } = harness('- heading "请登录"', undefined, 'https://accounts.example/passport/login')
    const output = await runShoppingTask(task, {
      owner: 'login-redirect', signal: new AbortController().signal, timeoutMs: 1_000,
      createBrowser, choose: chooseDone, extract,
    })
    expect(output).toMatchObject({ status: 'blocked', reasonCode: 'login_required' })
    expect(output.metrics.actionDecisionCalls).toBe(0)
  })

  it('returns a captcha block without trying actions', async () => {
    const { createBrowser } = harness('- heading "请完成安全验证"\n- text "滑动验证"')
    const output = await runShoppingTask(task, {
      owner: 'task-5', signal: new AbortController().signal, timeoutMs: 1_000,
      createBrowser, choose: chooseDone, extract,
    })
    expect(output).toMatchObject({ status: 'blocked', reasonCode: 'captcha' })
    expect(output.metrics.actionDecisionCalls).toBe(0)
  })

  it('returns Jev BLOCKED to DSH without claiming an offer', async () => {
    const { createBrowser } = harness('- heading "商品列表为空"')
    const output = await runShoppingTask(task, {
      owner: 'task-blocked', signal: new AbortController().signal, timeoutMs: 1_000,
      createBrowser,
      choose: async request => resolveAction({ answers: { operation: { choice: 'BLOCKED' } } }, request, 1),
      extract,
    })
    expect(output).toMatchObject({ status: 'blocked', reasonCode: 'no_progress' })
    expect(output.offer).toBeUndefined()
  })

  it('hands Jev failures to the current source Subagent', async () => {
    const { createBrowser } = harness('- button "继续"')
    const output = await runShoppingTask(task, {
      owner: 'task-jev-fallback', signal: new AbortController().signal, timeoutMs: 1_000,
      createBrowser,
      choose: async () => { throw new Error('Jev timed out') },
      extract,
    })
    expect(output).toMatchObject({
      status: 'failed', reasonCode: 'jev_error',
      handoff: { owner: 'subagent', reason: 'jev_error' },
    })
    expect(output.userMessage).toContain('shopswarm_browse')
  })

  it('passes the configured Jev timeout to the action selector', async () => {
    const { createBrowser } = harness('- button "继续"')
    let timeout: number | undefined
    const output = await runShoppingTask(task, {
      owner: 'task-jev-timeout', signal: new AbortController().signal, timeoutMs: 1_000,
      jevTimeoutMs: 45_000, createBrowser,
      choose: async (request, options) => {
        timeout = options.timeoutMs
        return resolveAction({ answers: { operation: { choice: 'BLOCKED' } } }, request, 1)
      }, extract,
    })
    expect(output.reasonCode).toBe('no_progress')
    expect(timeout).toBe(45_000)
  })

  it('hands login pages back to Lead instead of asking Lead to click', async () => {
    const { createBrowser } = harness('- heading "请登录"\n- textbox "密码"\n- button "登录"')
    const output = await runShoppingTask(task, {
      owner: 'task-lead-handoff', signal: new AbortController().signal, timeoutMs: 1_000,
      createBrowser, choose: chooseDone, extract,
    })
    expect(output).toMatchObject({
      status: 'blocked', reasonCode: 'login_required',
      handoff: { owner: 'lead', reason: 'login_required' },
    })
  })

  it('returns a structured browser timeout', async () => {
    const createBrowser = (owner: string) => new AgentBrowserSession({
      owner, signal: new AbortController().signal, timeoutMs: 1_000,
      commandRunner: async args => ({
        exitCode: args.includes('close') ? 0 : 1,
        stderr: '',
        stdout: JSON.stringify(args.includes('close')
          ? { success: true, data: {} }
          : { success: false, error: 'Timeout 1000ms exceeded' }),
      }),
    })
    const output = await runShoppingTask(task, {
      owner: 'task-6', signal: new AbortController().signal, timeoutMs: 1_000,
      createBrowser, choose: chooseDone, extract,
    })
    expect(output).toMatchObject({ status: 'failed', reasonCode: 'browser_timeout' })
  })

  it('reports cancellation during extraction and closes the session', async () => {
    const controller = new AbortController()
    const { commands, createBrowser } = harness(tree)
    const output = await runShoppingTask(task, {
      owner: 'task-cancel', signal: controller.signal, timeoutMs: 1_000,
      createBrowser, choose: chooseDone,
      extract: async () => { controller.abort(); throw new Error('aborted') },
    })
    expect(output).toMatchObject({ status: 'cancelled', reasonCode: 'cancelled' })
    expect(commands.filter(item => item.command === 'close')).toHaveLength(1)
  })
})
