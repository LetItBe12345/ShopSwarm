# DSH Web 运行时报错记录

记录日期：2026-09-24  
来源：DSH Web 会话日志（`~/.dsh/sessions/`）和 ShopSwarm 当前源码

## 1. Jev 超时

日志中的典型结果：

```text
status: failed
reasonCode: jev_error
reason: TimeoutError: The operation was aborted due to timeout
```

同一条结果带有目标页面的 `pageExcerpt`，随后 `shopswarm_browse` 能在几秒内成功打开页面并执行点击。这说明页面访问和浏览器进程没有先超时，失败发生在 Jev 动作判断请求完成之前。

当前源码对 Jev 使用固定的 25 秒截止时间：

```ts
AbortSignal.timeout(options.timeoutMs ?? 25_000)
```

旧的 DSH Web 进程还继承了：

```text
HTTP_PROXY=http://127.0.0.1:10808
HTTPS_PROXY=http://127.0.0.1:10808
```

Jev 使用普通 `fetch`，因此会受到这些变量影响；浏览器子进程则由 ShopSwarm 清除了代理变量。这个网络路径差异可以解释“浏览器能打开页面、Jev 超时”的现象，但仅凭现有日志不能证明中转服务本身有故障。

已做的运行时处理：当前 DSH Web 进程已在清除代理变量的环境中重启。直连 `https://api.tu-zi.com/v1/systemone` 的网络连接可以建立，普通 GET 返回 `404`，说明主机可达；这不是对 Jev POST 接口成功的证明。

## 2. Web Search 配置错误

日志结果：

```text
WEB_PROVIDER_ERROR
Unexpected token ... is not valid JSON
```

请求使用了：

```text
https://api.deepseek.com/anthropic/v1/messages
```

返回内容开头像压缩数据，不能按 JSON 解析。该错误发生在 DSH 的 Web Search 工具，不是 ShopSwarm 的 Jev 调用。需要检查 Web Search 的 endpoint、响应格式和解压处理。

## 3. `press` 动作参数错误

多次浏览日志出现：

```text
failedAction: press
detail: key must be empty
```

模型提交了 `PageDown` 或 `End`，但工具层把 `key` 判定为空，导致滚动动作没有执行。该问题发生在 `shopswarm_browse` 的动作参数解析或适配层，和 Jev 超时是两个独立问题。

## 4. 登录限制被正确识别为阻塞

SiliconFlow 页面被重定向到登录页，工具返回：

```text
reasonCode: login_required
```

这不是网络故障。没有登录凭据时，来源应保持未验证，不能把登录页内容当成价格结果。

## 5. 当前判断

- Jev 超时的直接表现是 25 秒客户端截止时间触发。
- 旧 Web 进程的代理继承是最可疑的外部原因，已通过无代理重启排除当前进程继续使用该代理。
- 即使代理问题修复，25 秒固定截止时间、Jev 中转服务排队或响应处理仍可能造成相同错误。
- Web Search endpoint 错误和 `press` 参数错误需要单独修复，不能归并为 Jev 故障。
- 后续复现时应记录 Jev 请求是否发出、HTTP 状态、响应耗时，以及 DSH 进程是否含代理变量。
