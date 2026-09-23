import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { runProviderCase, scoreAnswer, type BenchmarkCase } from '../src/provider-benchmark.js'

const cases = JSON.parse(readFileSync(new URL('./fixtures/provider-benchmark.json', import.meta.url), 'utf8')) as BenchmarkCase[]

describe('sample provider rubric', () => {
  it('scores an exact JSON answer and rejects a merged Flash model', () => {
    const price = cases.find(item => item.id === 'glm-api-price')
    const flash = cases.find(item => item.id === 'do-not-merge-flash')
    expect(price).toBeDefined()
    expect(flash).toBeDefined()
    expect(scoreAnswer(JSON.stringify(price?.expected), price!.expected)).toBe(1)
    expect(scoreAnswer(JSON.stringify({ same_model: true, mismatch: [] }), flash!.expected)).toBe(0)
  })

  it('keeps an unknown coding-plan quota unknown', async () => {
    const testCase = cases.find(item => item.id === 'plan-quota-unknown')
    expect(testCase).toBeDefined()
    const attempt = await runProviderCase({
      name: 'example', baseUrl: 'https://provider.example/v1', apiKey: 'test', model: 'GLM-5.3',
      pricing: { inputUsdPerMillion: 1.4, outputUsdPerMillion: 4.4 },
    }, testCase!, {
      fetcher: async () => new Response(JSON.stringify({
        model: 'GLM-5.3',
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(testCase?.expected) } }],
        usage: { prompt_tokens: 20, completion_tokens: 12 },
      }), { status: 200 }),
    })
    expect(attempt).toMatchObject({ provider: 'example', modelRequested: 'GLM-5.3', ok: true, score: 1 })
    expect(attempt.estimatedCostUsd).toBeGreaterThan(0)
  })
})
