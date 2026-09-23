import { describe, expect, it } from 'vitest'
import { buildActionRequest } from '../src/jev.js'
import { chooseLlmAction } from '../src/llm-action.js'

const request = buildActionRequest({
  goal: '搜索型号 A', constraints: [], doneWhen: ['找到商品'], progress: [],
}, {
  session: 'test', revision: 1, origin: 'https://shop.example/',
  tree: '- textbox "搜索"\n- button "搜索"\n- link "商品"',
  elements: [
    { session: 'test', pageRevision: 1, ref: 'e1', role: 'textbox', name: '搜索' },
    { session: 'test', pageRevision: 1, ref: 'e2', role: 'button', name: '搜索' },
    { session: 'test', pageRevision: 1, ref: 'e3', role: 'link', name: '商品' },
  ], removedRefs: [],
}, [])

function response(action: object): typeof fetch {
  return async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(action) } }],
    usage: { prompt_tokens: 10, completion_tokens: 3 } }), { status: 200 })
}

describe('DeepSeek action baseline', () => {
  it('uses the same bounded action space and reports model usage', async () => {
    const selected = await chooseLlmAction(request, { apiKey: 'test', fetcher: response({ operation: 'CLICK', target: 'e3' }) })
    expect(selected).toMatchObject({ operation: 'CLICK', target: { ref: 'e3' }, model: 'deepseek-flash',
      usage: { prompt_tokens: 10, completion_tokens: 3 } })
  })

  it('rejects a target absent from the current page', async () => {
    await expect(chooseLlmAction(request, { apiKey: 'test', fetcher: response({ operation: 'CLICK', target: 'e99' }) }))
      .rejects.toThrow(/invalid Jev click_target choice/)
  })
})
