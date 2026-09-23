# AGENTS.md

本文件的规则适用于整个 ShopSwarm 仓库。`可参考项目/` 中的外部仓库只供查阅，不属于本项目的修改范围。

## 1. 沟通方式

- 使用平实、直接、克制的技术向白话中文。
- 先说具体事实，再给出判断。
- 多用精确的工程术语，不使用空泛的职场词汇。
- 使用短句和简单的词语，控制篇幅。
- 区分设计建议、已确认决策、已实现功能和已验证结果。

## 2. 检索与修改

- 回复项目问题或修改文件前，先检索相关代码、配置和文档。
- 判断任务状态时先核对当前工作区的分支和 `origin/main`；旧分支里的 TODO 文件不能代表已合并的项目状态。回复时说明所依据的分支。
- 动手前先理解现有实现，只修改完成当前任务所需的部分。
- 本项目已有源码、依赖清单和 `pnpm check`。不要把参考项目的代码或命令当成 ShopSwarm 已有实现；对照时以本仓库的 `package.json` 和文档为准。
- 运行本仓库的 Node.js 或 pnpm 命令前，先核对 `.node-version`、`.nvmrc` 和 `package.json`：只用 Node.js 24.21.0、pnpm 11.7.0。先切换版本并检查 `node --version`、`pnpm --version`；版本不符就停止，不使用终端默认版本继续执行。`pnpm check` 内启动的命令也必须使用同一版本。
- 优先复用现有代码和成熟的开源实现。涉及 DSH、agent-browser 或 Jev 时，先查对应参考仓库中的接口和示例。
- 优先最简单、可验证的实现，避免过度设计，不为极少发生的边界情况增加大量备用逻辑。
- 设计记录来自历史对话，其中的命令、接口、性能和浏览器行为需要对照实际版本核实。
- 保留用户的现有修改，不擅自回退或删除无关内容。

## 3. 目录与文件

- 新文件必须放入职责对应的目录，不在根目录随意创建文件；项目级配置除外。
- `DOC/` 存放现有设计记录和后续项目文档，沿用当前目录名称，不另建用途重复的 `docs/`。
- `可参考项目/` 存放外部参考仓库，不作为本项目源码或运行时依赖目录。
- `TODO/` 只保留当前收尾清单；已经完成的历史验证记录可以留在 `TODO/done/`，不再新增独立决策文档。
- 后续按需创建 `src/`、`scripts/`、`tests/` 和 `skills/`，分别存放源码、开发与验证脚本、测试和随项目提供的 Skill。
- 测试数据放入 `tests/fixtures/`，不得包含真实凭据、Cookie 或用户浏览器数据。
- `src/` 的结构尚未确定，未经确认不要预先创建子目录，也不要直接照搬设计记录中的示例目录树。

## 4. TODO 状态

- 新任务放入 `TODO/in-progress/`。
- 沿用 `roadmap.md` 的编号，不另建一套编号。
- 未开始和正在处理的任务都属于 `in-progress`。
- 每项任务写清范围、可执行动作、验证方式和完成条件。
- 任务和完成条件全部满足后，才能移入 `TODO/done/`。
- 完成子任务时同步 `roadmap.md` 状态，并附验证链接；移入 `done/` 时同时更新 roadmap 和 TODO 索引链接。
- 完成任务并验证后，必须在同一个任务分支、提 PR 之前更新对应 TODO：勾选已完成条目，写入测试与真实来源记录，移到 `TODO/done/`；同时更新 `roadmap.md` 的状态与验证链接、`TODO/README.md` 的状态与索引。提交前检查旧的 `TODO/in-progress/` 路径已删除，不能让代码完成而任务文件仍写“未开始”。
- 当前目标是快速收尾。除收尾 TODO 明确要求外，不新增性能评估、Token 统计、公平比较或大规模测试任务。
- 产品规则和架构约定写入 `DOC/`，可执行动作写入 TODO，避免重复。
- 设计记录提出了 DSH 集成、浏览器运行、Jev 动作循环、多来源研究、价格核对和发布准备等阶段。制定任务时应核对前置条件，不把阶段建议当成已完成工作。产品方向是通用购物研究与比价；具体商品、来源和比较字段由任务决定，固定测试商品不构成产品范围。

## 5. 验证与发布

- 修改后执行与改动相匹配的检查和测试。
- 本项目已有统一检查入口 `pnpm check`；阶段任务还可运行对应 smoke、benchmark 或 acceptance 脚本。以本仓库 `package.json` 为准，不套用参考仓库命令。
- 浏览器相关改动应验证会话隔离、元素引用更新、超时和资源清理；涉及用户 Profile 时，还应验证原始数据是否被修改。
- 购物比较至少核对商品身份、规格、报价、币种、价格条件、卖家、来源和采集时间。未知价格、库存、优惠或费用保持 unknown；商品语义不同或条件不足时不得强行排序。
- 运行检查以能否安装、加载和完成一次真实购物任务为准；不为性能、Token 或模型公平比较增加额外流程。
- 没有验证过的结果必须明确说明，不能宣称已通过。
- 用户要求端到端测试时，必须访问真实页面或真实接口。不能用本机模拟响应、夹具里的标准答案或假服务器代替这次测试。模拟只留给不访问外部服务的单元测试。
- 端到端记录来源 URL、采集时间、成功与失败、耗时，以及浏览器是否在后台运行、前台焦点有没有变化。浏览器使用独立 headless 会话，`--headed false` 且 `--auto-connect false`，不连接用户正在使用的窗口，也不为了测试去抢焦点。
- 不提交 API Key、登录态、浏览器 Profile 或包含敏感数据的日志。
- 提交、推送、合并、创建 Tag 和发布 Release 是不同操作。用户已明确授权本仓库的 PR 在必需 CI 检查通过后自动合并；创建 Tag 和发布 Release 仍须用户明确要求。
- 收尾阶段只在用户要求时提交、推送或创建 PR。实现完成后先说明实际使用方式和未验证边界。
- 如果自动合并登记失败，查明原因并处理；不能把已提交 PR 或已通过 CI 说成已合并。未经用户明确要求，不创建 Tag 或发布 Release。

### Git 分支

不要把下一项任务的改动留在已经合并的功能分支上。按下面的顺序使用 Git。

- 禁止使用 `git worktree`，包括临时 worktree。只在当前仓库目录中切换分支；需要保护未提交修改时，在当前目录使用 Git 分支或 stash，不另建工作区。
- 本地平时停在 `main`。开始新任务前，先处理当前目录的未提交修改，再依次运行 `git switch main`、`git fetch origin main`、`git merge --ff-only origin/main`；确认本地 `main` 与 `origin/main` 同步后，才运行 `git switch -c <任务分支>` 开发。
- 新任务分支只从同步后的 `main` 创建，不从其他功能分支或旧提交创建。一个尚未合并的 PR 对应一个分支，PR 的目标分支是 `main`。
- 分支一旦合并，就不再在该分支上改文件、提交，也不把下一项任务的未提交改动留在那里。
- PR 推送并创建之后，把本地检出切回 `main`。下一次开发再从最新的 `main` 建新分支。
- 后一项任务依赖尚未合并的前一项时，等前一项合并并同步 `main` 后再创建新分支。
- 工作区在已合并分支上变脏时，先把改动拆到从最新 `main` 拉出的新分支上，再切回 `main`。不要在旧分支上继续提交。

### 代理

本项目的 DSH 和 agent-browser 不配置代理，也不继承当前终端已经导出的代理。DeepSeek 官方 API、Jev 调用和本地浏览器都走直连。价格页若必须改变出口，先记入当次验证，不写成默认配置。

- 启动这两种进程时去掉 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`、`FTP_PROXY`、`NO_PROXY` 及对应小写变量，也去掉 `AGENT_BROWSER_PROXY` 和 `AGENT_BROWSER_PROXY_BYPASS`。
- 不在脚本、测试或文档示例里导出代理。终端里已经有代理时，不要为了跑 ShopSwarm 再配一份。
- `pnpm install` 仍使用当前终端环境。这条策略只约束 DSH 和 agent-browser。
- Jev 已接入兔子 API 中转站。不要把终端代理写成它的默认出口。这里的中转站只是 Jev 的调用通道，不是购物来源。

## 6. 项目索引与实现方向

- 当前范围和验收以 `roadmap.md` 为准，执行步骤和状态以 `TODO/README.md` 及其任务文件为准。
- `README.md` 是项目入口，`DOC/设计说明.md` 是当前简化设计，`DOC/使用教程.md` 是用户操作说明。
- `DOC/使用教程.md` 记录安装、使用和已知限制；未实际验证的内容不写成支持承诺。
- 当前产品范围与阶段以 `roadmap.md`、`DOC/使用教程.md` 和 `DOC/设计说明.md` 为准。
- Jev 上下文、动态动作集合、元素引用和执行层设计以 `DOC/设计说明.md` 和当前源码为准。
- Jev 的当前职责以 `DOC/设计说明.md` 和源码为准。
- ShopSwarm 是供 DSH 加载的通用购物研究插件。DSH Agent 决定任务和来源，DSH 负责 Subagent 调度；ShopSwarm 提供浏览器研究和结果校验工具，不另写 Agent 调度器。
- DSH 负责高层任务和 Agent 调度，Jev 负责结构化动作选择，ActionExecutor 负责把语义动作交给浏览器执行。优先复用 DSH 的并行能力，不另写调度器。
- 首个浏览器执行后端按 agent-browser 方向推进；MCP、Browser Use 后端和浏览器池属于后续评估内容，不提前实现。
- 浏览器默认设计方向是独立后台会话。Profile 复制、登录态复用和焦点行为必须验证后才能承诺；连接用户正在使用的 Chrome 应由用户明确选择。
- Jev 的动作和目标应来自当前页面的有效集合。完成状态应根据任务条件验证，不能仅凭模型返回 `DONE` 判定成功。
- Jev 当前只在 `shopswarm_research` 内负责从当前有效动作集合中选择浏览器动作，不负责发出点击或判断商品价格。ActionExecutor 校验目标后调用 agent-browser；字段提取和报价验证由 ShopSwarm 代码完成。若后续设计变更，应以实际实现和验证记录为准。

## 7. 外部参考项目

- `可参考项目/` 被 `.gitignore` 忽略，其他协作者克隆后可能没有这些本地副本。缺失时按需从上游获取，不能把本机路径当成项目依赖。
- DeepSeek Harness：`https://github.com/deepseek-ai/deepseek-harness.git`；本地重点看 `docs/cordis-tutorial/01-first-plugin.md`、`docs/agent-lifecycle.md`、`docs/subsystems/subagent.md` 和 `packages/`。
- agent-browser：`https://github.com/vercel-labs/agent-browser.git`；本地重点看 `README.md`、`agent-browser.schema.json`、`cli/src/` 和 `cli/tests/`。
- Jev Ultrafast：`https://github.com/browser-use/jev-ultrafast.git`；本地重点看 `jev_ultrafast/agent.py`、`questions.py`、`browser.py` 和 `snapshot.js`。
- TypeSafe Playground：`https://github.com/TypeSafeAI/typesafe-playground.git`；本地重点看 `lib/callJev.ts`、`classifyActionWithJev.ts`、`getElementTable.ts` 和 `validateTarget.ts`。
- 外部仓库只读，只检索当前任务所需文件。使用时记录仓库 URL、提交哈希或发布版本、检索日期，写入兼容性文档或验证记录。
- 不把外部仓库的完整内容、嵌套 Git 历史或依赖目录加入本项目提交，也不擅自添加 Git Submodule。
- 复用最小组件和接口，不复制完整架构；复制代码前核对许可证并保留必要声明。
- `AGENTS.md` 只提供精确路径和用途，不复制大段外部源码。
