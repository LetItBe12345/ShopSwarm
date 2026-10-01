# ShopSwarm 收尾 TODO

目标：把 ShopSwarm 收尾为一个可安装到 DSH 的通用购物研究插件。

## 正在进行


- [ ] [Browser Agent Benchmark](browser-benchmark.md)：比较 DeepSeek + agent-browser CLI 与 DeepSeek + ShopSwarm 的完整任务结果、耗时和 Token；历史 30 次重复评估未执行。[新增 15 次三组单轮评估](../DOC/评估记录-2026-09-30-修改后与直接浏览器.md)已完成，不能代替该历史计划。

## 已完成

- [x] [S6：单工具五用例对照](done/S6-单工具五用例对照.md)：最终两组均4/5标价通过；单工具中位2:36、CLI5:27；Jev9请求、6动作尝试，独立收益未证实。[完整基线](../DOC/评估记录-2026-10-01-单工具与直接CLI.md)。

- [x] [S6：单工具浏览器适配与任务验收](done/S6-单工具浏览器适配与任务验收.md)：67 项检查、真实 CLI 与失败修复回归完成；[验证记录](../DOC/验证记录-2026-09-30-单工具浏览器.md)。

- [x] [S6：修改后与直接浏览器对比](done/S6-修改后与直接浏览器对比.md)：15 次真实 CLI 与人工审阅完成；Profile 未显示稳定优势，Jev 未调用；[完整评估](../DOC/评估记录-2026-09-30-修改后与直接浏览器.md)。

- [x] [S6：来源 Subagent 主导与五用例验证](done/S6-修复真实购物研究阻断.md)：69 项检查通过，五次真实 CLI 完成，三例取得报价、两例受阻；[验证记录](../DOC/验证记录-2026-09-30-来源Agent主导.md)。

- [x] [S3：验证 CLI 子任务回传](done/S3-验证CLI子任务回传.md)：headless 同步委派；真实 CLI 中两次子任务诊断结果均先回传，再由父任务汇总。
- [x] [S2：固定 DSH 版本](done/S2-固定DSH版本.md)：已回退到 `0.1.7-alpha.2`，启动和安装使用本地固定版本；项目检查及真实 CLI 插件加载通过。
- [x] [S6：Jev 主控与持久来源会话](done/S6-Jev主控与持久来源会话.md)：历史流程已被来源 Agent 主导设计取代，记录仅保留历史验收。

## 必做

- [x] 整理 `shopping-research` Skill：说明工具选择、Subagent fallback 和失败结果处理。见 [Skill](../skills/shopping-research/SKILL.md)。
- [x] 确认 `shopswarm_research` 能在 DSH profile 中使用，浏览器会话能正常创建和清理。见 [DSH 端到端脚本](../scripts/e2e-dsh-plugin.ts)。
- [x] 确认插件打包文件可安装，README 和[使用教程](../DOC/使用教程.md)的命令与实际包一致。已用 `pnpm pack` 检查 tarball 内容。
- [x] 用 DSH 工具调用完成一次只读购物研究路径，并验证结果交回 Agent。四个端到端用例全部通过。
- [x] 历史三工具收尾；当前按用户要求改为一个 shopswarm_browser，见上方单工具任务。

## 暂不做

复杂综合评分、专用品类数据模型、复杂报告、价格监控、自动购买和支付。

## 完成条件

干净的 DSH profile 能安装插件，Agent 能根据 Skill 使用工具完成只读购物研究；每个来源研究只持有一个浏览器会话，来源 Subagent 可直接浏览并完成报告，Jev 按需单步调用；证据可追溯，未知与推理明确，执行错误交给来源 Agent 处理；包中不包含密钥、Cookie、Profile 或临时数据。

## 验证记录

当前接口：69 项测试、构建、打包安装、五次真实 CLI 与 Samsung 回归完成，见上方新记录。以下为历史接口验收，不代表当前实现。

- `pnpm check`：类型检查、16 个测试文件共 71 项测试和构建通过。
- `pnpm run e2e:dsh-plugin`：诊断、Lead handoff、Subagent handoff、同会话浏览和 Jev 恢复通过；每次工具调用有 60 秒上限。
- `pnpm run e2e:s6-live`：真实 Apple 页面上以同一 `continuationId` 完成 Subagent 浏览和 Jev 恢复；页面仍返回 `no_progress`，未把完整报价写成成功。
- `pnpm run acceptance:m0`：`0.2.0` tarball 可安装到干净 DSH profile，自然语言工具调用、资源清理、外部会话保留和卸载通过。
- `pnpm pack`：tarball 只包含 `dist/`、`cordis.patch.yml`、README、package.json、许可证和 Skill。
