import { createServer } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import {
  AgentBrowserSession,
  DEFAULT_JEV_BASE_URL,
  DEFAULT_JEV_MODEL,
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
    expect(Buffer.byteLength(state.page.text)).toBeLessThanOrEqual(6_000)
    expect(state.page.text.length).toBeGreaterThan(0)
    expect(state.task.progress).toEqual(['型号已找到'])
    expect(request.payload.model).toBe(DEFAULT_JEV_MODEL)
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
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      expect(url).toBe(`${DEFAULT_JEV_BASE_URL}/v1/systemone`)
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

  it('uses the caller-provided Jev timeout', async () => {
    const request = buildActionRequest(task, page, [])
    let signal: AbortSignal | undefined
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      signal = init?.signal as AbortSignal
      return new Response(JSON.stringify({ answers: { operation: { choice: 'BLOCKED' } } }), { status: 200 })
    })
    await chooseAction(request, { apiKey: 'test-only', fetcher, timeoutMs: 45_000 })
    expect(signal).toBeDefined()
    expect(signal?.aborted).toBe(false)
  })

  it('uses the direct transport even when proxy variables are present', async () => {
    const request = buildActionRequest(task, page, [])
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ answers: { operation: { choice: 'BLOCKED' } } }))
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('test server has no port')
    const previous = process.env.HTTP_PROXY
    process.env.HTTP_PROXY = 'http://127.0.0.1:1'
    try {
      const result = await chooseAction(request, {
        apiKey: 'test-only', endpoint: `http://127.0.0.1:${address.port}/v1/systemone`, timeoutMs: 2_000,
      })
      expect(result.operation).toBe('BLOCKED')
    } finally {
      if (previous === undefined) delete process.env.HTTP_PROXY
      else process.env.HTTP_PROXY = previous
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })

  it('accepts the gateway Community data.answers envelope', () => {
    const request = buildActionRequest(task, page, [])
    const result = resolveAction({ code: 0, data: {
      model: 'jev-1.13.0',
      answers: { operation: { type: 'choice', choice: 'BLOCKED' } },
      usage: { input_tokens: 12, output_tokens: 3 },
    } }, request, 5)
    expect(result).toMatchObject({ operation: 'BLOCKED', model: 'jev-1.13.0', usage: { input_tokens: 12 } })
  })

  it('rejects requests above the gateway size limit before sending them', async () => {
    const request = buildActionRequest(task, { ...page, tree: '测'.repeat(20_000) }, [])
    const fetcher = vi.fn<typeof fetch>()
    const oversized = { ...request, payload: { ...request.payload, state: { page: '测'.repeat(20_000) } } }
    await expect(chooseAction(oversized, { apiKey: 'test-only', fetcher })).rejects.toThrow(/32 KiB limit/)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('keeps task-relevant controls after the old 100-element cutoff and exposes every other batch', () => {
    const elements = Array.from({ length: 151 }, (_, index) => ({ session: page.session, pageRevision: page.revision,
      ref: `e${index + 1}`, role: 'link', name: index === 150 ? '型号 A 2TB' : `导航 ${index}` }))
    const current = { ...page, elements }
    const seen = new Set<string>()
    let offset = 0
    const first = buildActionRequest(task, current, [], undefined, { maxTargets: 20 })
    expect(Object.keys(first.targets.CLICK ?? {})).toEqual(elements.slice(0, 20).map(item => item.ref))
    expect(first.payload.questions.operation?.criteria).toHaveProperty('MORE_TARGETS')
    for (;;) {
      const request = buildActionRequest(task, current, [], undefined, { maxTargets: 20, targetOffset: offset })
      Object.keys(request.targets.CLICK ?? {}).forEach(id => seen.add(id))
      if (request.nextTargetOffset === undefined) {
        expect(request.payload.questions.operation?.criteria).not.toHaveProperty('MORE_TARGETS')
        break
      }
      expect(request.nextTargetOffset).toBeGreaterThan(offset)
      offset = request.nextTargetOffset
    }
    expect(seen.size).toBe(151)
  })

  it('does not rank targets by product or cookie keywords', () => {
    const current = { ...page, elements: [
      { session: page.session, pageRevision: page.revision, ref: 'e1' as const, role: 'link', name: 'Unrelated navigation' },
      { session: page.session, pageRevision: page.revision, ref: 'e2' as const, role: 'button', name: 'Cookies ablehnen 型号 A 2TB' },
    ] }
    expect(Object.keys(buildActionRequest(task, current, [], undefined, { maxTargets: 1 }).targets.CLICK ?? {})).toEqual(['e1'])
    expect(Object.keys(buildActionRequest(task, current, [], undefined, { maxTargets: 1, targetOffset: 1 }).targets.CLICK ?? {})).toEqual(['e2'])
  })

  it('filters disabled/stale controls before building either candidate heads or singleton state', () => {
    const current = { ...page, tree: '- button "搜索" [ref=e2] [disabled]', elements: [
      page.elements[1]!, { ...page.elements[0]!, pageRevision: 1 }, { ...page.elements[2]!, session: 'other' },
    ] }
    const request = buildActionRequest(task, current, [])
    expect(request.targets).toEqual({})
    expect(request.payload.questions.operation?.criteria).not.toHaveProperty('CLICK')
  })

  it('reuses exact task text without a model call, and reports missing text', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const explicit = await resolveTextInput(task, page, page.elements[0]!, { fetcher })
    expect(explicit).toMatchObject({ status: 'ready', text: '型号 A 2TB', metrics: { source: 'task', costUsd: 0 } })
    expect(fetcher).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('returns missing text to the source Agent without making a hidden model call', async () => {
    const fetcher = vi.fn<typeof fetch>()
    const noText = { goal: task.goal, constraints: task.constraints, doneWhen: task.doneWhen, progress: task.progress }
    expect(await resolveTextInput(noText, page, page.elements[0]!, { fetcher })).toMatchObject({ status: 'missing', metrics: { source: 'task', inputTokens: 0, outputTokens: 0 } })
    expect(fetcher).not.toHaveBeenCalled()
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
