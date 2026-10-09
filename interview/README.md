# ShopSwarm 项目架构图（中英文）

| 版本 | 图片 | 可编辑矢量源文件 |
| --- | --- | --- |
| 英文版 | [PNG](shopswarm-architecture.png) | [SVG](shopswarm-architecture.svg) |
| 中文版 | [PNG](shopswarm-architecture-zh.png) | [SVG](shopswarm-architecture-zh.svg) |

两个版本均为 1800 × 2240，内容与架构基线一致。英文版保留原文件名，中文版使用 `-zh` 后缀。英文优先使用 DejaVu Sans / Arial，中文优先使用 Noto Sans CJK SC。

图分为任务与推理层、插件内部模块、模型与浏览器后端、单次交互控制流。实线表示调用或返回，虚线表示来源 Agent 使用同会话 CLI fallback。图中默认值以源码为准，不表示所有网站均已验证可用。

## 实现基线

核对日期：2026-10-09。当前任务分支：`codex/interview-architecture`，从同步后的 `main` 创建。绘图依据 `main` / `origin/main` 提交 `5e096a0d57f8bc569b541be24f83141501b511f5`，ShopSwarm `0.3.0`。

## 源码对应

| 图中模块 | 依据 | 说明 |
| --- | --- | --- |
| DSH Bundle / Host Plugin | [Bundle 配置](../cordis.patch.yml)、[入口](../src/index.ts)、[依赖版本](../package.json) | 注入 tools，只注册 shopswarm_browser；DSH 负责 Agent 调度 |
| Lead / 来源 Agent 工作流 | [购物研究 Skill](../skills/shopping-research/SKILL.md)、[当前设计](../DOC/设计说明.md) | 来源 Agent 判断商品与报价，Lead 核对可比性并汇总；这些是 Agent 职责，不是插件内的调度器 |
| 工具入口 | [src/index.ts](../src/index.ts) | open / observe / read / act / close，默认 4 次决策、最大 12 次；一次实际动作后返回 |
| 会话注册与资源限制 | [run-registry.ts](../src/shopping/run-registry.ts)、[resource-limit.ts](../src/resource-limit.ts) | 所有权、互斥、默认 4 槽位、15 分钟闲置回收 |
| 持久来源任务 / 证据 | [run.ts](../src/shopping/run.ts)、[page-context.ts](../src/page-context.ts) | 原始快照、采集时间、分片、动作历史、候选游标与 trace |
| Jev 上下文与动作执行 | [jev.ts](../src/jev.ts) | 动态操作与候选目标、默认 40 候选、3000 字节切片、32 KiB 请求上限；执行前刷新引用并校验 |
| 浏览器后端与同会话 CLI | [agent-browser-session.ts](../src/browser/agent-browser-session.ts) | 独立 headless 会话、CLI 连接参数、动作后快照、超时与清理 |
| 直连与环境隔离 | [direct-http.ts](../src/direct-http.ts)、[direct-env.ts](../src/direct-env.ts) | Jev HTTP 直连；浏览器移除继承代理及用户会话相关环境配置 |

图展示当前注册工具的主链路。仓库保留的历史实验、评估脚本、类型和辅助导出不等于当前工具必经流程。Jev DONE 只提示浏览步骤结束，购物任务是否完成由来源 Agent 根据用户问题和证据判断。CLI fallback 复用同一个 daemon；工具与 CLI 不同时操作同一会话；直接 CLI 不续租，长调试应调用 observe。

## 本次验证

已逐项核对上述源码、版本和当前设计，成功将 SVG 渲染为 PNG，并检查图中文字、连线和布局。架构图制作阶段仅新增架构材料，没有修改运行代码，没有运行 pnpm check 或真实购物端到端任务。随图一起提交的 Web 启动修复及其验证另见 [S2 完成记录](../TODO/done/S2-Web默认加载当前插件.md)。

重新导出 PNG（需要 librsvg 的 rsvg-convert）：

```bash
rsvg-convert interview/shopswarm-architecture.svg -o interview/shopswarm-architecture.png
rsvg-convert interview/shopswarm-architecture-zh.svg -o interview/shopswarm-architecture-zh.png
```
