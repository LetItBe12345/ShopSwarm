import { describe, expect, it } from 'vitest'
import { pageTextChunk } from '../src/page-context.js'

describe('original page chunks', () => {
  it('reconstructs the entire page, including late prices and unrelated text, without ranking', () => {
    const tree = '- link "Navigation"\n'.repeat(1000) + '- text "商品 398 €"\n其他资料😀'
    let offset = 0
    let restored = ''
    for (;;) {
      const chunk = pageTextChunk(tree, offset, 1000)
      expect(Buffer.byteLength(chunk.text)).toBeLessThanOrEqual(1000)
      expect(chunk.text).not.toContain('\uFFFD')
      restored += chunk.text
      if (chunk.nextOffset === undefined) break
      expect(chunk.nextOffset).toBeGreaterThan(offset)
      offset = chunk.nextOffset
    }
    expect(restored).toBe(tree)
  })
  it('rejects bad offsets instead of silently dropping data', () => {
    expect(() => pageTextChunk('价格', -1)).toThrow()
    expect(() => pageTextChunk('价格', 3)).toThrow()
    expect(() => pageTextChunk('价格', 0, 1)).toThrow()
    expect(pageTextChunk('价格', 2).text).toBe('')
  })
})
