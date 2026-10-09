# S2：Web 默认加载当前插件

范围：修复本机 web profile 仍使用 0.2.0 包的问题，简化当前源码的 Web 启动。随本次提交保留已有 interview 架构图。

- [x] 增加 pnpm setup / pnpm web；Web 启动前构建、打包并安装当前源码。
- [x] 同版本新内容使用不同包路径，避免旧包缓存；安装和启动使用相同 DSH home。
- [x] 执行 pnpm check，验证默认 web profile 的包内容与本次构建一致，并验证 Web 服务与工具加载。
- [x] 记录实际验证来源、版本、结果与边界，更新 roadmap 和 TODO 索引后移入 done。

完成条件：本地默认 Web 加载当前 shopswarm_browser 实现，旧 shopswarm_research 不再由 ShopSwarm 注册；原有其他插件保留。提交操作：代码与已有架构图一起提交 PR；必需 CI 通过后合并，再将本地 main 快进。

## 实现与验证记录

核对日期：2026-10-09。任务分支：`codex/web-current-plugin`；从同步后的 main / origin/main `5e096a0` 创建。

- `pnpm setup` 安装源码依赖并准备 web profile；`pnpm web` 每次启动前 build、pack、安装当前包。内容哈希用于包路径，因此同版本源码更新也不会沿用旧包。
- 安装与启动统一使用 `SHOPSWARM_DSH_HOME > DSH_HOME > ~/.dsh`。本机默认 profile 从历史 `0.2.0` 更新到当前 `0.3.0`，保留原有 bundles。此处 profile 为 DSH 配置，不复用用户 Chrome Profile。
- profile 使用 DSH 自带 `initProfile` 初始化，并固定 `packageManager: pnpm@11.7.0`。第一次安装发现 Corepack 在 profile 目录选择全局 `11.15.1`，修复后安装输出已确认 `11.7.0`。
- Node.js `24.21.0`、pnpm `11.7.0` 下统一检查：73 项测试、类型检查、构建通过；Shell 语法与 git diff --check 通过。
- 默认 web profile 已安装包的全部 72 个 dist 文件与当前源码构建逐字节一致。
- `pnpm web --no-open` 实际启动；本机 Web 首页完成认证，HTTP 200，HTML 33023 字节。未自动打开前台浏览器。
- 通过真实 DSH `runProfile` 启动同一默认 web profile（验证端口 3081），确认注册 `shopswarm_browser`，没有旧 `shopswarm_research`。从其 `ctx.tools` 调用 open / close：访问 https://www.thomann.de/de/shure_sm_7b_studiomikro.htm 成功，取得真实页面快照，关闭成功；采集时间 `2026-10-09T12:55:36.799Z`，耗时 7207ms。页面含 Cookie 提示，未将这次连通检查写成价格比较成功。
- 浏览器使用 `--headed false --auto-connect false`，不连接用户浏览器。Wayland 前台焦点未测量。没有测试 Web 聊天中的完整模型回答、Jev 交互或系统 TUN 出口；代理清理沿用原有入口和执行层逻辑。
- 本地原始验证输出在忽略目录 `runtime/`，不提交认证 URL、Cookie、密钥或运行日志。此前直接导入安装包的独立测试缺少 DSH peer 解析，简化 Agent 对象也不满足完整 Web 中间件；改为真实 DSH Web 启动及真实 Agent 上下文后通过。

## 实际来源

- ShopSwarm：本任务分支的 `package.json`、`scripts/run-dsh*.sh`、`scripts/install-dsh-plugin.ts` 和实际安装的默认 web profile。
- DSH 上游：https://github.com/deepseek-ai/deepseek-harness ，固定 npm 版本 `@deepseek-ai/dsh@0.1.7-alpha.2` / `@deepseek-ai/dsh-app-boot@0.1.7-alpha.2`。检索本机该版本发布产物中的 `profile-boot`、`initProfile`、`runPluginCommand` 和 Web startup；检索日期 2026-10-09。不修改上游源码。
- 浏览器后端：本仓库固定 `agent-browser@0.38.1`。
