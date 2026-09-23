---
name: shopping-research
description: 使用 ShopSwarm 在后台浏览器里研究单站商品报价，并处理登录、验证码和待判断结果。
---

# ShopSwarm 购物研究

`shopswarm_research` 使用 Jev 选择单站页面动作。Jev 的 `DONE` 只是申请结束；工具会检查页面字段，并在新隔离会话中重开商品 URL 复核。未经复核的 `candidate` 不是成功报价。

- 调用 `shopswarm_research` 时传单站 `startUrl`、自然语言 `goal`、明确的 `model`、`specs` JSON 数组和可选的 `seller`。规格要写成 `[商品规格名, 目标值]` 的对象数组，例如 `[{"name":"容量","value":"2TB"}]`。不要从页面文字改写用户要求。
- `status=success` 才能把 `offer` 当作已验证的页面报价。运费、税费和优惠未知时，不宣称确定到手价。
- `reasonCode=login_required` 时，把 `userMessage` 原样告诉用户。用户在自己的 Chrome `Default` Profile 登录并回复已登录后，用原任务条件重新调用工具；重新核验全部字段。不要后台轮询。
- `reasonCode=captcha` 时告诉用户需要人工处理，不尝试破解。
- `no_progress` 或 `verification_failed` 时，读取 `progress`、`missing`、`pageUrl` 和页面摘录，判断能否调整单站目标后再次调用，或向用户说明阻塞。不能绕过复核宣布成功。
- 多站分发与并行仍属于 M3；当前工具一次只负责一个站点。

原有 `shopswarm_browse` 保留为手动步骤浏览工具：

- 调用 `shopswarm_browse`。`steps` 是 JSON 数组字符串，包含 1 到 8 个步骤。可用动作是 `open`、`snapshot`、`click`、`fill`、`press`、`waitText`。
- `open` 要带 `url`。`click` 和 `fill` 要带当前快照里的 `role` 和 `name`，`fill` 还要带 `value`。
- 会话在后台启动独立的 headless Chrome，显式关闭自动连接，不抢当前前台窗口的焦点。
- 不配置代理，也不继承终端里的代理变量。
- `shopswarm_diagnose` 只检查运行环境。`checkBrowser: true` 仍只打开配置好的测试页。
- 不要把诊断或手动浏览结果写成已经登录、已经比价或已经完成购物。
