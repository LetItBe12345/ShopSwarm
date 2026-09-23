import { describe, expect, it } from 'vitest'
import {
  AgentBrowserSession, resolveAction, runShoppingTask,
  type BrowserCommandRunner, type ObservedFields,
} from '../src/index.js'

const url = 'https://shop.example/item/1'
const tree = '- heading "型号 A"\n- combobox "容量":\n  - option "1TB"\n  - option "2TB" [selected]\n- text "京东自营"\n- text "￥1,299.00"'
const task = { startUrl: url, goal: '找型号 A 2TB 的自营报价', model: '型号 A', specs: [{ name: '容量', value: '2TB' }], seller: '京东自营' }

function fields(currentTree: string): ObservedFields {
  return {
    model: '型号 A', modelExcerpt: 'heading "型号 A"',
    specs: [{ name: '容量', value: '2TB', excerpt: 'option "2TB" [selected]' }],
    seller: '京东自营', sellerExcerpt: 'text "京东自营"',
    priceExcerpt: currentTree.includes('1,199.00') ? 'text "￥1,199.00"' : 'text "￥1,299.00"',
  }
}

function harness(firstTree: string, replayTree = firstTree) {
  const commands: { owner: string; command: string }[] = []
  const createBrowser = (owner: string): AgentBrowserSession => {
    const runner: BrowserCommandRunner = async args => {
      const command = args[args.indexOf('--json') + 1]!
      commands.push({ owner, command })
      const currentTree = owner.endsWith(':verify') ? replayTree : firstTree
      return { exitCode: 0, stderr: '', stdout: JSON.stringify({ success: true, data: {
        origin: url, snapshot: currentTree,
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
    expect(output.metrics.jevCalls).toBe(2)
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
    expect(output.metrics.jevCalls).toBe(0)
  })

  it('returns a captcha block without trying actions', async () => {
    const { createBrowser } = harness('- heading "请完成安全验证"\n- text "滑动验证"')
    const output = await runShoppingTask(task, {
      owner: 'task-5', signal: new AbortController().signal, timeoutMs: 1_000,
      createBrowser, choose: chooseDone, extract,
    })
    expect(output).toMatchObject({ status: 'blocked', reasonCode: 'captcha' })
    expect(output.metrics.jevCalls).toBe(0)
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
