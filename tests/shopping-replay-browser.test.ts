import { createServer } from 'node:http'
import { describe, expect, it } from 'vitest'
import { AgentBrowserSession, resolveAction, runShoppingTask } from '../src/index.js'

describe('M2.2 browser replay', () => {
  it('reopens a local product in the same source browser session', { timeout: 90_000 }, async () => {
    let requests = 0
    const sessionNames: string[] = []
    const server = createServer((_request, response) => {
      requests += 1
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(`<!doctype html><html lang="zh-CN"><title>商品</title><body>
        <h1>示例型号</h1><label>容量<select aria-label="容量"><option>1TB</option><option selected>2TB</option></select></label>
        <p>已选 2TB</p><p>卖家：示例提供方</p><p>标价：￥1,299.00</p></body></html>`)
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    try {
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('server has no port')
      const output = await runShoppingTask({
        startUrl: `http://127.0.0.1:${address.port}/item/1`,
        goal: '读取示例型号 的 2TB 报价', model: '示例型号',
        specs: [{ name: '容量', value: '2TB' }], seller: '示例提供方',
      }, {
        owner: 'm22-local-replay', signal: new AbortController().signal, timeoutMs: 15_000,
        createBrowser: owner => {
          const browser = new AgentBrowserSession({ owner, signal: new AbortController().signal, timeoutMs: 15_000 })
          sessionNames.push(browser.session)
          return browser
        },
        choose: async request => resolveAction({ answers: { operation: { choice: 'DONE' } } }, request, 0),
        extract: async page => {
          const line = page.tree.split('\n')
          const quote = (fragment: string) => line.find(item => item.includes(fragment))?.trim() ?? ''
          return { fields: {
            model: '示例型号', modelExcerpt: quote('示例型号'),
            specs: [{ name: '容量', value: '2TB', excerpt: quote('option "2TB"') }],
            seller: '示例提供方', sellerExcerpt: quote('示例提供方'),
            priceExcerpt: quote('￥1,299.00'),
          }, metrics: { model: 'test', durationMs: 0, inputTokens: 0, outputTokens: 0, costUsd: null } }
        },
      })
      expect(output, JSON.stringify(output)).toMatchObject({ status: 'success', reasonCode: 'completed' })
      expect(output.offer?.url).toContain('/item/1')
      expect(requests).toBeGreaterThanOrEqual(2)
      expect(sessionNames).toHaveLength(1)
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  })
})
