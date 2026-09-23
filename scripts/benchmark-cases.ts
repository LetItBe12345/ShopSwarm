import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import { runBenchmark, summarizeByProvider, type BenchmarkCase, type ProviderConfig } from '../src/provider-benchmark.js'

const cases = JSON.parse(readFileSync(new URL('../tests/fixtures/provider-benchmark.json', import.meta.url), 'utf8')) as BenchmarkCase[]
const pricingNote = 'fixture rate dated 2026-09-23; not a verified market price'

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    request.on('data', chunk => chunks.push(Buffer.from(chunk)))
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

function listen(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address === null || typeof address === 'string') reject(new Error('benchmark server has no port'))
      else resolve(address.port)
    })
  })
}

const seen: { provider: string, model: string, input: string }[] = []
const server = createServer(async (request, response: ServerResponse) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1')
  const provider = url.pathname.startsWith('/relay/') ? 'relay' : 'official'
  const body = JSON.parse(await readBody(request)) as { model?: string, messages?: { role?: string, content?: string }[] }
  const input = body.messages?.find(message => message.role === 'user')?.content ?? ''
  seen.push({ provider, model: String(body.model), input })
  const testCase = cases.find(item => item.input === input)
  if (provider === 'relay' && testCase?.id === 'shopping-spec') {
    response.writeHead(503).end('unavailable')
    return
  }
  if (provider === 'relay') await new Promise(resolve => setTimeout(resolve, 30))
  const content = JSON.stringify(testCase?.expected ?? {})
  response.writeHead(200, { 'content-type': 'application/json' })
  response.end(JSON.stringify({
    model: provider === 'relay' ? `${String(body.model)}-build` : body.model,
    choices: [{ finish_reason: 'stop', message: { content } }],
    ...(provider === 'relay' && testCase?.id === 'cache-price-missing' ? {} : {
      usage: { prompt_tokens: input.length, completion_tokens: content.length },
    }),
  }))
})

const port = await listen(server)
const base = `http://127.0.0.1:${port}`
const pricing = { inputUsdPerMillion: 1, outputUsdPerMillion: 2 }
const configs: ProviderConfig[] = [
  { name: 'official', baseUrl: `${base}/official/v1`, apiKey: 'local', model: 'caller-model', pricing, pricingNote },
  { name: 'relay', baseUrl: `${base}/relay/v1`, apiKey: 'local', model: 'caller-model', pricing, pricingNote },
]
try {
  const attempts = await runBenchmark(configs, cases, { repeats: 2, timeoutMs: 5_000 })
  const sameInputs = cases.every(testCase => {
    const models = seen.filter(item => item.input === testCase.input).map(item => item.model)
    return models.every(model => model === 'caller-model')
  })
  console.info(JSON.stringify({
    sameRequestedModel: sameInputs,
    providers: summarizeByProvider(attempts, configs),
  }))
} finally {
  await new Promise(resolve => server.close(resolve))
}
