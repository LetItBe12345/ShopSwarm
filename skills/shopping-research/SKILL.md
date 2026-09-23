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
