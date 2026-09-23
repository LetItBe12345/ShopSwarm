import { describe, expect, it, vi } from 'vitest'
import {
  AgentBrowserSession,
  buildActionRequest,
  chooseAction,
  executeSelectedAction,
  resolveAction,
  resolveTextInput,
  type BrowserCommandRunner,
  type BrowserPageState,
  type ShoppingTaskContext,
} from '../src/index.js'

const page: BrowserPageState = {
  session: 'test-session',
  revision: 3,
  origin: 'https://shop.example/search',
  tree: '- textbox "搜索商品"\n- button "搜索"\n- link "商品详情"',
  elements: [
    { session: 'test-session', pageRevision: 3, ref: 'e1', role: 'textbox', name: '搜索商品' },
    { session: 'test-session', pageRevision: 3, ref: 'e2', role: 'button', name: '搜索' },
    { session: 'test-session', pageRevision: 3, ref: 'e3', role: 'link', name: '商品详情' },
  ],
  removedRefs: [],
}
const task: ShoppingTaskContext = {
  goal: '查找指定型号的价格',
  constraints: ['型号 A', '容量 2TB'],
  doneWhen: ['型号匹配', '价格可见'],
  progress: ['型号已找到'],
  textInputs: { 搜索商品: '型号 A 2TB' },
}

describe('M2.1 Jev action selection', () => {
  it('builds bounded context and current-page operation/target heads', () => {
    const request = buildActionRequest(task, { ...page, tree: 'x'.repeat(15_000) }, [
      { operation: 'CLICK', status: 'success', pageChanged: true, detail: 'opened results' },
    ])
    const state = request.payload.state as { page: { text: string }; task: { progress: string[] } }
    expect(state.page.text).toHaveLength(12_000)
    expect(state.task.progress).toEqual(['型号已找到'])
    expect(request.payload.questions.operation?.criteria).toHaveProperty('TYPE_TEXT')
    expect(request.payload.questions.operation?.criteria).toHaveProperty('BACK')
    expect(request.payload.questions.click_target?.criteria).toEqual({ e2: 'button: 搜索', e3: 'link: 商品详情' })
    expect(request.singletons.TYPE_TEXT).toBe('e1')
    expect(request.payload.questions.type_text_target).toBeUndefined()
  })

  it('rejects invalid model targets and uses only the matching target head', () => {
    const request = buildActionRequest(task, page, [])
    expect(() => resolveAction({ answers: { operation: { choice: 'CLICK' }, click_target: { choice: 'e99' } } }, request, 1))
      .toThrow(/invalid Jev click_target choice/)
    expect(() => resolveAction({ answers: { operation: { choice: 'SELECT' } } }, request, 1))
      .toThrow(/invalid Jev operation choice/)
    const selected = resolveAction({ answers: {
      operation: { choice: 'TYPE_TEXT' },
      click_target: { choice: 'e99' },
    } }, request, 4)
    expect(selected).toMatchObject({ operation: 'TYPE_TEXT', target: { ref: 'e1' }, durationMs: 4 })
  })

  it('offers only observed dropdown options to SELECT and executes the chosen value', async () => {
    const comboPage: BrowserPageState = {
      ...page,
      tree: '- combobox "容量":\n  - option "1TB" [selected]\n  - option "2TB"',
      elements: [{ session: page.session, pageRevision: page.revision, ref: 'e4', role: 'combobox', name: '容量' }],
    }
    const request = buildActionRequest(task, comboPage, [])
    expect(request.payload.questions.select_target?.criteria).toEqual({
      'e4:1': 'combobox: 容量 → 1TB',
      'e4:2': 'combobox: 容量 → 2TB',
    })
    expect(request.selectValues['e4:2']).toBe('2TB')
    expect(request.payload.questions.operation?.criteria).not.toHaveProperty('TYPE_TEXT')
    expect(() => resolveAction({ answers: { operation: { choice: 'SELECT' }, select_target: { choice: 'e4:3' } } }, request, 1))
      .toThrow(/invalid Jev select_target choice/)

    const commands: string[][] = []
    const runner: BrowserCommandRunner = async args => {
      commands.push([...args])
      return { exitCode: 0, stderr: '', stdout: JSON.stringify({ success: true, data: {
        origin: comboPage.origin, snapshot: comboPage.tree,
        refs: { e4: { role: 'combobox', name: '容量' } }, removedRefs: [],
      } }) }
    }
    const browser = new AgentBrowserSession({ owner: 'jev-select-test', signal: new AbortController().signal, timeoutMs: 1_000, commandRunner: runner })
    const shot = await browser.snapshot()
    expect(shot.status).toBe('success')
    if (shot.status !== 'success') return
    const currentRequest = buildActionRequest(task, shot.page, [])
    const selected = resolveAction({ answers: { operation: { choice: 'SELECT' }, select_target: { choice: 'e4:2' } } }, currentRequest, 1)
    expect(await executeSelectedAction(browser, selected, currentRequest)).toMatchObject({ status: 'success', action: 'select' })
    expect(commands.some(command => command.includes('select') && command.includes('2TB'))).toBe(true)
  })

  it('calls the Jev endpoint with state/questions and rejects a malformed answer', async () => {
    const request = buildActionRequest(task, page, [])
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      const sent = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(sent).toHaveProperty('state')
      expect(sent).toHaveProperty('questions')
      expect(init?.signal).toBeDefined()
      return new Response(JSON.stringify({ model: 'jev-latest', answers: { operation: { choice: 'BLOCKED' } } }), { status: 200 })
    })
    const result = await chooseAction(request, { apiKey: 'test-only', fetcher })
    expect(result.operation).toBe('BLOCKED')
    expect(fetcher).toHaveBeenCalledOnce()
    await expect(chooseAction(request, { apiKey: 'test-only', fetcher: async () => new Response('{}') }))
      .rejects.toThrow(/invalid Jev response/)
  })

  it('reuses exact task text without a model call, and reports missing text', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const explicit = await resolveTextInput(task, page, page.elements[0]!, { fetcher })
    expect(explicit).toMatchObject({ status: 'ready', text: '型号 A 2TB', metrics: { source: 'task', costUsd: 0 } })
    expect(fetcher).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('calls DeepSeek only when task text is absent and records usage without inventing cost', async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      const sent = JSON.parse(String(init?.body)) as { model: string }
      expect(sent.model).toBe('deepseek-flash')
      return new Response(JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: '{"text":"型号 A 2TB"}' } }],
        usage: { prompt_tokens: 50, completion_tokens: 10 },
      }))
    })
    const noText = { goal: task.goal, constraints: task.constraints, doneWhen: task.doneWhen, progress: task.progress }
    const result = await resolveTextInput(noText, page, page.elements[0]!, {
      apiKey: 'test-only', fetcher,
    })
    expect(result).toMatchObject({ status: 'ready', text: '型号 A 2TB', metrics: {
      source: 'deepseek', inputTokens: 50, outputTokens: 10, costUsd: null,
    } })
    expect(fetcher).toHaveBeenCalledOnce()
    const absent = await resolveTextInput({ ...noText, textInputs: { 搜索商品: '' } }, page, page.elements[0]!, {
      apiKey: 'test-only', fetcher: async () => new Response(JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: '{"text":null}' } }],
      })),
    })
    expect(absent.status).toBe('missing')
  })

  it('checks the page revision immediately before browser execution', async () => {
    const commands: string[][] = []
    const runner: BrowserCommandRunner = async args => {
      commands.push([...args])
      return { exitCode: 0, stderr: '', stdout: JSON.stringify({ success: true, data: {
        origin: page.origin, snapshot: page.tree,
        refs: { e1: { role: 'textbox', name: '搜索商品' }, e2: { role: 'button', name: '搜索' }, e3: { role: 'link', name: '商品详情' } },
        removedRefs: [],
      } }) }
    }
    const browser = new AgentBrowserSession({ owner: 'jev-action-test', signal: new AbortController().signal, timeoutMs: 1_000, commandRunner: runner })
    const shot = await browser.snapshot()
    expect(shot.status).toBe('success')
    if (shot.status !== 'success') return
    const request = buildActionRequest(task, shot.page, [])
    const selected = resolveAction({ answers: { operation: { choice: 'TYPE_TEXT' } } }, request, 1)
    const before = commands.length
    await browser.snapshot()
    await expect(executeSelectedAction(browser, selected, request, '型号 A 2TB')).rejects.toThrow(/page changed/)
    expect(commands.length).toBe(before + 1)
    const fresh = buildActionRequest(task, browser.currentPage!, [])
    const freshAction = resolveAction({ answers: { operation: { choice: 'TYPE_TEXT' } } }, fresh, 1)
    expect(await executeSelectedAction(browser, freshAction, fresh, '型号 A 2TB')).toMatchObject({ status: 'success', action: 'fill' })
    expect(commands.some(command => command.includes('fill'))).toBe(true)
  })

  it('refreshes the snapshot after Jev and refuses a target that disappeared', async () => {
    let snapshots = 0
    const commands: string[][] = []
    const runner: BrowserCommandRunner = async args => {
      commands.push([...args])
      if (args.includes('snapshot')) snapshots += 1
      return { exitCode: 0, stderr: '', stdout: JSON.stringify({ success: true, data: {
        origin: page.origin, snapshot: snapshots === 1 ? page.tree : '- button "其他内容"',
        refs: snapshots === 1
          ? { e1: { role: 'textbox', name: '搜索商品' } }
          : { e9: { role: 'button', name: '其他内容' } },
        removedRefs: [],
      } }) }
    }
    const browser = new AgentBrowserSession({ owner: 'jev-vanished-test', signal: new AbortController().signal, timeoutMs: 1_000, commandRunner: runner })
    const shot = await browser.snapshot()
    expect(shot.status).toBe('success')
    if (shot.status !== 'success') return
    const request = buildActionRequest(task, shot.page, [])
    const selected = resolveAction({ answers: { operation: { choice: 'TYPE_TEXT' } } }, request, 1)
    await expect(executeSelectedAction(browser, selected, request, '型号 A 2TB')).rejects.toThrow(/target changed/)
    expect(commands.some(command => command.includes('fill'))).toBe(false)
  })
})
