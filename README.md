# ShopSwarm

ShopSwarm 是一个给 DSH Agent 使用的浏览器研究插件。

最终目标很简单：Lead Agent 根据用户任务拆分来源，派出多个 DSH Subagent 并行研究；Subagent 使用 ShopSwarm 的浏览器/Jev 工具完成单来源调查；Lead Agent 汇总各来源结果并生成最终报告。

## 当前定位

ShopSwarm 不负责重新实现 DSH 的 Agent 调度，也不负责建立一套领域专用的比较框架。

职责边界：

- **DSH Lead Agent**：理解用户目标、拆分来源、并行派发 Subagent、汇总最终报告。
- **DSH Subagent**：负责一个来源的研究过程；决定要找什么、何时继续、何时结束。
- **ShopSwarm Plugin**：提供浏览器操作、Jev 辅助决策、页面观察和必要的结果回传。
- **agent-browser**：执行实际浏览器动作。
- **Jev**：优先承担便宜、快速的页面动作选择。Jev 失败或卡住时，控制权回到当前 DSH Subagent，不把一次 Jev 失败等同于整个来源任务失败。
- **Skill**：承载任务拆分、来源研究方式、结果组织和最终报告写法。

Coding Plan、LLM API 套餐和商城页面都只是测试/使用场景，不再为某一种场景新增专用领域模型、归一化框架或硬编码报告规则。

## 当前状态

已经完成的核心能力：

- DSH 外部 Bundle / Host Plugin 接入；
- agent-browser 后台浏览器执行；
- Jev 动态 Action Space 与动作执行；
- 单来源研究循环与独立页面复核；
- DSH 多 Agent 使用所需的资源隔离和取消处理。

后续只做收尾，不继续扩展原 M4/M5/Q 路线。详细实施顺序见 [收尾实施计划](DOC/收尾实施计划.md)。

## 文档入口

- [收尾实施计划](DOC/收尾实施计划.md)
- [安装与运行](DOC/安装与运行.md)
- [兼容性与支持范围](DOC/兼容性与支持范围.md)
- [Jev 调用与状态](DOC/Jev调用与状态.md)
- [Jev 中转站使用](DOC/Jev中转站使用.md)
- [接口与数据结构](DOC/接口与数据结构.md)
- [历史 TODO 记录](TODO/README.md)

## 开发

安装、检查和 smoke 命令见 [安装与运行](DOC/安装与运行.md)。

项目只保留能保证插件可运行的测试。Coding Plan、GLM-5.3 等固定样例可以继续作为回归用例，但不再构成产品范围，也不建立 provider benchmark、评分体系或性能排行榜。
