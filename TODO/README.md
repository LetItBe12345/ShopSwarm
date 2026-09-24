# ShopSwarm 收尾 TODO

目标：把 ShopSwarm 收尾为一个可安装到 DSH 的通用购物研究插件。

## 正在进行

- [ ] [S6：Jev 主控与持久来源会话](in-progress/S6-Jev主控与持久来源会话.md)：Jev 默认控制每个来源；Subagent 只在 Jev 失败后临时接管同一浏览器会话，并可恢复 Jev。

## 必做

- [x] 整理 `shopping-research` Skill：说明工具选择、Subagent fallback 和失败结果处理。见 [Skill](../skills/shopping-research/SKILL.md)。
- [x] 确认 `shopswarm_research` 能在 DSH profile 中使用，浏览器会话能正常创建和清理。见 [DSH 端到端脚本](../scripts/e2e-dsh-plugin.ts)。
- [x] 确认插件打包文件可安装，README 和[使用教程](../DOC/使用教程.md)的命令与实际包一致。已用 `pnpm pack` 检查 tarball 内容。
- [x] 用 DSH 工具调用完成一次只读购物研究路径，并验证结果交回 Agent。四个端到端用例全部通过。
- [x] 清理收尾范围：保留三个职责明确的工具，未发现还需要删除的运行时代码或配置。

## 暂不做

性能评估、Token 或费用统计、公平比较、专用品类数据模型、复杂报告、价格监控、自动购买和支付。

## 完成条件

干净的 DSH profile 能安装插件，Agent 能根据 Skill 使用工具完成只读购物研究；每个来源研究只持有一个浏览器会话，Jev 失败时当前来源 Subagent 使用同一会话恢复页面并交回 Jev；浏览器传输错误不触发 fallback，登录、验证码、限流和无法核验时交回 Lead；包中不包含密钥、Cookie、Profile 或临时数据。

## 验证记录

- `pnpm check`：类型检查、60 个测试和构建通过。
- `pnpm run e2e:dsh-plugin`：诊断、直接浏览器操作、Subagent handoff、Lead handoff 四个用例通过。
- `pnpm pack`：tarball 只包含 `dist/`、`cordis.patch.yml`、README、package.json 和 Skill。
