import { describe, expect, it, vi } from 'vitest'
import { AgentBrowserSession, createShoppingTaskRun, resolveAction, type BrowserCommandRunner } from '../src/index.js'

const url = 'https://shop.example/item'
const task = { startUrl: url, goal: '研究型号、价格与条件，不购买' }
function setup(tree = '- heading "SM 7 B"\n- text "398 €"', choose = vi.fn(async (request: Parameters<typeof resolveAction>[1]) => resolveAction({ answers: { operation: { choice: 'DONE' } } }, request, 1))) {
  const commands: string[] = []
  const runner: BrowserCommandRunner = async args => {
    commands.push(args[args.indexOf('--json') + 1]!)
    return { exitCode: 0, stderr: '', stdout: JSON.stringify({ success: true, data: { origin: url, snapshot: tree, refs: { e1: { role: 'button', name: '查看' } }, removedRefs: [] } }) }
  }
  const run = createShoppingTaskRun(task, { owner: 'unit-source', signal: new AbortController().signal, timeoutMs: 1000, choose,
    createBrowser: owner => new AgentBrowserSession({ owner, signal: new AbortController().signal, timeoutMs: 1000, commandRunner: runner }) })
  return { run, commands, choose }
}

describe('source Agent research', () => {
  it('opens and exposes observations without Jev or product-field requirements', async () => {
    const { run, choose } = setup()
    try {
      expect(await run.start()).toMatchObject({ status: 'ready', handoff: { owner: 'caller' } })
      expect(choose).not.toHaveBeenCalled()
      expect(run.cliConnection.args).toContain('--session')
    } finally { await run.close() }
    expect(run.suspended).toBe(false)
    expect(() => run.read()).toThrow('closed')
  })
  it('keeps login-looking text available for Agent judgment without keyword blocking', async () => {
    const { run } = setup('- heading "请登录"\n- textbox "密码"\n- text "captcha rate limit"')
    try { expect(await run.start()).toMatchObject({ status: 'ready', reasonCode: 'agent_review' }) }
    finally { await run.close() }
  })
  it('returns DONE or Jev errors to the source Agent without forcing a replay or ending the source', async () => {
    const { run, commands, choose } = setup()
    try {
      await run.start()
      expect(await run.jev()).toMatchObject({ status: 'ready', reasonCode: 'jev_done' })
      choose.mockRejectedValueOnce(new Error('gateway error'))
      expect(await run.jev()).toMatchObject({ status: 'failed', reasonCode: 'jev_error', handoff: { owner: 'caller' } })
      expect(run.suspended).toBe(true)
      expect(commands.filter(command => command === 'eval')).toHaveLength(1)
      expect(commands).not.toContain('close')
      expect((await run.browse([{ action: 'snapshot' }])).failedAction).toBe('')
    } finally { await run.close() }
  })
  it('can read the entire saved snapshot and still quote an old snapshot after a refresh', async () => {
    const tree = '- text "导航"\n'.repeat(3000) + '最终价格 398 €😀'
    const { run } = setup(tree)
    try {
      const first = await run.start()
      let restored = first.pageExcerpt!
      let offset = first.nextOffset
      while (offset !== undefined) {
        const chunk = run.read(first.snapshotId, offset)
        restored += chunk.pageExcerpt
        offset = chunk.nextOffset
      }
      expect(restored).toBe(tree)
      await run.resume()
      expect(run.read(first.snapshotId, tree.indexOf('最终价格')).pageExcerpt).toContain('最终价格 398 €')
    } finally { await run.close() }
  })
})
