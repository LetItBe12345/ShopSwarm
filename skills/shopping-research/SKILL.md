---
name: shopping-research
description: 使用 DSH Subagent 和 ShopSwarm 并行研究多个网页来源，并把证据、未知项和失败来源汇总成最终报告。
---

# ShopSwarm 多来源研究

这个 Skill 负责“怎么做研究”，而不是把研究流程写死在 Plugin 里。

## Lead Agent

收到用户任务后：

1. 先确定用户真正要比较或调查的对象，以及需要看的来源。
2. 来源彼此独立时，优先为每个来源派一个 DSH Subagent，并行执行。
3. 给每个 Subagent 同一份用户目标，再附上它负责的来源 URL / 提供方。
4. 不要求 ShopSwarm 自己实现 Agent 调度。
5. 等各 Subagent 返回后，由 Lead Agent 直接阅读结果并写最终报告。

最终报告由模型根据用户问题组织。不要为了报告再建立固定 `PlanOffer`、统一评分表、benchmark schema 或强制排序框架。

## Subagent

每个 Subagent 只负责自己的来源。

优先使用 `shopswarm_research` 完成页面导航和核对；需要明确手工步骤时使用 `shopswarm_browse`。

返回给 Lead Agent 的内容至少应包含：

- 来源与当前页面；
- 实际找到的关键事实；
- 支持这些事实的页面证据或摘录；
- 没找到或不能确认的内容；
- 登录、验证码、频控、页面不可访问等阻塞；
- 本来源是否已经足够回答用户问题。

不要用另一个来源的数据补当前来源的缺项。

## Jev 与 Agent fallback

Jev 是浏览器动作的快速决策器，不是最终任务 Agent。

当 Jev 正常工作时，优先使用 Jev 选择当前页面动作。

当 Jev 请求失败、返回 BLOCKED、重复动作无进展，或当前页面需要更强的语义判断时，不把这一点直接解释为“整个来源失败”。当前 DSH Subagent 接管判断：

- 阅读工具返回的 URL、页面摘录、当前进度和缺项；
- 决定重新观察、换一个浏览步骤、打开相关页面，或结束本来源；
- 必要时使用 `shopswarm_browse` 完成明确动作；
- 真正遇到登录、验证码、站点频控、页面不可访问等外部阻塞时，再把来源标记为 blocked / failed。

当前实现对 fallback 的结构化回传仍需一个小型代码修复，见 `DOC/收尾实施计划.md`。不要为 fallback 再嵌套实现一套新的 Agent 调度器。

## 汇总原则

报告只需要忠实回答用户问题：

- 有证据的事实直接写；
- 不确定的内容明确写 unknown / 未确认；
- 来源之间口径不同，由 Lead Agent解释差异；
- 用户要求比较时，模型可以根据用户给出的标准进行比较和总结；
- 不需要额外建设确定性 comparability 框架、评分体系或 provider benchmark；
- Coding Plan、商城商品、API 套餐只是不同任务实例，Skill 不绑定某一种领域。

保留必要的来源和证据即可。不要把插件变成一套独立研究平台。
