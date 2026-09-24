# S6：Jev 主控与持久来源会话

## 范围

一个来源的一次研究持有一个浏览器会话。Jev 是默认动作选择器；只有 Jev 决策失败或无法推进时，当前来源 Subagent 才临时接管。Subagent 与 Jev 在同一会话、同一研究上下文中交替执行，报价复核也复用该会话。

## 可执行动作

- [x] 将研究流程改为可挂起和恢复的来源任务，生成绑定当前 DSH Agent 的 `continuationId`。
- [x] 让 `shopswarm_browse` 通过 `continuationId` 在原会话执行动作，再由 `shopswarm_research` 恢复 Jev。
- [x] 移除 fallback 每批固定 8 步的限制；添加挂起过期、资源名额保留、取消和插件卸载清理。
- [x] 让浏览器传输错误与 Jev 决策失败走不同结果路径，避免浏览器故障触发 Subagent fallback。
- [x] 更新设计说明、教程、Skill、README、Roadmap 和 DSH 端到端脚本。

## 验证方式

- [x] `pnpm check`：类型检查、16 个测试文件共 71 项测试、构建。
- [x] 本地浏览器测试覆盖 Jev 暂停、Subagent 同会话操作、恢复 Jev、会话过期、Agent 所有者校验和清理。
- [ ] 更新后的 DSH 端到端脚本覆盖 continuation handoff；本次运行未完成，未声明通过。

## 完成条件

- 同一来源研究的 Jev、Subagent fallback、Jev 恢复和报价复核使用同一个浏览器会话。
- Jev 决策失败才进入 Subagent fallback；浏览器传输错误不进入该路径。
- Subagent 回到 Jev 时沿用原研究上下文和最新页面引用；完成、取消、过期和插件卸载都会关闭会话并释放资源名额。
- 相关文档和验证记录与实现一致。

## 当前验证记录

2026-09-24，Node.js 24.21.0、pnpm 11.7.0：`pnpm check` 通过。更新后的 `pnpm run e2e:dsh-plugin` 已启动真实 headless DSH/浏览器流程，但在本次运行中长时间无输出，手动中止，未列为通过；未使用模拟结果替代。
