export interface BenchmarkCase {
  readonly id: string
  readonly system: string
  readonly input: string
  readonly expected: Readonly<Record<string, unknown>>
  readonly max_tokens: number
}

export interface ProviderConfig {
  readonly name: string
  readonly baseUrl: string
  readonly apiKey: string
  readonly model: string
  readonly pricingNote?: string
  readonly pricing: {
    readonly inputUsdPerMillion: number
    readonly outputUsdPerMillion: number
    readonly cachedInputUsdPerMillion?: number
  }
}

export interface ProviderAttempt {
  readonly provider: string
  readonly modelRequested: string
  readonly modelReturned: string | null
  readonly caseId: string
  readonly ok: boolean
  readonly score: number
  readonly latencyMs: number
  readonly inputTokens: number | null
  readonly outputTokens: number | null
  readonly cachedInputTokens: number | null
  readonly estimatedCostUsd: number | null
  readonly finishReason: string | null
  readonly error?: string
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('expected an object')
  return value as Record<string, unknown>
}

function token(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function equal(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) return Array.isArray(actual) && JSON.stringify(actual) === JSON.stringify(expected)
  if (expected !== null && typeof expected === 'object') {
    if (actual === null || typeof actual !== 'object' || Array.isArray(actual)) return false
    return Object.entries(expected).every(([key, value]) => equal((actual as Record<string, unknown>)[key], value))
  }
  return actual === expected
}

export function scoreAnswer(content: string, expected: Readonly<Record<string, unknown>>): number {
  let parsed: unknown
  try { parsed = JSON.parse(content) } catch { return 0 }
  let answer: Record<string, unknown>
  try { answer = record(parsed) } catch { return 0 }
  const fields = Object.entries(expected)
  if (fields.length === 0) return 0
  return fields.filter(([key, value]) => equal(answer[key], value)).length / fields.length
}

function costUsd(input: number | null, output: number | null, cached: number | null, pricing: ProviderConfig['pricing']): number | null {
  if (input === null || output === null) return null
  const cachedTokens = cached ?? 0
  const regularInput = Math.max(0, input - cachedTokens)
  const cachedRate = pricing.cachedInputUsdPerMillion ?? pricing.inputUsdPerMillion
  return (regularInput * pricing.inputUsdPerMillion + cachedTokens * cachedRate + output * pricing.outputUsdPerMillion) / 1_000_000
}

export async function runBenchmark(
  configs: readonly ProviderConfig[],
  cases: readonly BenchmarkCase[],
  options: {
    readonly repeats?: number
    readonly fetcher?: typeof fetch
    readonly signal?: AbortSignal
    readonly timeoutMs?: number
  } = {},
): Promise<readonly ProviderAttempt[]> {
  const repeats = options.repeats ?? 1
  if (!Number.isInteger(repeats) || repeats < 1) throw new Error('repeats must be a positive integer')
  const attempts: ProviderAttempt[] = []
  for (let repeat = 0; repeat < repeats; repeat += 1) {
    for (const testCase of cases) {
      for (const config of configs) {
        attempts.push(await runProviderCase(config, testCase, options))
      }
    }
  }
  return attempts
}

export async function runProviderCase(config: ProviderConfig, testCase: BenchmarkCase, options: {
  readonly fetcher?: typeof fetch
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
} = {}): Promise<ProviderAttempt> {
  const started = performance.now()
  try {
    const base = config.baseUrl.replace(/\/+$/, '')
    const response = await (options.fetcher ?? fetch)(`${base}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: config.model,
        thinking: { type: 'disabled' },
        response_format: { type: 'json_object' },
        max_tokens: testCase.max_tokens,
        messages: [
          { role: 'system', content: testCase.system },
          { role: 'user', content: testCase.input },
        ],
      }),
      signal: AbortSignal.any([options.signal ?? new AbortController().signal, AbortSignal.timeout(options.timeoutMs ?? 30_000)]),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const body = record(await response.json())
    const choices = body.choices
    if (!Array.isArray(choices) || choices.length === 0) throw new Error('response has no choices')
    const choice = record(choices[0])
    const finishReason = typeof choice.finish_reason === 'string' ? choice.finish_reason : null
    const message = record(choice.message)
    const content = typeof message.content === 'string' ? message.content : ''
    const usage = body.usage === undefined ? {} : record(body.usage)
    const details = typeof usage.prompt_tokens_details === 'object' && usage.prompt_tokens_details !== null
      ? usage.prompt_tokens_details as Record<string, unknown> : {}
    const inputTokens = token(usage.prompt_tokens)
    const outputTokens = token(usage.completion_tokens)
    const cachedInputTokens = token(details.cached_tokens ?? details.cache_read_tokens)
    const score = finishReason === 'stop' ? scoreAnswer(content, testCase.expected) : 0
    return {
      provider: config.name, modelRequested: config.model,
      modelReturned: typeof body.model === 'string' ? body.model : null,
      caseId: testCase.id, ok: score === 1, score,
      latencyMs: Math.round(performance.now() - started),
      inputTokens, outputTokens, cachedInputTokens,
      estimatedCostUsd: costUsd(inputTokens, outputTokens, cachedInputTokens, config.pricing), finishReason,
      ...(score === 1 ? {} : { error: finishReason === 'stop' ? 'answer did not match deterministic rubric' : `finish_reason=${String(finishReason)}` }),
    }
  } catch (error) {
    return {
      provider: config.name, modelRequested: config.model, modelReturned: null, caseId: testCase.id,
      ok: false, score: 0, latencyMs: Math.round(performance.now() - started),
      inputTokens: null, outputTokens: null, cachedInputTokens: null, estimatedCostUsd: null,
      finishReason: null, error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function summarizeAttempts(attempts: readonly ProviderAttempt[]) {
  const count = attempts.length
  const totalScore = attempts.reduce((sum, attempt) => sum + attempt.score, 0)
  const observedCosts = attempts.map(attempt => attempt.estimatedCostUsd)
  const totalCost = observedCosts.some(value => value === null) ? null : observedCosts.reduce<number>((sum, value) => sum + (value ?? 0), 0)
  const sortedLatency = attempts.map(attempt => attempt.latencyMs).sort((a, b) => a - b)
  const middle = Math.floor(sortedLatency.length / 2)
  const medianLatencyMs = sortedLatency.length === 0 ? null : sortedLatency.length % 2
    ? sortedLatency[middle]
    : Math.round((sortedLatency[middle - 1]! + sortedLatency[middle]!) / 2)
  return {
    attempts: count,
    passed: attempts.filter(attempt => attempt.ok).length,
    successRate: count ? attempts.filter(attempt => attempt.ok).length / count : null,
    meanScore: count ? totalScore / count : null,
    medianLatencyMs,
    inputTokens: attempts.every(attempt => attempt.inputTokens !== null)
      ? attempts.reduce((sum, attempt) => sum + (attempt.inputTokens ?? 0), 0) : null,
    outputTokens: attempts.every(attempt => attempt.outputTokens !== null)
      ? attempts.reduce((sum, attempt) => sum + (attempt.outputTokens ?? 0), 0) : null,
    estimatedCostUsd: totalCost,
    costPerPassedAttemptUsd: totalCost !== null && attempts.some(attempt => attempt.ok)
      ? totalCost / attempts.filter(attempt => attempt.ok).length : null,
  }
}

export function summarizeByProvider(attempts: readonly ProviderAttempt[], configs: readonly ProviderConfig[] = []) {
  const names: string[] = []
  for (const attempt of attempts) {
    if (!names.includes(attempt.provider)) names.push(attempt.provider)
  }
  return names.map(name => {
    const group = attempts.filter(attempt => attempt.provider === name)
    const config = configs.find(item => item.name === name)
    return {
      provider: name,
      modelRequested: group[0]?.modelRequested ?? null,
      modelsReturned: [...new Set(group.map(attempt => attempt.modelReturned))],
      pricingNote: config?.pricingNote ?? null,
      ...summarizeAttempts(group),
    }
  })
}
