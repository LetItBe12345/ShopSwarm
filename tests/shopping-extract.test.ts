import { describe, expect, it, vi } from 'vitest'
import { extractObservedFields } from '../src/shopping/extract.js'
import type { BrowserPageState } from '../src/index.js'

const page: BrowserPageState = {
  session: 'x', revision: 1, origin: 'https://shop.example/item/1', elements: [], removedRefs: [],
  tree: '- heading "示例型号"\n- option "2TB" [selected]\n- text "示例提供方"\n- text "￥1,299.00"',
}

describe('offer extraction transport', () => {
  it('parses a bounded structured model answer and records usage', async () => {
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      const sent = JSON.parse(String(init?.body)) as { messages: { content: string }[] }
      expect(sent.messages[1]?.content).toContain('示例型号')
      return new Response(JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
          model: '示例型号', modelExcerpt: 'heading "示例型号"',
          specs: [{ name: '容量', value: '2TB', excerpt: 'option "2TB" [selected]' }],
          seller: '示例提供方', sellerExcerpt: 'text "示例提供方"', priceExcerpt: 'text "￥1,299.00"',
        }) } }],
        usage: { prompt_tokens: 80, completion_tokens: 40 },
      }), { status: 200 })
    })
    const result = await extractObservedFields(page, { model: '示例型号', specs: [{ name: '容量', value: '2TB' }] }, {
      apiKey: 'test-only', fetcher,
    })
    expect(result.fields.seller).toBe('示例提供方')
    expect(result.metrics).toMatchObject({ inputTokens: 80, outputTokens: 40, costUsd: null })
    expect(fetcher).toHaveBeenCalledOnce()
  })
})
