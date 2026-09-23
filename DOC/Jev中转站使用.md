# Jev 中转站使用

更新日期：2026-09-23。当前 ShopSwarm 的 Jev 默认走兔子 API 中转站；DeepSeek 仍用于 DSH 和必要时的网页文本输入。两种服务使用不同的密钥。

## 当前配置

| 项目 | 当前值 | 作用 |
|---|---|---|
| 服务 | 兔子 API，`https://api.tu-zi.com` | Jev 请求的默认 Base URL |
| 请求地址 | `https://api.tu-zi.com/v1/systemone` | `POST`，原生 Jev 结构化决策接口 |
| 请求模型 | `jev-1.13` | 中转站公开的模型名；本次响应报告为 `jev-1.13.0` |
| 密钥 | `JEV_API_KEY` | 兔子 API 的站点 API Key，放在本机 `.env` 或进程环境中 |

`JEV_BASE_URL` 默认是 `https://api.tu-zi.com`，只填站点根地址，不带 `/v1/systemone`。`JEV_MODEL` 默认是 `jev-1.13`。代码会在 Base URL 后追加 `/v1/systemone`。`JEV_API_KEY` 没有默认值；不要把密钥写进源码、文档或提交。TypeSafe 直连的 `TYPESAFE_API_KEY` 和 DeepSeek 的 `DEEPSEEK_API_KEY` 都不能代替本站 Key。

本地 `.env` 增加以下三项，实际密钥只填在本机：

```dotenv
JEV_BASE_URL=https://api.tu-zi.com
JEV_MODEL=jev-1.13
JEV_API_KEY=填入兔子API站点密钥
```

`.env` 已被 Git 忽略。若改用其他 Jev 服务，应分别核对其 Base URL、模型名、密钥类型及响应格式；本页的验证结果只对应上表中的中转站。

## 验证调用

使用项目要求的 Node.js 24.21.0 和 pnpm 11.7.0，在仓库根目录执行：

```bash
corepack pnpm smoke:jev
```

命令从本地 `.env` 读取 `JEV_API_KEY`，通过项目的 `buildActionRequest` 和 `chooseAction` 发送一个虚构商品页面的请求。它不会打开浏览器，也不会读取用户 Profile。成功时只输出 `status`、响应模型、所选操作、耗时和用量；不会输出 Key 或完整请求。缺少 Key 时会明确报 `JEV_API_KEY is required for Jev`。

ShopSwarm 请求体包含 `model`、`state` 和 `questions`，不使用 Chat Completions 的 `messages`。中转站可能返回顶层 `answers`，也可能返回 `data.answers`；客户端均能解析。所选操作和目标还会与当前快照生成的候选集合核对。网关文档规定请求体最多 32 KiB，项目在发送前检查字节数，超出时拒绝请求并返回原因。

## 已验证范围

2026-09-23 使用本机已忽略的 `.env`，通过兔子 API 真实调用 `smoke:jev`：返回 HTTP 成功，`model=jev-1.13.0`，操作为 `DONE`，用量为输入 550、输出 42 Token，耗时约 1.1 秒。这证明当前 Key、Base URL、模型名、请求结构和项目响应解析可用于一次脱敏决策。响应没有提供实际扣费金额，本页不写确定费用。

完整购物动作循环、真实京东或天猫页面及长页面请求尚未通过这个中转站验证。发往 Jev 的 `state` 包含当前页面文字；按本项目已确认选择，登录页面中出现的地址、手机号等信息不会因此被过滤或阻止发送。Cookie 和 API Key 不进入 `state`。

接口依据：[兔子 API Jev-1.13 文档](https://api.tu-zi.com/docs/models/jev-1-13)、[兔子 API JevAI 接入说明](https://api.tu-zi.com/en/docs/providers/jevai)。检索日期：2026-09-23。
