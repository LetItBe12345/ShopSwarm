export type KnownOrUnknown<T> =
  | { readonly status: 'known'; readonly value: T }
  | { readonly status: 'unknown' }

export interface Money {
  readonly currency: string
  readonly minor: number
}

export interface ProductSpec {
  readonly name: string
  readonly value: string
}

export interface ProductIdentity {
  readonly model: string
  readonly specs: readonly ProductSpec[]
}

export type FeeKind = 'shipping' | 'tax' | 'discount'

export interface FeeItem {
  readonly kind: FeeKind
  readonly amount: KnownOrUnknown<Money>
}

export type OfferField =
  | 'product.model'
  | 'product.specs'
  | 'seller'
  | 'currency'
  | 'listedPrice'
  | 'fees.shipping'
  | 'fees.tax'
  | 'fees.discount'
  | 'url'

export interface Evidence {
  readonly field: OfferField
  readonly url: string
  readonly observedAt: string
  readonly excerpt: string
}

export interface Offer {
  readonly product: ProductIdentity
  readonly seller: string
  readonly currency: string
  readonly listedPrice: KnownOrUnknown<Money>
  readonly fees: readonly FeeItem[]
  readonly url: string
  readonly observedAt: string
  readonly evidence: readonly Evidence[]
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${path}: expected an object`)
  }
  return value as Record<string, unknown>
}

function nonEmptyString(value: unknown, path: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${path}: expected a non-empty string`)
  }
}

function array(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path}: expected an array`)
  return value
}

function validateMoney(value: unknown, currency: string, path: string): void {
  const money = record(value, path)
  nonEmptyString(money.currency, `${path}.currency`)
  if (money.currency !== currency) throw new Error(`${path}.currency: must match offer currency`)
  if (!Number.isSafeInteger(money.minor)) throw new Error(`${path}.minor: expected a safe integer`)
}

function validateKnownOrUnknown(value: unknown, currency: string, path: string): void {
  const amount = record(value, path)
  if (amount.status === 'unknown') return
  if (amount.status !== 'known') throw new Error(`${path}.status: expected 'known' or 'unknown'`)
  validateMoney(amount.value, currency, `${path}.value`)
}

const feeKinds = new Set<FeeKind>(['shipping', 'tax', 'discount'])
const offerFields = new Set<OfferField>([
  'product.model', 'product.specs', 'seller', 'currency', 'listedPrice',
  'fees.shipping', 'fees.tax', 'fees.discount', 'url',
])

export function validateOffer(input: unknown): asserts input is Offer {
  const offer = record(input, 'offer')
  const product = record(offer.product, 'product')
  nonEmptyString(product.model, 'product.model')
  for (const [index, rawSpec] of array(product.specs, 'product.specs').entries()) {
    const spec = record(rawSpec, `product.specs[${index}]`)
    nonEmptyString(spec.name, `product.specs[${index}].name`)
    nonEmptyString(spec.value, `product.specs[${index}].value`)
  }

  nonEmptyString(offer.seller, 'seller')
  nonEmptyString(offer.currency, 'currency')
  if (!/^[A-Z]{3}$/.test(offer.currency)) throw new Error('currency: expected three uppercase letters')
  validateKnownOrUnknown(offer.listedPrice, offer.currency, 'listedPrice')

  const seenFees = new Set<FeeKind>()
  for (const [index, rawFee] of array(offer.fees, 'fees').entries()) {
    const fee = record(rawFee, `fees[${index}]`)
    if (typeof fee.kind !== 'string' || !feeKinds.has(fee.kind as FeeKind)) {
      throw new Error(`fees[${index}].kind: unsupported fee kind`)
    }
    const kind = fee.kind as FeeKind
    if (seenFees.has(kind)) throw new Error(`fees[${index}].kind: duplicate ${kind} fee`)
    seenFees.add(kind)
    validateKnownOrUnknown(fee.amount, offer.currency, `fees[${index}].amount`)
  }

  nonEmptyString(offer.url, 'url')
  nonEmptyString(offer.observedAt, 'observedAt')
  for (const [index, rawEvidence] of array(offer.evidence, 'evidence').entries()) {
    const evidence = record(rawEvidence, `evidence[${index}]`)
    if (typeof evidence.field !== 'string' || !offerFields.has(evidence.field as OfferField)) {
      throw new Error(`evidence[${index}].field: unsupported offer field`)
    }
    nonEmptyString(evidence.url, `evidence[${index}].url`)
    nonEmptyString(evidence.observedAt, `evidence[${index}].observedAt`)
    nonEmptyString(evidence.excerpt, `evidence[${index}].excerpt`)
  }
}
