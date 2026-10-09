# S6：Jev 交互优先修复

分支：codex/fix-jev-routing。基于 main / origin/main 5ca36563。

## 范围和动作

- [x] 检查 Skill、工具说明和返回提示中的 CLI 引导，统一为页面交互优先 act。
- [x] 保留只读观察、已知 URL 导航和当前步骤失败后的同会话恢复，不强制静态阅读调用 Jev。
- [x] 修复包内 Skill 未注册：接入 DSH skills 服务，验证任意工作区均能发现和读取。
- [x] 执行 pnpm check 并安装当前分支插件到 Web profile。
- [x] 从真实 Web UI 重跑德国千欧通勤自行车任务，不在用户 query 中强制 act；核对 Jev 请求、实际动作、CLI 回退原因、购物证据和 close。
- [x] 完成后更新本任务、roadmap 与 TODO 索引。

## 完成条件

检查通过。真实购物测试确认普通 query 的必要页面交互先经过 Jev，回退按当前步骤说明原因；记录来源 URL、时间、成功/失败、耗时、后台会话及焦点限制。不能用单独 Jev smoke 代替 Web 任务验证。未验证的稳定性不宣称支持。

## 接口检索

2026-10-09：DSH 本地参考仓库缺失；上游 HEAD d743267388641bc76f17c45ce8b4c231aed1d32c，已读取该提交 docs/cordis-tutorial/01-first-plugin.md。接口以本机安装 @deepseek-ai/dsh-tools 0.1.7-alpha.2 及现有插件测试为准。初版修改 shopswarm_browser 的 description/返回提示，随后补充已有 skills 服务的注册调用，未变更 DSH API。Jev 后端参考 https://github.com/forvela/jev-agent-browser，b4d4e0284a4b0336f12831ef6fe64ba5d29b1efb，src/loop.js；保留已有 decision → adapter 接口，未复制代码。

补充检索：本机 @deepseek-ai/dsh-skill 0.1.7-alpha.2 的 README、lib/types/index.d.ts 和 register 实现；@deepseek-ai/dsh-skill-filesystem 同版本的默认 roots 只扫描项目 .dsh/skills、.agents/skills 及用户目录，不扫描安装包 skills。使用既有 ctx.skills.register API 注册包内正文，未复制参考代码。

## 第一轮真实 Web 回归（未通过）

会话 session-44b9848e-f941-410d-880e-ee0adfa3ed7e，2026-10-09 13:46–13:49 UTC。原始自行车 query 未要求 act。工具说明/返回提示的第一版修改触发一次 act、4 次真实 Jev 请求，均 MORE_TARGETS，未执行动作。目标包含导航和筛选多个步骤。Agent 随后自行拼接 CLI、试建 probe-bike24 会话；本轮被人工停止，不算完成购物测试。

同时发现 skill(shopping-research) 返回 unknown or no longer available；此前仅打包 Skill，没有注册。故补充注册、单步目标和精确沿用连接参数的修复后重测。成功读取 https://www.fahrrad.de/collections/cityraeder 的列表，未完成双店核对；初始 /fahrraeder/citybikes/ 为 404；BIKE24 探测停留 about:blank，不能记为本轮站点拒绝。浏览器均后台 headless；UI 未观察到前台跳转，但没有全桌面焦点监测。清理回合工具 close 返回 session_closed；额外 CLI 探测会话关闭返回 closed=true、browserLaunched=false，job_list 为空。私有原始记录位于 DSH 会话日志，不提交。

## 最终版验证

- Node v24.21.0、pnpm 11.7.0；pnpm check 类型检查、15 文件 74 项测试和构建通过。新增测试确认任意工作区都能列出并读取包内 Skill。
- 同步四个手动创建 Cordis Context 的开发脚本，先加载 SkillRegistry 再 apply；补充 typecheck、smoke:browser、smoke:shopping-tool 均通过。两个 smoke 使用本地夹具，仅验证脚本初始化，未替代本次真实 Web 购物回归。
- pnpm web --no-open 打包并安装当前分支；Web profile 的 72 个 dist 文件及 Skill 与源码构建逐字节一致。测试包哈希为 6c4777fbbf596951160860d25b05103c69569c24b144650a63e25c097591dbf0。
- 在真实 Web UI 新建会话，原 query 是“德国、非电动城市通勤自行车、1000 欧、两家店、2–3 款”，只指定使用 ShopSwarm，没有要求 act 或 Jev。最终轮没有人工追加或中途引导。
- 主会话 session-ee6446b2-955a-4e6b-8462-3ce542a0a0fc；两个来源及一个价格复核 Agent 都成功加载 Skill。DSH 原生委派、回传与汇总实际发生。
- 日志时间 2026-10-09T13:53:16.561Z–14:04:12.882Z，耗时 656.3 秒（10分56秒）。来源实际读取集中在此区间；不采用模型估算的采集终点。
- 总计 9 次 act、23 次真实 Jev 请求：17 MORE_TARGETS、2 BLOCKED、4 CLICK；1 次 CLICK executed、3 次 failed（Cookie 遮挡）。不是 API Key 缺失，也不是只运行独立 smoke。
- fahrrad.de：分类点击失败 → 处理 Cookie 的 act 耗尽预算 → 同会话 CLI 点击 shadow DOM 的 Akzeptieren → 再次 act 成功点击 Cityräder。商品规格折叠面板返回 BLOCKED 后，CLI 展开并读取；其他商品页沿用同类不受支持控件的展开恢复。
- BOC24：两次搜索按钮 CLICK 被空 Cookie 容器遮挡；Cookie/分类操作耗尽预算。搜索输入 act 返回 BLOCKED 后，读取表单 action 并用同会话 URL 导航恢复搜索，随后读取商品页。未自行新建探测浏览器。
- 四个托管会话（两个来源、Lead 核验、BOC24 复核）均返回 status=closed / session_closed；四个 daemon 的 PID 文件均已移除。连接参数均为 --headed false、--auto-connect false，未连接用户 Chrome。IAB 未观察到购物窗口抢焦点；未做全桌面焦点监测，不能承诺所有桌面环境都不影响焦点。未修改代理出口。
- Web 服务仍运行，供用户查看；购物浏览器已关闭。私有结构化记录 runtime/jev-routing-web-verification.json，原始 DSH 日志与启动日志均不入 Git。

### 真实来源与核对结果

| 商品/来源 | 本次读到的标价与条件 | URL |
| --- | --- | --- |
| Cube Kathmandu Pro 2026，fahrrad.de | 当前 919 EUR，划线 UVP 999 EUR；运费 29.99 EUR；默认 54 cm | https://www.fahrrad.de/products/cube-kathmandu-pro-coal-n-black |
| Cube Kathmandu Pro 2026，BOC24 | 当前 999 EUR，无划线价；运费结账时计算，保持未知；默认 50 cm | https://boc24.de/products/cube-kathmandu-pro-5 |
| Cube Nulane Pro FE 2027，fahrrad.de | 899 EUR；9 速、液压碟刹 | https://www.fahrrad.de/products/cube-nulane-pro-fe-night-n-chrome |
| Cube Town ONE 2025，BOC24 | 679 EUR；Nexus 7 速、V-Brake；运费未知 | https://boc24.de/products/cube-town-one |

### 验证边界

本轮验证通过的是 Skill 加载与交互优先调用 Jev；不宣称购物报告完全准确。Web 答案把四个会话写成三个，估算采集终点 16:06 CEST 晚于实际最终日志 16:04:12；Kathmandu 两店型号/年份/主要配置相符，但默认尺码 54/50 cm 不同，不能说严格同规格或同 SKU。两站没有明确新品声明，结果只能保留未知。Jev 仅一个动作成功，不能据此宣称稳定高成功率或独立性能收益。

策略是 Skill、工具说明和返回提示对 Agent 的调用约定，不是 bash 权限门禁。本次为联合修复回归，未声称已分别证明每条提示的独立贡献。没有引入新调度器、硬编码商店规则或强制每次阅读调用 Jev。
