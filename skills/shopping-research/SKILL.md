---
name: shopping-research
description: 使用 ShopSwarm 研究用户指定的商品、规格和价格页面，并保留来源、未知项和独立验证结果。
---

# ShopSwarm 通用购物研究

ShopSwarm 是 DSH 可加载的购物研究插件。商品类别、来源、规格和比较条件来自用户任务，不固定为某个商城。

## 选择工具

- `shopswarm_research`：对一个来源执行自动页面研究，使用 Jev 选择当前页面动作，并在结束后提取和独立复核报价。
- `shopswarm_browse`：调用方已经知道步骤时，按明确步骤打开页面、读取快照、点击、填写、按键或等待；不使用 Jev。
- `shopswarm_diagnose`：检查运行环境和可选的浏览器连通性。

多来源任务由 DSH Lead Agent 决定是否使用 Subagent 分工。每个来源交给一个 Subagent 后，由该 Subagent 对该来源负责到底。Jev 超时、返回无效动作或页面无进展时，当前 Subagent 使用 `shopswarm_browse` 直接继续点击、填写、选择、滚动或返回；不要让 Lead Agent 直接接管页面。只有当前 Subagent 判断来源无法继续、需要登录/人工处理、或需要换来源时，才把结构化结果交回 Lead，由 Lead 重新分派或结束该来源。

## 任务和结果

把商品身份、规格、卖家、价格条件和需要核对的字段写进任务。当前研究工具仍兼容 `model + specs + seller` 这些历史参数，但它们表示商品型号、规格和卖家，不代表固定的模型套餐领域。

页面没有明确写出的价格、库存、优惠、运费、税费或兼容性保持 unknown。不同规格、币种或价格条件不能强行合并排序。来源不可达、登录要求、验证码、频控和页面结构变化保留为失败或阻塞，不绕过站点保护。

只有工具返回 `status=success` 且字段证据通过独立检查时，才能把报价作为已核实结果。模型返回 `DONE` 只是结束请求；不能代替证据检查。多来源汇总由 Lead Agent 完成。

Jev 只从当前快照生成的有效 Action Space 中选择动作和目标。ShopSwarm 会重新读取页面，确认目标仍属于同一页面版本后，才调用 agent-browser 执行点击、填写、选择或滚动。Jev 失败时不自动让 Lead 操作页面；结果中的 `handoff.owner=subagent` 表示当前来源 Subagent 应改用 `shopswarm_browse`，`handoff.owner=lead` 才表示需要 Lead 重新分派或处理。
