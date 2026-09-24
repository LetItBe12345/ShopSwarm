---
name: shopping-research
description: 使用 ShopSwarm 研究用户指定的商品、规格和价格页面，并保留来源、未知项和独立验证结果。
---

# ShopSwarm 通用购物研究

ShopSwarm 是 DSH 可加载的购物研究插件。商品类别、来源、规格和比较条件来自用户任务，不固定为某个商城。

## 选择工具

- `shopswarm_research`：对一个来源执行自动页面研究，使用 Jev 选择当前页面动作，并在结束后重新打开商品页复核报价。
- `shopswarm_browse`：只在 `shopswarm_research` 因 Jev 决策失败或无法推进而返回 `continuationId` 后使用。它在该来源的同一浏览器会话中执行明确动作，不调用 Jev。
- `shopswarm_diagnose`：检查运行环境和可选的浏览器连通性。

多来源任务由 DSH Lead Agent 决定是否使用 Subagent 分工。每个来源交给一个 Subagent 后，由该 Subagent 对该来源负责到底。Jev 是默认动作选择器。只有 Jev 超时、返回无效动作、没有可用动作或反复无法推动页面时，当前 Subagent 才使用 `shopswarm_browse` 临时接管。把 handoff 中的 `continuationId` 原样传给 `shopswarm_browse`，不要启动新来源或新浏览器会话。

Subagent 根据最新快照执行恢复动作。页面重新进入可由 Jev 处理的状态后，尽快调用 `shopswarm_research`，只传同一个 `continuationId`，把动作选择交回 Jev。不要在 fallback 中完成整项研究，也不要自行确认报价。登录、验证码、频控或来源无法继续时，把结构化结果交回 Lead。浏览器传输错误不触发 Subagent fallback。

## 任务和结果

把商品身份、规格、卖家、价格条件和需要核对的字段写进任务。当前研究工具仍兼容 `model + specs + seller` 这些历史参数，但它们表示商品型号、规格和卖家，不代表固定的模型套餐领域。

页面没有明确写出的价格、库存、优惠、运费、税费或兼容性保持 unknown。不同规格、币种或价格条件不能强行合并排序。来源不可达、登录要求、验证码、频控和页面结构变化保留为失败或阻塞，不绕过站点保护。

只有工具返回 `status=success` 且字段证据通过独立检查时，才能把报价作为已核实结果。模型返回 `DONE` 只是结束请求；不能代替证据检查。多来源汇总由 Lead Agent 完成。

Jev 只从当前快照生成的有效 Action Space 中选择动作和目标。ShopSwarm 会重新读取页面，确认目标仍属于同一页面版本后，才调用 agent-browser 执行动作。Jev 和 Subagent fallback 共用一个来源会话；报价提取后，ShopSwarm 在该会话重新打开商品页核验。

`handoff.owner=subagent` 时，必须使用结果里的 `continuationId` 调用 `shopswarm_browse`；页面恢复后用同一 ID 恢复 Jev。`handoff.owner=lead` 表示来源受阻或 Jev 在页面无变化时再次失败，应交回 Lead。浏览器错误和文本输入错误不会产生 Subagent 浏览器 fallback。
