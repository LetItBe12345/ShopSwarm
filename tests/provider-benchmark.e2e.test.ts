import { execFile } from 'node:child_process'
import { describe, expect, it } from 'vitest'

function runBenchmark(): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ['--import', 'tsx', 'scripts/benchmark-cases.ts'], {
      cwd: new URL('..', import.meta.url),
      timeout: 20_000,
    }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${error.message}\n${stderr}`))
      else resolve(stdout)
    })
  })
}

describe('local provider benchmark', () => {
  it('measures two sources on the same cases without a live vendor', async () => {
    const report = JSON.parse(await runBenchmark()) as {
      sameRequestedModel: boolean
      providers: {
        provider: string
        modelRequested: string
        modelsReturned: (string | null)[]
        pricingNote: string
        attempts: number
        passed: number
        medianLatencyMs: number
        estimatedCostUsd: number | null
      }[]
    }
    expect(report.sameRequestedModel).toBe(true)
    const official = report.providers.find(item => item.provider === 'official')
    const relay = report.providers.find(item => item.provider === 'relay')
    expect(official).toMatchObject({ modelRequested: 'caller-model', passed: official?.attempts, pricingNote: expect.stringContaining('not a verified market price') })
    expect(official?.estimatedCostUsd).toEqual(expect.any(Number))
    expect(relay?.passed).toBeLessThan(relay?.attempts ?? 0)
    expect(relay?.estimatedCostUsd).toBeNull()
    expect(relay?.modelsReturned).toContain('caller-model-build')
    expect(relay?.medianLatencyMs).toBeGreaterThan(official?.medianLatencyMs ?? 0)
  })
})
