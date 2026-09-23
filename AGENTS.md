# AGENTS.md

本文件适用于整个 ShopSwarm 仓库。

## 1. 项目目标

ShopSwarm 是 DSH 的外部浏览器研究插件，不是独立 Agent 平台。

最终链路：

`DSH Lead Agent -> 多个 DSH Subagent -> ShopSwarm 工具 -> agent-browser / Jev -> Subagent 结果 -> Lead Agent 报告`

职责必须保持简单：

- DSH 负责 Agent 调度和最终汇总。
- ShopSwarm 负责浏览器工具、Jev 辅助动作和必要的状态回传。
- agent-browser 负责浏览器执行。
- Skill 负责研究策略、任务拆分和报告写法。
- Jev 失败或无进展时，当前 DSH Subagent 应能接管判断；不要在 Plugin 内再造一套 Agent 调度器。

## 2. 收尾原则

- 优先删除无用层次，不为未来假设增加抽象。
- 不再推进 M4、M5、Q 路线。
- 不建立 provider benchmark、评分体系、性能排行榜或学术式评估框架。
- Coding Plan、GLM-5.3、商城页面都只是可替换测试样例，不是产品领域边界。
- 不新增 `PlanOffer` 一类领域专用模型，除非未来真实需求证明现有工具完全无法表达。
- 最终报告逻辑优先写在 Skill，由 Lead Agent 完成，不写成大量硬编码规则。

## 3. 修改代码前

先阅读当前实现和 [DOC/收尾实施计划.md](DOC/收尾实施计划.md)。

Node.js、pnpm 和依赖版本以仓库现有配置为准。不要修改 DSH 源码；ShopSwarm 继续作为外部 Bundle / Host Plugin。

浏览器相关修改仍需保证：

- 不误操作别的会话；
- 页面 revision / element ref 失效时不执行旧动作；
- 取消后释放本任务资源；
- 登录、验证码、频控等真实阻塞能回传给 Agent。

这些是运行正确性，不是评估体系。

## 4. 文档

`DOC/收尾实施计划.md` 是当前唯一的未来实施规划。

`TODO/done/` 和 `decision/` 中旧文件是历史记录，不再作为未来阶段要求。不要恢复旧 roadmap，也不要因为历史 M4/M5 文档重新创建对应任务。

`skills/shopping-research/SKILL.md` 描述当前希望的 Agent 工作方式。

## 5. 测试

只保留与可运行性和关键行为直接相关的测试：

- 插件能加载；
- 浏览器基本动作可用；
- Jev Action Space 校验正确；
- 会话隔离、取消和清理正确；
- fallback 修复后的控制权回传正确。

固定页面和 Coding Plan 可以做回归样例。不要为比较模型、比较 provider 或生成排行榜建立测试框架。

提交前运行仓库现有 `pnpm check`；如果本次只是文档删除且没有改运行配置，可以不新增额外验证流程。

## 6. Git / PR

每个独立修复从最新 `main` 建分支并提交 PR。

用户要求“提 PR”不等于自动合并。除非用户明确要求，否则不要自动合并、创建 Tag 或发布 Release。
