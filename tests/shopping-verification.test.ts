import { describe, expect, it } from 'vitest'
import { checkObservedOffer, sameOfferIdentity, type BrowserPageState, type ObservedFields } from '../src/index.js'

const page: BrowserPageState = {
  session: 'first', revision: 1, origin: 'https://shop.example/item/1', removedRefs: [], elements: [],
  tree: '- heading "型号 A"\n- combobox "容量":\n  - option "1TB"\n  - option "2TB" [selected]\n- text "已选 2TB"\n- text "京东自营"\n- text "￥1,299.00"',
}
const required = { model: '型号 A', specs: [{ name: '容量', value: '2TB' }], seller: '京东自营' }
const observed: ObservedFields = {
  model: '型号 A', modelExcerpt: 'heading "型号 A"',
  specs: [{ name: '容量', value: '2TB', excerpt: 'option "2TB" [selected]' }],
  seller: '京东自营', sellerExcerpt: 'text "京东自营"', priceExcerpt: 'text "￥1,299.00"',
}

describe('M2.2 independent offer checks', () => {
  it('requires selected specs and page-backed excerpts before constructing an offer', () => {
    const verified = checkObservedOffer(page, required, observed, '2026-09-23T00:00:00.000Z')
    expect(verified.missing).toEqual([])
    expect(verified.offer?.listedPrice).toEqual({ status: 'known', value: { currency: 'CNY', minor: 129900 } })
    expect(verified.offer?.evidence.map(item => item.field)).toEqual([
      'product.model', 'product.specs', 'seller', 'listedPrice', 'currency', 'url',
    ])
    expect(verified.offer?.fees.every(item => item.amount.status === 'unknown')).toBe(true)

    const availableOnly = checkObservedOffer({ ...page, tree: page.tree.replace('option "2TB" [selected]', 'option "2TB"').replace('已选 2TB', '选择容量') }, required, {
      ...observed, specs: [{ name: '容量', value: '2TB', excerpt: 'option "2TB"' }],
    })
    expect(availableOnly.offer).toBeUndefined()
    expect(availableOnly.missing).toContain('已选规格：容量=2TB')
  })

  it('does not trust a model-supplied quote or accept wrong model, seller or missing price', () => {
    const fakeQuote = checkObservedOffer(page, required, { ...observed, priceExcerpt: '￥999.00' })
    expect(fakeQuote.offer).toBeUndefined()
    expect(fakeQuote.missing).toContain('明确标价或币种证据')
    const wrong = checkObservedOffer(page, required, { ...observed, model: '型号 B', seller: '其他店铺' })
    expect(wrong.offer).toBeUndefined()
    expect(wrong.missing).toContain('型号或型号证据')
    expect(wrong.missing).toContain('卖家或卖家证据')
  })

  it('allows a price change on replay while preserving product identity', () => {
    const first = checkObservedOffer(page, required, observed).offer!
    const changedPage = { ...page, session: 'replay', tree: page.tree.replace('1,299.00', '1,199.00') }
    const second = checkObservedOffer(changedPage, required, { ...observed, priceExcerpt: 'text "￥1,199.00"' }).offer!
    expect(sameOfferIdentity(first, second)).toBe(true)
    expect(second.listedPrice).toEqual({ status: 'known', value: { currency: 'CNY', minor: 119900 } })
  })
})
