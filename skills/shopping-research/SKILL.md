---
name: shopping-research
description: 使用 ShopSwarm 核对调用方给出的购物或价格页面，并处理登录、验证码和待判断结果。
---

# ShopSwarm 价格核对

任务由调用方给出。可以是某个购物场景，也可以是某个模型的官方 API、Coding Plan 或第三方标价。模型标识和规格都放进参数，不要假设只有某一种。GLM-5.3 只是测试用例里用过的名字。不要把任务发到京东或天猫。

`shopswarm_research` 使用 Jev 选择单个价格页上的动作。Jev 的 `DONE` 只是申请结束；工具会检查页面字段，并在新隔离会话中重开 URL 复核。未经复核的 `candidate` 不是已确认价格。

- 调用 `shopswarm_research` 时传页面 `startUrl`、自然语言 `goal`、任务要求的 `model`、`specs` JSON 数组和可选的 `seller`。购物场景里 `model` 是商品型号，`specs` 是规格。Token 或套餐场景里 `model` 是模型标识，`specs` 是计费方式或档位，例如 `[{"name":"计费","value":"按量"}]`。不要从页面文字改写用户要求。
- `status=success` 才能把 `offer` 当作已复核的页面标价。缓存价、运费、高峰系数、额度或币种未知时，不宣称确定的综合费用。按量单价和套餐额度不要加成一个到手价。
- `reasonCode=login_required` 时，把 `userMessage` 原样告诉用户。用户在自己的 Chrome `Default` Profile 登录并回复已登录后，用原任务条件重新调用工具。不要后台轮询。
- `reasonCode=captcha` 时告诉用户需要人工处理，不尝试破解。
- `no_progress` 或 `verification_failed` 时，读取 `progress`、`missing`、`pageUrl` 和页面摘录，判断能否调整目标后再次调用，或向用户说明阻塞。不能绕过复核宣布成功。
- 多个提供方的并行汇总仍属于 M3。当前工具一次只负责一个页面。
- Jev 使用的兔子 API 是动作选择通道，不是被比较的价格来源。

原有 `shopswarm_browse` 保留为手动步骤浏览工具：

- 调用 `shopswarm_browse`。`steps` 是 JSON 数组字符串，包含 1 到 8 个步骤。可用动作是 `open`、`snapshot`、`click`、`fill`、`press`、`waitText`。
- `open` 要带 `url`。`click` 和 `fill` 要带当前快照里的 `role` 和 `name`，`fill` 还要带 `value`。
- 会话在后台启动独立的 headless Chrome，显式关闭自动连接，不抢当前前台窗口的焦点。
- 不配置代理，也不继承终端里的代理变量。
- `shopswarm_diagnose` 只检查运行环境。`checkBrowser: true` 仍只打开配置好的测试页。
- 不要把诊断或手动浏览结果写成已经完成比价。
