import { describe, expect, it } from 'vitest'
import { buildObservationDelta } from '../src/shopping/observation-delta.js'
import type { BrowserPageState } from '../src/browser/types.js'
import type { SelectedAction } from '../src/jev.js'

const page = (tree: string, revision = 1, refs: Record<string, { role: string; name: string }> = {}): BrowserPageState => ({
  session: 'delta-test', revision, origin: 'https://shop.example/item', tree, removedRefs: [],
  elements: Object.entries(refs).map(([ref, value]) => ({ ...value, ref: ref as `e${number}`, session: 'delta-test', pageRevision: revision })),
})
const action: SelectedAction = { operation: 'CLICK', model: 'test', durationMs: 1, usage: null }

describe('bounded snapshot delta', () => {
  it('preserves raw control state and changed text without interpreting prices', () => {
    const before = page('- main\n  - radio "256GB" [ref=e1]\n  - text "999 €😀"\n- contentinfo')
    const after = page('- main\n  - radio "256GB" [ref=e1] [checked]\n  - text "1099 €😀"\n- contentinfo', 2)
    const diff = buildObservationDelta(before, after, action)
    expect(diff).toMatchObject({ delta: { beforeRevision: 1, afterRevision: 2, changedText: {
      beforeLine: 2, afterLine: 2, before: ['  - radio "256GB" [ref=e1]', '  - text "999 €😀"'],
      after: ['  - radio "256GB" [ref=e1] [checked]', '  - text "1099 €😀"'],
    } } })
  })
  it('reports ref reuse as removal/addition and never calls it the same control', () => {
    const diff = buildObservationDelta(page('- button "Old" [ref=e1]', 1, { e1: { role: 'button', name: 'Old' } }),
      page('- button "New" [ref=e1]', 2, { e1: { role: 'button', name: 'New' } }), action)
    expect(diff).toMatchObject({ delta: { removedRefs: [{ ref: 'e1', name: 'Old' }], addedRefs: [{ ref: 'e1', name: 'New' }] } })
  })
  it('ignores native ref renumbering for text alignment while exposing fresh mappings', () => {
    const before = page('- radio "Black" [checked=false, ref=e1]', 1, { e1: { role: 'radio', name: 'Black' } })
    const after = page('- radio "Black" [checked=false, ref=e9]', 2, { e9: { role: 'radio', name: 'Black' } })
    expect(buildObservationDelta(before, after, action)).toMatchObject({ delta: { changedText: { before: [], after: [] },
      addedRefs: [{ ref: 'e9' }], removedRefs: [{ ref: 'e1' }] } })
  })
  it('preserves complete insertion and removal windows, including duplicate labels', () => {
    const before = page('- main\n- button "Close" [ref=e1]\n- button "Close" [ref=e2]\n- footer')
    const after = page('- main\n- text "Dialog closed"\n- footer', 2)
    expect(buildObservationDelta(before, after, action)).toMatchObject({ delta: { changedText: {
      before: ['- button "Close" [ref=e1]', '- button "Close" [ref=e2]'], after: ['- text "Dialog closed"'],
    } } })
  })
  it('falls back on navigation, another session or large/dispersed changes without truncating', () => {
    const before = page('- main\n' + '- text "unchanged"\n'.repeat(500) + '- footer')
    expect(buildObservationDelta(before, { ...before, origin: 'https://shop.example/new' }, action)).toEqual({ fallback: 'navigation' })
    expect(buildObservationDelta(before, { ...before, session: 'other' }, action)).toEqual({ fallback: 'session_changed' })
    expect(buildObservationDelta(before, page(before.tree.replace('main', 'dialog').replace('footer', 'end'), 2), action)).toEqual({ fallback: 'large_change' })
  })
})
