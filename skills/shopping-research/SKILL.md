---
name: shopping-research
description: 使用 ShopSwarm 核对 Coding Plan、LLM API 套餐或其他价格页面，并保留来源、未知项和独立验证结果。
---

# ShopSwarm 价格与套餐研究

首个真实领域是 Coding Plan、LLM API 套餐和第三方中转套餐。Skill 名称暂时保留 `shopping-research` 以兼容现有 Bundle；不要据此把任务限定为商城购物。

当前 `shopswarm_research` 仍使用 M2 已实现的 `model + specs + seller` 输入。调用 Coding Plan 页面时：

- `model` 放任务要求的模型标识；
- `seller` 放提供方；
- `specs` 只放当前接口能够明确表达的计费方式或套餐条件；
- 不把计划中的 `PlanOffer`、额度窗口或续费语义伪装成已经实现的字段。

## 多来源任务分发

当用户要求比较至少两个来源，Lead Agent 先写出一份共同任务条件：模型标识、计费需求、需要核对的字段、只读限制。来源 URL 和提供方另列，不把某一来源的页面内容写入共同条件。至少选两个公开可读的 Coding Plan 或中转套餐页面；来源不可达时保留失败，不替换成未经说明的其他提供方。

使用 DSH 已有的 `subagent` 工具（`spawn` 后端）为每个来源启动一个 Subagent。可以在同一轮同时提交独立子任务；不要在 ShopSwarm 中另建 Agent 调度器。对于一次性 `headless` 任务，每个 `subagent` 调用显式设置 `run_in_background: false`，让 Lead 在进程退出前得到子任务结果；交互式会话可按 DSH 的后台模式收取完成通知。每个子任务收到同一份共同条件，以及自己负责的来源 URL、提供方名称。子任务只调用 `shopswarm_research` 核对自己的来源，`model` 使用共同的模型标识，`goal` 包含共同的计费需求和字段要求，`specs` 只包含当前工具能表达的明确条件，`seller` 使用本来源的提供方名称。

要求每个 Subagent 返回同样字段的 JSON 对象：`sourceUrl`、`provider`、`model`、`billingRequirement`、`requestedFields`、`researchResult`。`researchResult` 原样保留工具的 `status`、`reasonCode`、`offer`/`candidate`、`missing` 和 `metrics`；失败时也返回这一结构，无法取得的字段写为 unknown。`specs` 必须是 JSON 字符串；没有已知规格时传 `"[]"`，不能在其中填 `null` 或猜测值。Lead Agent 核对各子任务输入中的共同条件相同，再按来源分别列出结果。当前结果仍是 M2 的单站结构，不把它称为完整的 `PlanOffer`，不让 Agent 自行计算跨来源排名。

ShopSwarm 的 `maxConcurrentBrowserTasks` 配置限制单个 DSH 进程中同时运行的浏览器工具调用，默认值为 2。超过上限的调用等待槽位，等待时收到取消信号就退出。一次 `shopswarm_research` 在独立复核阶段可能短暂拥有两个浏览器会话，因此这个参数限制的是工具调用数，不是浏览器进程数。DSH 的 Subagent 数量由 DSH 管理。

Jev 只负责在当前页面的有效动作集合中选择下一步动作。Jev 的 `DONE` 只是申请结束；工具会抽取页面字段、检查原文证据，并在新隔离会话中重开 URL 复核。未经复核的 `candidate` 不是已确认结果。

处理结果时遵守：

- 只有 `status=success` 的 `offer` 能作为当前 M2 接口下的已复核页面报价。
- 没有页面证据的额度、缓存价、峰谷倍率、续费条件或兼容性保持未知，不能从常识补齐。
- 按量价格、固定套餐价格、首购价、续费价和年付月均不是同一口径，不直接混排。
- Token、request、credit 和不同时间窗口的额度不能只按数字大小比较。
- 多来源比较和排序必须等待 M3/M4 的统一数据契约与确定性代码；当前不要让 Agent 自己算出“最划算”结论。
- `login_required`、`captcha`、`site_rate_limited`、`no_progress` 和 `verification_failed` 都是有效结果。不要绕过验证码或风控。
- Jev 使用的兔子 API 是动作选择通道，不是被比较的 Coding Plan 提供方。

当前产品规则见 `DOC/Coding Plan 比价规则.md`。M1/M2 的购物字段是历史实现，后续 M4 会新增 Coding Plan 领域模型。

原有 `shopswarm_browse` 保留为手动浏览工具。它只用于明确步骤的打开、快照、点击、填写、按键和等待，不把手动浏览结果写成已完成比价。
