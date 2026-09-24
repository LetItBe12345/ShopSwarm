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
- [x] 更新后的 DSH 工具运行脚本覆盖 continuation handoff；登录页用例先运行，随后验证 Jev 暂停、同会话浏览和恢复。该脚本使用本机测试页，不能代替真实来源验收。

## 完成条件

- 同一来源研究的 Jev、Subagent fallback、Jev 恢复和报价复核使用同一个浏览器会话。
- Jev 决策失败才进入 Subagent fallback；浏览器传输错误不进入该路径。
- Subagent 回到 Jev 时沿用原研究上下文和最新页面引用；完成、取消、过期和插件卸载都会关闭会话并释放资源名额。
- 相关文档和验证记录与实现一致。

## 当前验证记录

2026-09-24，Node.js 24.21.0、pnpm 11.7.0：`pnpm check` 通过。更新后的 `pnpm run e2e:dsh-plugin` 已启动真实 headless DSH/浏览器流程，但在本次运行中长时间无输出，手动中止，未列为通过；未使用模拟结果替代。

2026-09-24，无代理环境重查：原脚本在 Jev 恢复后仍返回 Subagent handoff，第一个来源继续占用默认唯一浏览器名额；下一项登录页研究无限等待资源，外层 180 秒超时。调整独立登录页用例顺序，并给每次工具调用设置 60 秒上限后，本机测试页的 DSH 工具脚本约 15 秒通过。运行时 Node.js 24.21.0、pnpm 11.7.0，进程及 `.env` 加载后的代理变量名列表为空；`pnpm check` 的 71 项测试、类型检查和构建通过。

真实来源验证：`https://www.apple.com/shop/buy-iphone/iphone-16`，最近一次采集时间 `2026-09-24T10:05:03Z`。用 `pnpm run e2e:s6-live` 调用真实页面、Jev 和 DSH 工具，约 27.9 秒；首次研究返回 `no_progress` 和 `continuationId`，`shopswarm_browse` 在同一会话完成快照，再用同一 ID 恢复 Jev。恢复仍返回 `no_progress`，没有取得可核验的完整报价。浏览器为 `--headed false --auto-connect false`，环境没有 DISPLAY，焦点前后均记录为 `no-display`；进程代理变量名列表为空。

发布安装复核：修正 M0 验收脚本中写死的 `0.0.0` tarball 文件名，并改为调用项目正式安装入口。无代理环境下 `pnpm run acceptance:m0` 通过，确认 `0.2.0` 包可安装到干净 DSH profile，自然语言工具调用、正常/失败/取消清理、外部会话保留和卸载均符合预期。
