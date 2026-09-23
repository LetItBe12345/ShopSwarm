import type { BrowserPageState } from '../browser/types.js'
import type { Evidence, Offer, ProductSpec } from '../types.js'
import { validateOffer } from '../types.js'

export interface OfferRequirements {
  readonly model: string
  readonly specs: readonly ProductSpec[]
  readonly seller?: string
}

export interface ObservedFields {
  readonly model: string
  readonly modelExcerpt: string
  readonly specs: readonly { readonly name: string; readonly value: string; readonly excerpt: string }[]
  readonly seller: string
  readonly sellerExcerpt: string
  readonly priceExcerpt: string
}

export interface PageCheck {
  readonly offer?: Offer
  readonly progress: readonly string[]
  readonly missing: readonly string[]
}

function sameText(a: string, b: string): boolean {
  return a.normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase()
    === b.normalize('NFKC').replace(/\s+/g, '').toLocaleLowerCase()
}

function containsExcerpt(page: BrowserPageState, excerpt: string): boolean {
  return excerpt.trim().length > 0 && page.tree.includes(excerpt)
}

function priceFromExcerpt(excerpt: string): { currency: string; minor: number } | undefined {
  const match = /(?:¥|￥|CNY|RMB|\$|USD)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i.exec(excerpt)
  if (!match) return undefined
  const currency = /^(?:\$|USD)/i.test(match[0]) ? 'USD' : 'CNY'
  const [whole, fraction = ''] = match[1]!.replace(/,/g, '').split('.')
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
  return Number.isSafeInteger(minor) && minor >= 0 ? { currency, minor } : undefined
}

function selectedSpec(excerpt: string, name: string, value: string): boolean {
  const line = excerpt.split('\n').find(item => item.includes(value)) ?? ''
  return /\[(?:selected|checked|pressed|active)(?:,|\])|已选|选中|当前/i.test(line)
    || (line.includes(`combobox "${name}"`) && line.trimEnd().endsWith(`: ${value}`))
}

/** Only text from the current page can become field evidence. */
export function checkObservedOffer(
  page: BrowserPageState,
  required: OfferRequirements,
  observed: ObservedFields,
  observedAt = new Date().toISOString(),
): PageCheck {
  const progress: string[] = []
  const missing: string[] = []
  const evidence: Evidence[] = []
  const add = (field: Evidence['field'], excerpt: string): void => {
    evidence.push({ field, url: page.origin, observedAt, excerpt })
  }
  if (sameText(observed.model, required.model)
    && containsExcerpt(page, observed.modelExcerpt)
    && observed.modelExcerpt.includes(observed.model)) {
    progress.push(`型号：${required.model}`)
    add('product.model', observed.modelExcerpt)
  } else missing.push('型号或型号证据')

  for (const spec of required.specs) {
    const item = observed.specs.find(candidate => sameText(candidate.name, spec.name) && sameText(candidate.value, spec.value))
    if (item && containsExcerpt(page, item.excerpt) && selectedSpec(item.excerpt, spec.name, spec.value)) {
      progress.push(`已选规格：${spec.name}=${spec.value}`)
      add('product.specs', item.excerpt)
    } else missing.push(`已选规格：${spec.name}=${spec.value}`)
  }

  if (observed.seller.trim()
    && (required.seller === undefined || sameText(observed.seller, required.seller))
    && containsExcerpt(page, observed.sellerExcerpt)
    && observed.sellerExcerpt.includes(observed.seller)) {
    progress.push(`卖家：${observed.seller}`)
    add('seller', observed.sellerExcerpt)
  } else missing.push('卖家或卖家证据')

  const price = containsExcerpt(page, observed.priceExcerpt) ? priceFromExcerpt(observed.priceExcerpt) : undefined
  if (price) {
    progress.push(`标价：${price.currency} ${price.minor}`)
    add('listedPrice', observed.priceExcerpt)
    add('currency', observed.priceExcerpt)
  } else missing.push('明确标价或币种证据')

  if (!/^https?:\/\//.test(page.origin)) missing.push('商品页面 URL')
  if (missing.length > 0 || !price) return { progress, missing }
  const offer: Offer = {
    product: { model: required.model, specs: required.specs },
    seller: observed.seller,
    currency: price.currency,
    listedPrice: { status: 'known', value: price },
    fees: [
      { kind: 'shipping', amount: { status: 'unknown' } },
      { kind: 'tax', amount: { status: 'unknown' } },
      { kind: 'discount', amount: { status: 'unknown' } },
    ],
    url: page.origin,
    observedAt,
    evidence: [...evidence, { field: 'url', url: page.origin, observedAt, excerpt: page.origin }],
  }
  validateOffer(offer)
  return { offer, progress, missing }
}

export function sameOfferIdentity(first: Offer, second: Offer): boolean {
  return sameText(first.product.model, second.product.model)
    && first.product.specs.length === second.product.specs.length
    && first.product.specs.every((spec, index) => sameText(spec.name, second.product.specs[index]!.name)
      && sameText(spec.value, second.product.specs[index]!.value))
    && sameText(first.seller, second.seller)
    && first.currency === second.currency
}
