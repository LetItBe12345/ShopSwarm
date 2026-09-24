# ShopSwarm Roadmap

更新日期：2026-09-24。产品方向为供 DSH 加载的通用购物研究插件。当前进入快速收尾阶段。

## 产品范围

ShopSwarm 是 DSH 的外部 Bundle、Host Plugin 和 Skill，面向用户给出的购物任务。Agent 理解任务和来源；DSH 管理 Agent 和 Subagent；ShopSwarm 提供浏览器研究、目标校验、报价证据核对和确定性比较；agent-browser 实际操作 Chrome。每个来源的一次研究持有一个浏览器会话，Jev 是默认动作选择器。只有 Jev 决策失败或无法推进时，当前来源 Subagent 才用 `shopswarm_browse` 临时接管同一会话；页面恢复后以 `continuationId` 把研究交回 Jev。浏览器传输错误不触发 Subagent fallback。

品类、商品、来源、规格和比较条件由任务决定，不固定为特定商城或商品。商品身份不匹配、价格口径不同或证据不足时，不强行合并和排序。未知价格、库存、优惠、运费和税费保持 unknown。当前代码具备单站研究和报价复核，以及 DSH 多来源分发基础；通用多商品数据模型和报告尚待实现。

插件只读取页面并整理研究结果，不代替用户购买或支付，不绕过验证码和站点风控。站点支持范围按真实验证记录声明。

使用边界和调用流程见 [使用教程](DOC/使用教程.md) 与 [设计说明](DOC/设计说明.md)。

## M0：DSH 集成与兼容性验证

- [x] **M0 完成** — [M0.1](TODO/done/M0.1-确定环境与集成接口.md)、[M0.2](TODO/done/M0.2-建立最小插件与浏览器连通流程.md)、[M0.3](TODO/done/M0.3-阶段验收.md)
- [x] 建立外部 Bundle 和 Host Plugin，注册诊断工具，不修改 DSH 源码。
- [x] 验证独立 DSH profile 调用、浏览器连通、取消和资源清理。

## M1：浏览器运行与购物数据基线

- [x] **M1 完成** — [M1.1](TODO/done/M1.1-实现浏览器执行适配层.md)、[M1.2](TODO/done/M1.2-管理执行预算与后台会话.md)、[M1.3](TODO/done/M1.3-建立测试基线与购物数据结构.md)、[M1.4](TODO/done/M1.4-阶段验收.md)
- [x] 封装 agent-browser 会话、快照和页面动作，验证后台会话隔离、取消与清理。
- [x] 定义初始 `ProductIdentity`、`Offer` 和 `Evidence` 结构。

## M2：单站研究与动作校验

- [x] **M2 完成** — [M2.1](TODO/done/M2.1-实现上下文、动作选择与文本输入.md)、[M2.2](TODO/done/M2.2-实现完成检查和失败返回.md)、[M2.3](TODO/done/M2.3-验证单站任务并建立性能基线.md)、[M2.4](TODO/done/M2.4-阶段验收.md)
- [x] 实现有限页面上下文、Jev 动作选择、有效目标校验、报价候选提取和独立重开复核。
- [x] M2.3 与 M2.4 的特定来源只是历史测试用例，不限制当前产品方向。

## M3：多来源执行基础

- [x] **M3 完成** — [M3.1](TODO/done/M3.1-接入 DSH 任务分发与资源限制.md)、[M3.2](TODO/done/M3.2-关联结果并处理取消和局部失败.md)、[M3.3](TODO/done/M3.3-阶段验收.md)
- [x] 验证 DSH Subagent 来源分工、浏览器资源限制、任务取消、局部失败和结果归属。
- [x] 既有真实来源实验只证明当时的运行路径，不限制通用购物目标。

## 快速收尾

- [x] **S1 Skill 与 fallback**：Skill、教程、设计说明和工具返回结构已统一为“当前来源 Subagent fallback，必要时交回 Lead”。
- [x] **S2 DSH 安装**：类型检查、构建、Bundle 配置和 profile 工具调用已验证。
- [x] **S3 一次真实使用**：四个 DSH 端到端用例通过，覆盖只读浏览、Subagent handoff 和 Lead handoff。
- [x] **S4 清理**：收尾范围只保留三个职责明确的工具，没有发现还需要删除的运行时代码或配置。
- [x] **S5 发布包**：已生成并检查可安装 tarball，未包含密钥、Cookie、Profile 或临时数据。
- [ ] **S6 Jev 主控与持久来源会话**：实现一个来源任务持有一个可跨工具调用恢复的浏览器会话。见 [S6 TODO](TODO/in-progress/S6-Jev主控与持久来源会话.md)。

## 不做

性能评估、Token 统计、公平比较、专用品类模型、价格监控、自动购买和支付。

## 发布操作

达到可发布条件不等于授权创建 Tag、Release 或对外发布；这些操作仍需用户明确要求。

## 索引

- [使用教程](DOC/使用教程.md)
- [设计说明](DOC/设计说明.md)
- [收尾 TODO](TODO/README.md)
