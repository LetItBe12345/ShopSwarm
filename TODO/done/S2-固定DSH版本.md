# S2：固定已验证的 DSH 版本

范围：回退本机 DSH 到 `0.1.7-alpha.2`，让仓库启动入口和安装入口使用固定版本，避免全局新版改变运行环境。不改变购物研究和 Subagent 调度代码。

- [x] 核对历史验证基线与本机实际版本。
- [x] 固定插件 DSH 版本声明，统一 CLI、Web、TUI 的本地 DSH 启动入口。
- [x] 回退本机全局 DSH，并重新安装现有 headless/web profile 中的插件。
- [x] 执行 `pnpm check`、脚本语法检查、版本检查和真实 CLI 插件加载验证。
- [x] 更新教程、README、roadmap 和 TODO 索引，记录结果与未验证边界。

完成条件：本机全局和仓库 CLI 均报告 `0.1.7-alpha.2`，现有 profile 能加载插件；统一入口拒绝版本不符；项目检查通过。没有有效 Jev 密钥时不宣称购物比价成功。

来源：`https://github.com/deepseek-ai/deepseek-harness`，已安装发布包 `0.1.7-alpha.2` 与 `0.2.0-rc.2`，检索日期 2026-09-30。历史基线见 [M0.1](../done/M0.1-确定环境与集成接口.md)；对照两版 `@deepseek-ai/dsh-headless/lib/index.js`，都在主 Agent `whenIdle()` 后输出结果并请求退出，不能把提前退出直接认定为新版回归。

## 验证记录

2026-09-30，Node.js `24.21.0`、pnpm `11.7.0`：

- `pnpm check`：16 个测试文件、71 项测试、类型检查和构建通过。
- `bash -n`：统一入口及 Web/TUI 包装脚本语法检查通过。
- 全局 `dsh --version` 和 `bash scripts/run-dsh.sh --version` 均返回 `0.1.7-alpha.2`。
- 手动验证 Node.js 版本不符时入口拒绝启动；独立临时目录声明 DSH `0.2.0-rc.2`、实际依赖为旧版时，入口也拒绝启动。
- 重新打包并安装 headless/web profile，安装后 ShopSwarm 的 `engines.dsh` 为 `0.1.7-alpha.2`。profile 原先引用的根目录 tarball 已不存在，先备份配置，再将本机引用更新到 `runtime/dsh-pin/` 中的新包。
- 真实旧版 CLI 接收一个诊断 prompt，Agent 调用 `shopswarm_diagnose(checkBrowser=false)`，返回 `status=ok`，CLI 正常退出。日志在本机 `runtime/dsh-pin/cli-load.log`，不提交运行数据。
- Web profile 的 `--dump-config` 成功，组合配置包含 ShopSwarm；本次未启动 Web/TUI 界面。
- profile 的 pnpm peer 检查提示缺少 Cordis 和 dsh-tools；DSH profile 设置 `autoInstallPeers: false`，运行时由 DSH 宿主提供这些包。本次实际插件调用已通过，不额外安装另一套工具运行时。

边界：本次确认版本回退与插件加载，没有重跑购物比价。`JEV_API_KEY` 仍缺失；回退版本不能修复这个配置问题，也不能证明后台 Subagent 等待问题已解决。
