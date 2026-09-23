---
name: shopping-research
description: 使用 ShopSwarm 将自然语言购物意图拆成多个公开来源的研究任务，核对价格、属性、条件和证据。
---

# ShopSwarm 自然语言购物研究

ShopSwarm 面向通用购物与价格研究。用户可以直接说想买什么、有哪些硬约束、在意哪些信息。Coding Plan、LLM API 套餐和第三方中转套餐只是测试域之一，不要把任务限定为 Coding Agent 或数字套餐。

当前 `shopswarm_research` 仍是 M2 的**单来源兼容接口**，输入为 `model + specs + seller`。它适合在已经确定候选对象和候选页面后做证据化核对，还不是完整的顶层自然语言购物契约。

## 从自然语言任务开始

Lead Agent 先从用户请求中区分：

- 购买目标：商品、服务或套餐类别；
- 硬约束：不满足就不能作为候选；
- 偏好：用于展示或后续比较，但缺失时可以保持 unknown；
- 需要核对的字段：价格、规格、容量、卖家/提供方、价格条件、保修、额度等；
- 来源范围：用户明确指定的平台，或为该任务选择的多个公开来源。

不要因为现有工具参数叫 `model` 就把所有任务解释成“模型套餐”。实体商品、日用品和数字服务都属于同一产品范围。

如果用户只描述类别、还没有具体候选型号或页面，Lead Agent 先使用宿主现有的搜索/浏览能力发现候选，再把每个候选页面交给 `shopswarm_research` 做当前 M2 能力范围内的核对。这个两段式流程是当前兼容方案；M4 会进一步把发现任务和报价契约通用化。

## 调用当前单来源工具

对一个已经确定的候选页面：

- `startUrl`：该来源的候选页面；
- `goal`：从原始自然语言任务派生出的单来源核对目标；
- `model`：当前 M2 verifier 要求的精确目标标签。对实体商品可放明确商品/型号名，对数字服务可放模型或套餐标识；
- `seller`：页面必须匹配的卖家或提供方；未指定时传空字符串；
- `specs`：当前接口能够明确表达并在页面验证的属性/条件。没有已知属性时传 `"[]"`，不能填 null 或猜测值。

不要把计划中的通用 `ResearchTask`、`requiredFields` / `desiredFields` 或领域扩展字段伪装成已经实现的工具参数。

## 多来源任务分发

当用户要求比较多个来源，Lead Agent 保留一份共同任务条件，然后为每个来源启动独立 Subagent。各子任务收到相同的购买目标、硬约束和待核对字段，只额外携带自己的来源 URL 与卖家/提供方。

使用 DSH 已有的 `subagent` 工具（`spawn` 后端）分发，不在 ShopSwarm 中另建 Agent 调度器。一次性 `headless` 子任务显式设置 `run_in_background: false`，让 Lead 在进程退出前取得结果；交互式会话按 DSH 的后台模式处理完成通知。

每个 Subagent 只核对自己负责的来源，并原样返回 `status`、`reasonCode`、`offer` / `candidate`、`missing`、`metrics`、来源和原始任务条件。一个来源的数据不能补齐另一个来源的 unknown。

ShopSwarm 的 `maxConcurrentBrowserTasks` 限制单个 DSH 进程中同时运行的浏览器工具调用，默认值为 2。超过上限的调用等待槽位；等待期间收到取消信号就退出。

## 结果规则

Jev 只负责在当前页面的有效动作集合中选择下一步动作。Jev 的 `DONE` 只是申请结束；工具会抽取页面字段、检查原文证据，并在新隔离会话中重开 URL 复核。未经复核的 `candidate` 不是已确认结果。

处理结果时遵守：

- 只有 `status=success` 的 `offer` 能作为当前 M2 接口下的已复核页面报价。
- 页面没有证据的字段保持 unknown，不能从常识或其他来源补齐。
- 不同对象、变体、价格条件、币种或单位不能为了得到唯一最低价而强行混排。
- Coding Plan 的按量/套餐、首购/续费、Token/request/credit 等规则见 `DOC/Coding Plan 比价规则.md`；它们是领域扩展，不是所有购物任务的固定字段。
- 多来源最终比较等待 M4 的通用数据契约与确定性 comparability；当前不要让 Agent 自行计算跨来源“最划算”结论。
- `login_required`、`captcha`、`site_rate_limited`、`no_progress` 和 `verification_failed` 都是有效结果。默认 E2E 应换用公开、低摩擦来源，不破解验证码或绕过风控。
- Jev 使用的兔子 API 是动作选择通道，不是购物来源。

当前产品范围见 `decision/产品范围-通用购物任务.md`，测试矩阵见 `DOC/真实购物任务与测试策略.md`。原有 `shopswarm_browse` 保留为手动浏览工具；它用于明确步骤的打开、快照、点击、填写、按键和等待，不把手动浏览结果直接写成已完成比价。
