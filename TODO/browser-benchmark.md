# Browser Agent Benchmark TODO

目标：建立一套小型、可重复、可维护的 live browser benchmark，用于比较 ShopSwarm 的 Jev 动作选择与 DeepSeek V4 Flash 直接驱动同一套 agent-browser Action Space 时的端到端表现。

Benchmark 只回答三个核心问题：**任务能否完成、完成需要多少时间、完成消耗多少 Token**。不建立复杂综合评分，不把不同指标强行加权成一个分数。

- [ ] **1. 固定公平比较边界**
  - [ ] 两组统一使用现有 `runShoppingTask()`，共享相同的浏览器会话实现、页面快照、`buildActionRequest()`、Action Space、`executeSelectedAction()`、报价抽取和最终验证逻辑。
  - [ ] ShopSwarm 组固定使用现有 `chooseAction()`；baseline 组固定使用现有 `chooseLlmAction()`，模型为 `deepseek-v4-flash`。
  - [ ] 除 action selector 外，不允许为某一组增加站点专用 prompt、额外页面信息或额外浏览器能力。
  - [ ] Benchmark 中不执行 DSH Subagent fallback；`jev_error`、`no_progress` 等结果直接记录为本轮结果，避免把 “Jev + DSH fallback” 和单模型 baseline 混成不同系统。
  - [ ] 保留现有 `provider-benchmark.ts`，但把它视为静态 Provider / extraction micro benchmark，不作为 Browser Agent 主 benchmark。

- [ ] **2. 固定三个核心 Metrics**
  - [ ] **Task Success**：只有最终 `status === "success"` 才算成功；必须通过现有字段证据检查和 reopen verification，模型输出 `DONE` 本身不算完成。
  - [ ] **E2E Time**：记录从任务开始到最终 `success / blocked / failed` 返回的 wall-clock 时间；单次记录 `elapsedMs`，汇总主要看 median。
  - [ ] **Token Consumption**：累计完整任务中的模型 Token；至少分别记录 action decision 的 input/output/total tokens，以及 extraction/text-input 等公共阶段的 tokens；汇总同时给出 `decisionTotalTokens` 和端到端 `taskTotalModelTokens`。
  - [ ] Jev 与 DeepSeek 的 usage 字段做统一归一化；拿不到 Token 的 run 记为 `null`，不能按 0 处理。
  - [ ] `browserActions`、`actionDecisionCalls`、`actionDecisionDurationMs`、`reasonCode` 只作为诊断指标，用来解释成功率、时间或 Token 差异，不作为第四个核心指标。
  - [ ] 不生成 0–100 综合分；结果按照 Task Success、E2E Time、Token Consumption 分列展示。

- [ ] **3. 补齐欧洲商品页价格验证能力**
  - [ ] 扩展现有价格解析，支持 `EUR / €` 和 `GBP / £`，同时保持现有 USD、CNY 解析。
  - [ ] 支持德国常见数字格式，例如 `1.299,00 €`、`654,99 €`，避免按英语格式误解析。
  - [ ] 为 EUR、GBP、德国小数/千分位格式增加单元测试。
  - [ ] 只扩展价格格式识别，不降低现有页面证据要求；价格仍必须来自当前页面可验证 excerpt。

- [ ] **4. 固定 5 组 Live Benchmark Cases**
  - [ ] **B1 — DesignCabinet Germany / Herman Miller Aeron Remastered Value+**：固定 Größe C + Farbe Onyx，读取最终 EUR 商品价；测试德语页面、规格选择和配置状态，不加入购物车。
  - [ ] **B2 — Apple Locale Family / iPhone 17 Pro**：固定 iPhone 17 Pro、6.3-inch、256GB、Cosmic Orange，在 Apple Germany、France、UK 分别读取一次性购买价和币种；不得混入 Pro Max、其他容量或分期价。该逻辑 Case 实际包含多个 locale samples。
  - [ ] **B3 — Thomann Germany / Shure SM7B**：读取当前实际销售价格；不得返回 UVP/MSRP 或附件价格。该题作为最简单 sanity check。
  - [ ] **B4 — BIKE24 Germany / Garmin Edge 1050 Bundle**：读取 Bundle 当前一次性购买价；不得返回普通 Edge 1050、UVP 或 financing 月供。
  - [ ] **B5 — Samsung Germany / Galaxy S26**：固定 Galaxy S26、512GB、Black，读取一次性购买价；不得返回 S26+、256GB、Trade-In 后价格或月供。若 Samsung 长期受风控或页面结构不稳定，则换成同等多步骤配置难度的公开德国站点，并记录替换原因。
  - [ ] 每个 Case 固定 `startUrl`、`goal`、`model`、`specs`、`seller` 和禁止混淆项；优先选择无需登录、无需验证码、匿名可访问的公开商品页。

- [ ] **5. 建立可维护的 Case 配置**
  - [ ] 新增独立配置文件，例如 `benchmarks/browser-live.json`，runner 不写死具体站点任务。
  - [ ] Case 配置只描述任务和验证约束，不包含 Jev 或 DeepSeek 专属逻辑。
  - [ ] Apple locale family 允许一个逻辑 Case 映射到多个实际 URL/sample。
  - [ ] 页面下架、URL 失效或长期风控时允许更新 fixture，但要保留该 Case 原本覆盖的能力类型并记录原因。

- [ ] **6. 实现统一 Browser Benchmark Runner**
  - [ ] 新增独立入口，例如 `scripts/benchmark-browser-live.ts`，直接调用 `runShoppingTask()`。
  - [ ] Jev 与 DeepSeek 只通过 `choose` 参数切换 action selector；其他执行路径保持一致。
  - [ ] 每个 run 使用新的独立浏览器 session，不复用上一轮 continuation 或页面状态。
  - [ ] 两组使用相同 timeout、最大运行预算和浏览器模式。
  - [ ] Live benchmark 默认串行执行，不并发访问第三方站点，降低 rate limit 和机器负载对结果的干扰。
  - [ ] 同一 sample 的 Jev / DeepSeek 执行顺序交替，避免固定顺序造成时间和网络偏差。

- [ ] **7. 固定重复实验协议**
  - [ ] 每个实际页面 sample 默认执行 3 次；Apple locale family 的各国家页面分别计为独立 sample。
  - [ ] 每轮保存运行时间、最终 URL、status、reasonCode 和原始 metrics。
  - [ ] Live 页面价格允许随时间变化；成功判定基于本次页面证据，不要求命中仓库中写死的历史价格。
  - [ ] 不因为某一次站点临时不可达就修改评分规则；站点级网络/风控失败保留原始 reasonCode，便于后续识别 benchmark 环境问题。

- [ ] **8. 输出统一结果与汇总**
  - [ ] 每个 run 至少输出 `caseId`、`sampleId`、`selector`、`repeat`、`success`、`status`、`reasonCode`、`elapsedMs`、decision tokens、task total tokens 以及诊断指标。
  - [ ] 总表分别展示 Jev 和 DeepSeek 的 Success Rate、Median E2E Time、Median Decision Tokens、Median Task Total Tokens。
  - [ ] 按 Case 展开结果，能看出 direct read、price disambiguation、locale variation、configuration 和 multi-step configuration 哪类页面产生差距。
  - [ ] 保存机器可读 JSON 原始结果；终端只打印简洁 summary table，不生成复杂报告系统。

- [ ] **9. 给 Benchmark 自身增加回归测试**
  - [ ] 用本地 fixture/mock 页面验证两种 selector 都经过同一个 `runShoppingTask()`、extraction 和 verification 链路。
  - [ ] 验证 Token usage 能正确累计，并区分 decision tokens 与公共 extraction/text-input tokens。
  - [ ] 验证失败或 blocked run 仍输出完整 status、reasonCode、时间和可获得的 Token 信息。
  - [ ] Live 第三方站点 benchmark 不加入普通 `pnpm test` 的强制 CI，避免外部站点变化造成随机 CI 失败。

- [ ] **10. 完成第一版验收与文档收口**
  - [ ] 5 组 Case 都能从统一 runner 启动，并至少完成一轮 Jev vs DeepSeek V4 Flash live 对比。
  - [ ] 确认两组 Action Space、浏览器执行、extraction 和 reopen verification 完全一致。
  - [ ] README 只补充最小运行方式、三个核心 Metrics 和 Case 列表；不引入复杂评测理论。
  - [ ] 第一版结果能够作为后续修改 Jev context、Action Space、snapshot 截断和 no-progress 策略时的回归基线。
