import type { BrowserPageState } from '../browser/types.js'
import type { SelectedAction } from '../jev.js'

export interface ObservationDelta {
  readonly beforeRevision: number
  readonly afterRevision: number
  readonly beforeUrl: string
  readonly afterUrl: string
  readonly urlChanged: false
  readonly action: { readonly operation: string; readonly targetRef?: string; readonly targetName?: string; readonly status: 'success' }
  /** Ref mappings, not claims about persistent DOM identity. */
  readonly addedRefs: readonly { ref: string; role: string; name: string }[]
  readonly removedRefs: readonly { ref: string; role: string; name: string }[]
  /** One complete replacement window, preserving raw lines and Unicode. */
  readonly changedText: { readonly beforeLine: number; readonly afterLine: number; readonly before: readonly string[]; readonly after: readonly string[] }
  readonly fullObservationAvailable: true
  readonly scope: 'snapshot text and ref mappings only; not visual state or task completion'
}

export type DeltaResult = { readonly delta: ObservationDelta } | { readonly fallback: 'navigation' | 'session_changed' | 'large_change' }

// Only ignore native ref annotations for alignment. Raw changed lines stay intact.
function withoutRef(line: string): string {
  return line.replace(/\s*\[ref=e\d+\]/g, '').replace(/, ref=e\d+(?=\])/g, '').replace(/\[ref=e\d+, /g, '[')
}

/** Conservative linear diff: dispersed changes may fall back instead of hiding text. */
export function buildObservationDelta(before: BrowserPageState, after: BrowserPageState, action: SelectedAction): DeltaResult {
  if (before.session !== after.session) return { fallback: 'session_changed' }
  if (before.origin !== after.origin) return { fallback: 'navigation' }
  const oldLines = before.tree.split('\n')
  const newLines = after.tree.split('\n')
  const oldNormalized = oldLines.map(withoutRef)
  const newNormalized = newLines.map(withoutRef)
  let start = 0
  while (start < oldLines.length && start < newLines.length && oldNormalized[start] === newNormalized[start]) start++
  let oldEnd = oldLines.length
  let newEnd = newLines.length
  while (oldEnd > start && newEnd > start && oldNormalized[oldEnd - 1] === newNormalized[newEnd - 1]) { oldEnd--; newEnd-- }
  const refKeys = (page: BrowserPageState) => new Set(page.elements.map(element => JSON.stringify([element.ref, element.role, element.name])))
  const oldRefs = refKeys(before)
  const newRefs = refKeys(after)
  const addedRefs = after.elements.filter(element => !oldRefs.has(JSON.stringify([element.ref, element.role, element.name])))
    .map(({ ref, role, name }) => ({ ref, role, name }))
  const removedRefs = before.elements.filter(element => !newRefs.has(JSON.stringify([element.ref, element.role, element.name])))
    .map(({ ref, role, name }) => ({ ref, role, name }))
  const delta: ObservationDelta = {
    beforeRevision: before.revision, afterRevision: after.revision, beforeUrl: before.origin, afterUrl: after.origin, urlChanged: false,
    action: { operation: action.operation, status: 'success', ...(action.target ? { targetRef: action.target.ref, targetName: action.target.name } : {}) },
    addedRefs, removedRefs,
    changedText: { beforeLine: start + 1, afterLine: start + 1, before: oldLines.slice(start, oldEnd), after: newLines.slice(start, newEnd) },
    fullObservationAvailable: true, scope: 'snapshot text and ref mappings only; not visual state or task completion',
  }
  // Bound the entire serialized delta, not individual fields. Never silently truncate changes.
  return Buffer.byteLength(JSON.stringify(delta)) <= 3_000 ? { delta } : { fallback: 'large_change' }
}
