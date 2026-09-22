# ShopSwarm

ShopSwarm 是一个面向多 Agent 并行购物研究与比价的项目。当前处于设计阶段，尚无可运行源码。

首版计划通过 DeepSeek Harness 外部 Bundle、Host Plugin 和 Skill 接入，使用 agent-browser 执行浏览器动作，使用 Jev 选择页面动作，并输出带来源证据的结构化报价和 Markdown 比价报告。

## 当前状态

- 已完成项目设计、架构草案和首版 roadmap。
- 已将首版拆分为 22 份可执行 TODO。
- 尚未实现插件、浏览器适配层、Jev 动作循环或购物验证。

开发顺序和验收条件见 [roadmap](roadmap.md)，具体任务见 [TODO 索引](TODO/README.md)，架构说明见 [项目架构与文件规划](DOC/项目架构与文件规划.md)。

## 首版范围

首版以一个商品品类、两个验证过的站点和有限并发为目标。自动下单、支付、领券、修改账户、多浏览器后端和独立 UI 暂不在首版范围内。

## 参与协作

开始任务前请阅读 [AGENTS.md](AGENTS.md) 和对应 TODO。未完成任务位于 `TODO/in-progress/`；任务及验证条件全部满足后，才移入 `TODO/done/`。

`可参考项目/` 只用于本地查阅，已被 Git 忽略，不属于 ShopSwarm 源码或运行时依赖。

## 许可证

项目许可证尚未确定。当前公开内容可供查阅和讨论；在许可证文件添加前，请勿假定已有复制、修改或分发授权。
