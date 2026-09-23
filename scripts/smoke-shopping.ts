import { createServer } from 'node:http'
import { runShoppingTask } from '../src/shopping/run.js'

if (!process.env.JEV_API_KEY || !process.env.DEEPSEEK_API_KEY) {
  throw new Error('JEV_API_KEY and DEEPSEEK_API_KEY are required')
}

const server = createServer((_request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  response.end(`<!doctype html><html lang="zh-CN"><title>本地商品</title><body>
    <main><h1>型号 A</h1><label>容量<select aria-label="容量">
      <option>1TB</option><option selected>2TB</option></select></label>
      <p>已选 2TB</p><p>卖家：京东自营</p><p>标价：￥1,299.00</p></main>
    </body></html>`)
})
await new Promise<void>((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
})

try {
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('server has no port')
  const output = await runShoppingTask({
    startUrl: `http://127.0.0.1:${address.port}/item/1`,
    goal: '读取型号 A、已选 2TB、京东自营的明确标价',
    model: '型号 A', specs: [{ name: '容量', value: '2TB' }], seller: '京东自营',
  }, {
    owner: `smoke-shopping-${process.pid}`, signal: AbortSignal.timeout(90_000), timeoutMs: 15_000,
  })
  console.log(JSON.stringify({ status: output.status, reasonCode: output.reasonCode, reason: output.reason, missing: output.missing, metrics: output.metrics }))
  if (output.status !== 'success') process.exitCode = 1
} finally {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
}
