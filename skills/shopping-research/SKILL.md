---
name: shopping-research
description: 使用 ShopSwarm 在后台浏览器里完成交互步骤。当前不使用 Jev，也不连接用户正在看的 Chrome。
---

# ShopSwarm 购物研究

Jev 和 sub-agent 都还没有接入。浏览器任务由 `shopswarm_browse` 这一层自己执行。

- 调用 `shopswarm_browse`。`steps` 是 JSON 数组字符串，包含 1 到 8 个步骤。可用动作是 `open`、`snapshot`、`click`、`fill`、`press`、`waitText`。
- `open` 要带 `url`。`click` 和 `fill` 要带当前快照里的 `role` 和 `name`，`fill` 还要带 `value`。
- 会话在后台启动独立的 headless Chrome，显式关闭自动连接，不抢当前前台窗口的焦点。
- 不配置代理，也不继承终端里的代理变量。
- `shopswarm_diagnose` 只检查运行环境。`checkBrowser: true` 仍只打开配置好的测试页。
- 不要把诊断或浏览结果写成已经登录、已经比价或已经完成购物。
