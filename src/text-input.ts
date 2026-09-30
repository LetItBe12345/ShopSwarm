import type { BrowserElementRef, BrowserPageState } from './browser/types.js'
import type { ShoppingTaskContext } from './jev.js'

export interface TextInputMetrics {
  readonly source: 'task'
  readonly model: null
  readonly durationMs: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly costUsd: number
}
export type TextInputResult =
  | { readonly status: 'ready'; readonly text: string; readonly metrics: TextInputMetrics }
  | { readonly status: 'missing'; readonly metrics: TextInputMetrics }
const metrics: TextInputMetrics = { source: 'task', model: null, durationMs: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }

/** Missing text is returned to the source Agent, never inferred by another hidden model. */
export async function resolveTextInput(task: ShoppingTaskContext, page: BrowserPageState, target: BrowserElementRef,
  _legacyOptions: { readonly apiKey?: string; readonly signal?: AbortSignal; readonly fetcher?: typeof fetch; readonly timeoutMs?: number; readonly endpoint?: string; readonly model?: string } = {},
): Promise<TextInputResult> {
  if (target.session !== page.session || target.pageRevision !== page.revision || !page.elements.some(item => item.ref === target.ref)) throw new Error('text target is not in the current page snapshot')
  const text = task.textInputs?.[target.ref] ?? task.textInputs?.[target.name]
  return text === undefined ? { status: 'missing', metrics } : { status: 'ready', text, metrics }
}
