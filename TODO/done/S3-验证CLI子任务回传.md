# S3：验证 CLI 子任务回传

范围：一次性 headless CLI 用 DSH 原生配置让子任务同步返回；不改 DSH 源码、不增加调度器、不测试购物报价。

- [x] 核对 DSH `0.1.7-alpha.2` 的 Subagent 配置与返回接口。
- [x] headless 启动入口加载同步委派配置，并更新 Skill 和使用说明。
- [x] 验证 headless 配置覆盖生效，Web/TUI 不受影响。
- [x] 通过真实 DSH CLI prompt 委派子 Agent 调用插件诊断，确认父任务收到结果后才输出最终答案。
- [x] 执行 `pnpm check`，同步 roadmap 与 TODO 索引。

完成条件：真实 CLI 日志包含子任务调用、带插件诊断结果的回传、父任务最终汇总，且不再以“等待子任务”结束；不需要 Jev 密钥。所有验证结果记录后移入 done。

来源：`https://github.com/deepseek-ai/deepseek-harness`；本机发布包 `@deepseek-ai/dsh-tool-subagent@0.1.7-alpha.2`、`@deepseek-ai/dsh-subagent@0.1.7-alpha.2` 和 `@deepseek-ai/dsh-headless@0.1.7-alpha.2`，检索日期 2026-09-30。配置 `enableRunInBackground: false` 由原生工具支持，执行路径会等待 `run.result`。

## 验证记录

2026-09-30，Node.js `24.21.0`、pnpm `11.7.0`、DSH `0.1.7-alpha.2`：

- `pnpm check` 通过：16 个测试文件、71 项测试、类型检查和构建。
- `bash -n scripts/run-dsh.sh` 通过；`--profile headless` 与 `headless` 简写的组合配置均包含两个 `enableRunInBackground: false`，分别保留 spawn/subagent 和 fork/subagent_fork 的身份配置。`--profile web` 的组合配置没有 headless patch；TUI 包装入口仍传入 tui，不匹配该 patch。
- 通过真实 CLI 输入一个 prompt，要求子 Agent 使用 `shopswarm_diagnose(checkBrowser=false)` 后由主 Agent 汇总。没有中途介入，也没有模拟 API 或工具结果。CLI 在约 14.25 秒后以退出码 0 结束。
- 主 Agent 自行发起两次同步 `subagent` 调用，两个调用结果均直接包含 `status: ok`、`nodeVersion: v24.21.0`、`agentBrowserVersion: agent-browser 0.38.1`，没有只返回后台 ID。核对两个子会话，各自确实调用一次插件诊断；父任务最终回答出现在两次返回之后，包含这三个字段。
- 原始 CLI 输出与两个子会话记录保存在本机 `runtime/subagent-return/cli-return.log`，不提交运行数据。主会话 ID：`session-d9f96a2f-008c-4e03-b32c-aa62212031c8`。

边界：本次没有商品页面访问，没有启动浏览器，也不调用 Jev。验证的是真实 DSH 模型调用、子 Agent 插件调用和父任务回传；购物比价与长时间子任务仍未验证。直接运行全局 DSH 不会自动加载项目启动入口的 patch。
