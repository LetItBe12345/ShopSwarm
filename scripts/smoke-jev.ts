import { buildActionRequest, chooseAction } from '../src/jev.js'
import type { BrowserPageState } from '../src/browser/types.js'

const page: BrowserPageState = {
  session: 'jev-smoke',
  revision: 1,
  origin: 'https://example.com/item',
  tree: '- heading "Example NVMe 2TB"\n- text "Seller: Example Official Store"\n- text "Price: CNY 499"',
  elements: [],
  removedRefs: [],
}

const request = buildActionRequest({
  goal: 'Read the price of Example NVMe 2TB',
  constraints: ['Exact model: Example NVMe 2TB'],
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
