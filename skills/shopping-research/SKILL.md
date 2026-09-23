---
name: shopping-research
description: 使用 ShopSwarm 做购物研究与比价。当前仅提供运行环境和浏览器连通诊断。
---

# ShopSwarm 购物研究

当前阶段只可调用 `shopswarm_diagnose` 检查插件运行环境，并按需验证一次独立浏览器会话。

- 普通诊断传入 `checkBrowser: false`。
- 浏览器连通诊断传入 `checkBrowser: true`。该操作打开固定测试页、读取快照并关闭本次会话。
- 不把诊断结果当作真实购物站点、登录状态或商品报价已经验证的证明。
- 自然语言购物任务的拆分、并行执行和报告规则将在 M3.1 接入。
