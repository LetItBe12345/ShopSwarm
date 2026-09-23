import { buildActionRequest, chooseAction } from '../src/jev.js'
import type { BrowserPageState } from '../src/browser/types.js'

const page: BrowserPageState = {
  session: 'jev-smoke',
  revision: 1,
  origin: 'https://example.com/item',
  tree: '- heading "Example Model"\n- text "Provider: Example API"\n- text "Input price: USD 1.40 per 1M tokens"',
  elements: [],
  removedRefs: [],
}

const request = buildActionRequest({
  goal: 'Read the listed Example Model input token price',
  constraints: ['Exact model: Example Model'],
  doneWhen: ['Exact model visible', 'Seller visible', 'Price visible'],
  progress: ['Exact model visible', 'Seller visible', 'Price visible'],
}, page, [])

const result = await chooseAction(request)
console.info(JSON.stringify({
  status: 'ok',
  model: result.model,
  operation: result.operation,
  durationMs: result.durationMs,
  usage: result.usage,
}))
