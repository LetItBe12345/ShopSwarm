# Jev → DSH Agent Fallback 接管修复规划

日期：2026-09-23  
状态：Fix 规划；本文件只定义修复范围、控制流、接口约束和验收标准，不包含实现。  
问题来源：M2.2 已确认设计与当前实现不一致。该问题属于行为回归/实现缺失，不作为新 Feature 处理。

## 1. 问题定义

ShopSwarm 的目标架构中，Jev 是站点研究 Agent 内部的快速动作决策器，而不是整个站点任务的唯一控制器。

正确关系应为：

```text
DSH Lead Agent
  ├─ Source Subagent A
  │    ├─ Jev fast path
  │    ├─ DSH Agent fallback
  │    └─ Verifier
  ├─ Source Subagent B
  │    ├─ Jev fast path
  │    ├─ DSH Agent fallback
  │    └─ Verifier
  └─ 汇总各来源结果
```

当前实现缺失了 `Jev -> 当前 Source Subagent 接管 -> 继续同一站点任务` 这一段。

因此当前行为实际为：

```text
Source Subagent
  -> shopswarm_research
  -> Jev
  -> BLOCKED / no_progress / jev_error / 部分 verification failure
  -> 返回 blocked/failed
  -> 关闭 action browser
  -> Source Subagent 将该结果作为终态返回
```

这会导致 Jev 从“低成本 fast path”退化成“失败即终止站点任务的唯一控制器”。

## 2. 为什么这是 Fix，不是 Feature

M2.2 的已确认决策已经明确：

- 第一次伪 `DONE` 被 Verifier 否决后，将缺失项带回动作循环。
- 页面与进度均无变化，再次出现相同伪 `DONE` 时，应交给 DSH Agent 判断。
- Jev 无进展或页面判断含糊时，站点 DSH Agent 负责下一步判断。
- Agent 接管不能绕过独立完成检查。

当前 `src/shopping/run.ts` 只完成了“返回结构化 blocker”这一半，没有完成“DSH Agent 接管并继续”的后一半。

PR #13（M2.2）的实现把 `BLOCKED`、重复伪 `DONE`、登录、验证码、超时等转换为结构化结果，但并未建立 Agent takeover 状态机，也没有建立可继续使用的浏览器现场。

因此本次工作定义为：恢复已经确认但未完整实现的控制流。

## 3. 修复目标

本次修复完成后，需要满足以下语义：

```text
Jev 能处理
  -> Jev 继续选动作

Jev 不能处理，但页面仍可由 Agent 推理和操作
  -> 当前 Source Subagent 接管
  -> 使用同一研究任务、同一浏览器现场继续操作
  -> Agent 处理复杂节点后可重新交回 Jev
  -> 最终仍由同一个 Verifier 判断完成

站点存在外部阻塞
  -> 结束当前来源任务
  -> 返回结构化 blocker
```

核心原则：

> Jev 的 `BLOCKED` 不等于整个 research task 的 `blocked`。

应区分“Jev 自己无法继续”和“站点客观无法继续”。

## 4. 不做什么

本次 Fix 不包含以下内容：

- 不增加新的来源发现能力。
- 不新增 Coding Plan 数据模型。
- 不实现视觉模型 fallback。
- 不实现验证码破解。
- 不绕过登录、限流或站点风控。
- 不修改 DSH 核心。
- 不在 ShopSwarm 内再 spawn 一层 Subagent。
- 不把 fallback 实现成插件内部偷偷调用另一个通用聊天模型。
- 不允许 Agent fallback 绕过 Verifier。
- 不把 `shopswarm_browse` 重新开一个页面当成“同现场接管”。

## 5. Agent fallback 的归属

Fallback 的执行者必须是当前负责该来源的 Source Subagent。

错误结构：

```text
Source Subagent
  -> Jev failed
  -> spawn another Subagent
  -> new Subagent 接管
```

正确结构：

```text
Source Subagent
  -> Jev fast path
  -> Jev needs escalation
  -> 同一个 Source Subagent 使用 Agent reasoning 接管
```

原因：

1. 当前 Source Subagent 已经拥有该来源任务的完整目标和上下文。
2. 再 spawn 一层会增加调度层级和上下文复制。
3. 浏览器资源、取消信号、来源归属和证据归属更难维护。
4. Fallback 本质是同一个 Agent 内的控制策略切换，不是任务重新分发。

## 6. 状态模型

当前 `ShoppingStatus`：

```text
success
blocked
failed
cancelled
```

无法表达“Jev 失败，但任务仍应继续”。

规划引入一个显式的可恢复状态：

```text
running_jev
needs_agent
running_agent
externally_blocked
completed
failed
cancelled
```

对外结果至少需要能明确区分：

- `success`：来源任务完成并通过 Verifier。
- `needs_agent`：Jev fast path 停止，但当前 Source Subagent 应接管。
- `blocked`：站点存在 Agent 无法靠继续推理解决的外部阻塞。
- `failed`：基础设施或不可恢复执行错误。
- `cancelled`：父任务取消。

是否保留当前 `blocked` 字符串作为外部兼容名称，可以在实现时决定；语义上必须与 `needs_agent` 分离。

## 7. 状态转换

目标状态机：

```text
                         +------------------+
                         |   start source   |
                         +---------+--------+
                                   |
                                   v
                         +------------------+
                         |   running_jev    |
                         +---------+--------+
                                   |
              +--------------------+--------------------+
              |                    |                    |
              v                    v                    v
        normal action        needs escalation      external block
              |                    |                    |
              |                    v                    v
              |           +------------------+     +-----------+
              |           |  running_agent   |     |  blocked  |
              |           +---------+--------+     +-----------+
              |                     |
              |          +----------+----------+
              |          |                     |
              |          v                     v
              |      agent action          resume Jev
              |          |                     |
              +----------+---------------------+
                                   |
                                   v
                              DONE candidate
                                   |
                                   v
                              +----------+
                              | Verifier |
                              +----+-----+
                                   |
                   +---------------+---------------+
                   |                               |
                   v                               v
               verified                       gap/reject
                   |                               |
                   v                               |
               success                  Jev or Agent continues
```

## 8. 哪些情况必须触发 Agent fallback

以下情况默认转为 `needs_agent`，而不是直接结束来源任务。

### 8.1 Jev 主动返回 BLOCKED

当前行为：

```text
Jev BLOCKED -> blocked/no_progress -> return
```

修复后：

```text
Jev BLOCKED -> needs_agent
```

因为 Jev 的 `BLOCKED` 只能说明：

> 在当前 Jev 可见的 action space 中，它找不到合适动作。

不能推出：

> 通用 Agent 也无法处理当前页面。

### 8.2 重复无进展

例如：

- 同一个动作在同一页面重复两次且无可观察变化。
- 同一页面、同一 missing，再次 false `DONE`。
- Jev 在有限 action space 内形成局部循环。

当前这些情况直接返回 `no_progress`。

修复后应先升级给 Agent。

### 8.3 Jev API 或响应层错误

包括：

- Jev HTTP 错误。
- Jev 超时。
- 无效 response。
- operation 不在允许集合。
- target 不在当前 action space。
- 其他无法形成有效 `SelectedAction` 的 Jev 错误。

前提：浏览器本身仍然健康，当前页面仍可观测。

这类错误不应直接终止站点任务，因为失败的是 fast path 决策器，不是浏览器和任务本身。

### 8.4 Jev action space 表达能力不足

例如页面需要：

- Jev 当前未暴露的按键或交互。
- 复杂的分步导航。
- 需要结合页面上下文做更长推理的操作。
- 需要 Agent 先理解页面结构，再决定若干动作。

这类情况由 Agent 接管。

### 8.5 Verifier 持续拒绝 DONE

第一次 false `DONE` 仍按当前设计将 `missing` 写回 Jev。

如果同样缺项再次出现，或 Jev 无法根据 verification gap 推进，则升级给 Agent。

Agent 仍不能直接宣布完成；最终必须再次经过 Verifier。

### 8.6 文本输入无法由当前快速路径确定

当 `TYPE_TEXT` 所需值没有明确任务输入，文本辅助模型也无法给出可靠结果，而 Agent 可以根据已有任务上下文确定下一步时，应允许升级。

如果输入本身必须由用户提供，则归类为外部阻塞或用户输入需求，不允许 Agent 猜测。

## 9. 哪些情况不触发 Agent fallback

以下情况默认属于 `externally_blocked` 或不可恢复失败。

### 9.1 Captcha / 人机验证

返回结构化 `captcha`。

Agent fallback 不用于自动绕过验证码。

### 9.2 明确登录墙

返回 `login_required`。

保持现有语义：提示用户在自己的 Chrome Profile 中完成登录，然后重新开始该来源任务。

首版不要求跨用户等待期间长期保留浏览器进程。

### 9.3 明确站点限流

返回 `site_rate_limited`。

不把“换 Agent”当成突破限流的方法。

### 9.4 浏览器实例已经不可用

例如：

- 浏览器进程退出。
- session 不存在。
- 无法恢复的 transport 错误。
- session 清理状态不可信。

这类不能声称 same-session takeover。

实现可以选择重建任务，但必须明确标记为 restart，而不是 takeover。

## 10. 同一浏览器现场是硬要求

真正的 Agent fallback 必须满足：

```text
Jev 停止决策
  -> 浏览器不关闭
  -> 当前页面不重置
  -> Agent 获得该页面的 handoff context
  -> Agent 动作仍作用于同一个 research session
```

以下方案不接受：

```text
Jev blocked
  -> runShoppingTask return
  -> close browser
  -> Agent 再调用 shopswarm_browse
  -> 从 URL 重新打开
```

这只是 retry，不是 takeover。

原因：

- 已经完成的导航状态会丢失。
- 页面内临时状态会丢失。
- 动态内容可能变化。
- 之前的选择、滚动位置、弹窗状态可能变化。
- Agent 无法针对 Jev 实际卡住的现场推理。

## 11. Research Session Lease

为了支持跨工具调用的 same-session takeover，需要把当前“浏览器生命周期 = 单次 `shopswarm_research` 调用生命周期”的模型改为“浏览器生命周期 = research session 生命周期”。

规划引入 Research Session Lease。

一个 lease 至少包含：

```text
handoffId
ownerAgentId
source/task identity
browser session
current page revision
goal
constraints
progress
missing
recent actions
createdAt
lastTouchedAt
expiry
cancellation state
resource lease
```

### 11.1 归属

- handoff 只能由创建它的 Source Subagent 使用。
- 不能由另一个来源的 Subagent 接管。
- 不允许 Lead Agent 误操作 Source Subagent 的页面。
- 所有 Agent action 都校验 owner identity。

### 11.2 生命周期

`needs_agent` 返回时：

- 不关闭 action browser。
- 将浏览器纳入 live research session。
- 返回 `handoffId`。
- ResourceLimit 的资源占用不能被错误释放。

最终以下任一事件发生时释放：

- success。
- externally blocked。
- unrecoverable failed。
- cancelled。
- Agent 显式放弃。
- lease TTL 到期。
- Host Plugin 卸载/进程退出清理。

### 11.3 TTL

必须设置有限 TTL，防止 Subagent 收到 `needs_agent` 后不继续调用导致浏览器永久占用。

TTL 是资源清理策略，不是业务失败次数预算。

TTL 到期后：

- session 关闭。
- handoffId 失效。
- 后续调用返回明确的 expired reason。
- 不静默创建新 session 冒充原现场。

## 12. ResourceLimit 的修复要求

当前 `ResourceLimit` 约束单个工具调用。

引入 fallback 后，一个来源任务可能跨多个 DSH tool call：

```text
shopswarm_research
  -> needs_agent

shopswarm_agent_action
  -> agent action

shopswarm_agent_action
  -> another action

shopswarm_resume
  -> Jev continues
```

因此资源占用必须跟随 research session，而不是第一次 tool call 返回就释放。

否则会出现：

- 浏览器仍活着，但并发槽位已经释放。
- 新任务继续启动。
- 实际浏览器数突破限制。

实现时需要把当前一次性 release 语义改成可转移/可持有的 lease 语义。

## 13. Handoff Context

返回 `needs_agent` 时，应给 Source Subagent 足够的信息判断下一步，但不直接暴露不可控的浏览器内部状态。

至少包含：

```text
handoffId
reasonCode
reason
goal
constraints
pageUrl
pageRevision
pageSnapshot
current elements / refs
verified progress
verification gaps
recent actions
last Jev result/error
allowed agent operations
```

要求：

- 页面快照仍被视为不可信观察数据。
- task goal 和 constraints 不能由页面文字覆盖。
- Cookie、密钥等不进入 handoff context。
- elements 必须属于当前 page revision。
- handoff context 中明确说明“Agent 需要继续任务，而不是总结失败”。

## 14. Agent 接管动作接口

本次规划不固定最终工具名，但接口职责需要分开。

推荐逻辑上提供：

### 14.1 初始研究

```text
shopswarm_research
```

职责：

- 创建 research session。
- 默认进入 Jev fast path。
- 成功则直接返回。
- 遇到可升级问题返回 `needs_agent + handoffId`。
- 外部阻塞则结束并清理。

### 14.2 Agent action

逻辑名：

```text
shopswarm_agent_action
```

职责：

- 输入 `handoffId`。
- 在同一 browser session 上执行 Agent 决定的动作。
- 动作执行前重新检查 session、page revision 和目标。
- 返回新的 snapshot、elements、progress hints。
- 不允许 Agent 直接写入 verified progress。
- Agent 可以连续执行多个动作。

允许动作优先复用 ShopSwarm 自己的语义动作：

- CLICK
- TYPE_TEXT
- SELECT
- PRESS
- SCROLL
- BACK
- 必要的 WAIT 条件

不要把任意 shell 或任意 JavaScript 作为 fallback 的默认能力。

### 14.3 恢复 Jev

逻辑名：

```text
shopswarm_resume
```

职责：

- 使用 `handoffId` 重新进入 Jev loop。
- 使用 Agent 操作后的当前页面。
- 保留 recent actions。
- 重新构建 Jev state。
- 继续直到 success、再次 `needs_agent`、external block、failed 或 cancelled。

是否最终合并 `agent_action` 和 `resume` 为一个 session tool，可在实现时决定；语义必须保持清晰。

## 15. Agent 与 Jev 的切换策略

首版采用显式切换，不做复杂自动评分。

### Jev -> Agent

由确定性条件触发：

- `BLOCKED`
- repeated no-progress
- repeated false DONE
- Jev request/response error 且浏览器健康
- action-space mismatch

### Agent -> Jev

由 Source Subagent 主动选择恢复。

原因：

Agent 最清楚它是否已经：

- 关闭了弹窗。
- 进入了正确子页面。
- 展开了价格表。
- 找到了 Jev 可继续使用的标准元素。

不要求 Agent 一接管就负责完成整个页面。

## 16. Verifier 的唯一性

Fallback 不能形成第二套完成标准。

无论动作来自：

```text
Jev
DSH Agent fallback
```

最终都必须走同一个：

```text
Extractor
  -> Verifier
  -> independent replay verification
```

Agent 只能改变页面状态。

Agent 不能：

- 自己构造 `Offer` 并绕过 Extractor。
- 自己把 missing 标成 progress。
- 自己宣布价格证据成立。
- 自己跳过独立重开检查。

这样可以保持：

> 更强的 Agent 只负责“如何走页面”，确定性/独立验证层负责“结果能否相信”。

## 17. stale element 与页面版本

Agent 接管时不能放松 M2.1 已有的目标安全约束。

所有基于元素的动作仍要求：

- handoff 属于当前 agent。
- browser session 一致。
- page revision 一致。
- target ref 来自当前 snapshot。
- 执行动作前重新 snapshot。
- target role/name/ref 仍一致。

如果页面在 Agent 思考期间变化：

- 拒绝旧 target。
- 返回新 snapshot。
- 让 Agent重新判断。
- 不尝试“尽量点一下”旧引用。

## 18. 取消传播

父任务取消必须贯穿：

```text
Lead
 -> Source Subagent
 -> research session
 -> Jev request
 -> Agent action
 -> browser command
```

取消发生后：

- live session 立即标记 cancelled。
- 中止当前请求/浏览器命令。
- 关闭浏览器。
- 释放 ResourceLimit lease。
- handoffId 永久失效。

不能因为 research 已经从第一次 tool call 返回 `needs_agent`，就失去父级取消传播。

## 19. 多来源并行中的行为

一个来源进入 Agent fallback，不应影响其他来源。

例：

```text
Source A -> Jev -> success
Source B -> Jev -> needs_agent -> Agent takeover
Source C -> captcha -> blocked
```

Lead 应等待各 Source Subagent 最终结束，再汇总：

```text
A success
B success / blocked / failed
C blocked/captcha
```

`needs_agent` 是来源内部的中间态，不应直接进入最终比较报告。

M3 的局部失败原则保持不变：

- 一个来源失败不取消其他来源。
- 每个来源保留自己的 unknown 和失败原因。
- 不跨来源补字段。

## 20. Skill 必须同步修复

当前 `skills/shopping-research/SKILL.md` 把：

- `no_progress`
- `verification_failed`
- 其他 blocker

描述为可直接返回的有效结果。

修复后 Skill 需要明确：

```text
status=needs_agent
  -> 当前 Source Subagent 必须继续处理
  -> 不得把它作为最终来源结果返回给 Lead
```

Source Subagent 的推荐控制逻辑：

```text
call shopswarm_research

if success:
    return final source result

if needs_agent:
    inspect handoff context
    perform one or more agent actions
    resume Jev
    repeat until terminal

if externally blocked:
    return structured blocker

if failed:
    return structured failure
```

## 21. 需要检查/修改的模块

实现阶段至少需要检查以下模块。

### `src/shopping/run.ts`

职责变化：

- 将 Jev-scope failure 与 task-scope failure 分开。
- 可升级情况返回 `needs_agent`。
- `needs_agent` 时不清理 action browser。
- run loop 能从已有 research session 恢复。

### `src/index.ts`

职责变化：

- 暴露 Agent takeover/resume 工具。
- 在 DSH tool boundary 校验 Agent identity。
- 输出 handoff 信息。
- 不让模型伪造 owner/call/session identity。

### 浏览器/session 管理层

需要：

- live research session registry。
- handoffId。
- TTL。
- owner binding。
- cleanup。
- cancellation。
- resource lease。

不建议把这些状态散落在 `src/index.ts`。

### `src/jev.ts`

主要保持动作选择职责。

需要明确区分：

- Jev decision error。
- stale target。
- browser execution error。

不要在 Jev 层实现 Agent fallback 本身。

### `skills/shopping-research/SKILL.md`

必须把 `needs_agent` 定义成中间态。

### `src/research/parallel.ts`

检查是否有逻辑把 `needs_agent` 当作最终 success/failed。

它只应接收 Source Subagent 最终结果，不承担 Agent takeover。

## 22. 错误分类表

| 情况 | 当前行为 | 修复后默认行为 |
|---|---|---|
| Jev `BLOCKED` | `blocked/no_progress` | `needs_agent` |
| 同一动作重复无变化 | `blocked/no_progress` | `needs_agent` |
| 同页同 missing 重复 false DONE | `blocked/no_progress` | `needs_agent` |
| Jev HTTP/timeout | `failed/jev_error` | 浏览器健康时 `needs_agent` |
| Jev invalid choice/target | `failed/jev_error` | `needs_agent` |
| 文本辅助无法确定 | `blocked/text_error` | Agent 可判断时 `needs_agent` |
| captcha | `blocked/captcha` | 保持 terminal blocked |
| login_required | `blocked/login_required` | 保持 terminal blocked |
| site_rate_limited | `blocked/site_rate_limited` | 保持 terminal blocked |
| browser timeout | `failed/browser_timeout` | 按 session 健康度分类；不能假装 same-session |
| browser crashed | `failed/browser_error` | terminal failed 或明确 restart |
| replay verification mismatch | `blocked/verification_failed` | 默认先交 Agent 判断是否还有可操作路径；最终仍必须重放验证 |
| cancelled | `cancelled` | 保持 cancelled |

`verification_failed` 需要实现阶段再细分：

- 如果是因为页面仍可操作、状态可纠正，应升级 Agent。
- 如果独立 replay 已证明当前报价无法复现，且不存在继续操作的现场，则可以作为终态。

## 23. 测试规划

本 Fix 不以“新增一个状态字段”为完成标准。

必须证明真实控制权发生了切换。

### 23.1 单元测试

覆盖：

1. Jev `BLOCKED` 返回 `needs_agent`。
2. 返回 `needs_agent` 后 browser 没有 close。
3. handoffId 绑定原 Agent。
4. 其他 Agent 使用 handoffId 被拒绝。
5. TTL 到期后 browser 被关闭。
6. cancel 后 handoffId 失效。
7. stale page revision 的 Agent action 被拒绝。
8. Agent action 后 snapshot revision 更新。
9. resume 后 Jev 使用新页面。
10. 最终 success 时 session 被关闭且资源释放。
11. external blocker 不创建长期 handoff。
12. Jev error 时浏览器健康则升级，而不是直接 failed。

### 23.2 集成测试

构造本地页面：

```text
初始页面
  -> Jev action space 无法完成
  -> Jev BLOCKED
  -> Source Agent 手动点击/按键
  -> 页面进入标准状态
  -> resume Jev
  -> Jev DONE
  -> Verifier success
```

需要断言：

- 从头到尾 browser session identity 相同。
- takeover 前的页面状态没有丢失。
- Agent action 确实作用在原 session。
- resume 后 Jev 能看到 Agent 修改后的页面。
- Verifier 使用同一规则。
- 最后 browser clean。

### 23.3 回归测试

原有以下行为不能被破坏：

- false DONE 回传 missing。
- 独立 replay verification。
- login_required。
- captcha。
- site_rate_limited。
- cancellation。
- resource limit。
- 多来源局部失败。
- stale target 防护。

### 23.4 DSH 端到端验收

必须使用真实 DSH Source Subagent，而不是仅在 TypeScript 中直接调用函数。

验收场景至少包含：

```text
Lead
 -> spawn Source Subagent
 -> Source Subagent call shopswarm_research
 -> result needs_agent
 -> 同一个 Source Subagent 调 takeover tool
 -> 同一个 Source Subagent resume
 -> final source result
 -> Lead 收到最终结果
```

验收记录要证明：

- 没有 spawn 第二层 fallback Subagent。
- `needs_agent` 没有被提前汇总。
- browser session 没有在 handoff 时关闭。
- 最终 session 正常清理。

## 24. 可观测性

为了定位 fallback 是否有效，需要记录以下指标：

```text
jevDecisionCalls
jevEscalations
agentFallbackActions
jevResumes
handoffDurationMs
handoffReason
finalController
sessionLifetimeMs
cleanupReason
```

多来源报告至少可以统计：

- 多少来源纯 Jev 完成。
- 多少来源发生 Agent fallback 后完成。
- 多少来源 fallback 后仍 blocked/failed。

这些指标用于判断 Jev fast path 的覆盖率，不用于让 Agent 自行决定报价优劣。

## 25. 兼容性

当前 `shoppingResultSchema.status` 只是字符串，没有 JSON Schema enum，因此协议层加入 `needs_agent` 不会被 schema enum 直接拒绝。

但 TypeScript 类型、测试、Skill 和所有消费 `status` 的代码都必须逐个检查。

不能因为 JSON Schema 宽松就假设下游已经兼容新状态。

## 26. 实现顺序

建议按以下顺序实现，避免先改 prompt 后补生命周期：

1. 定义 terminal / recoverable error 分类。
2. 定义 research session 与 handoff 数据结构。
3. 把浏览器和 ResourceLimit 生命周期从单 tool call 提升到 research session。
4. 让 `runShoppingTask` 支持返回 `needs_agent` 且保留 session。
5. 增加 Agent action 接口。
6. 增加 resume 接口。
7. 更新 Skill 控制流。
8. 增加 same-session takeover 单元与集成测试。
9. 跑现有 M2/M3 回归。
10. 用 DSH 真正跑一次 Source Subagent takeover 验收。

不要反过来先改 Skill。否则 Agent 虽然知道要接管，但 browser 已经被当前代码关闭。

## 27. 完成标准

本 Fix 只有同时满足以下条件才算完成：

- Jev `BLOCKED` 不再等价于来源任务终止。
- 至少一种可恢复失败能触发 `needs_agent`。
- 当前 Source Subagent 能收到完整 handoff context。
- Source Subagent 能在同一 browser session 执行动作。
- Agent 动作后能重新交回 Jev。
- 最终结果仍必须通过现有 Verifier。
- captcha/login/rate-limit 仍保持外部 blocker。
- 取消可以清理 live handoff session。
- TTL 可以清理被遗弃的 session。
- ResourceLimit 不因跨工具调用失真。
- 多来源情况下，一个来源 fallback 不影响其他来源。
- DSH 端到端测试证明没有额外 spawn fallback Subagent。
- 所有新增 session 都能在 terminal state 后被关闭。
- 现有 M2/M3 回归测试全部通过。

## 28. 最终目标

修复完成后，ShopSwarm 的控制关系应恢复为：

```text
DSH Source Subagent
        |
        +---- Jev fast path --------+
        |                           |
        |                    simple browser actions
        |                           |
        +---- Agent fallback <------+
        |
        v
     Verifier
        |
        v
   structured result
```

Jev 的定位是：

> 能快速解决大多数页面动作时减少通用 Agent 的推理开销。

DSH Agent 的定位是：

> 当 Jev 的有限动作判断不足时，接管同一现场继续完成来源任务。

两者不是互相替代关系，也不应把 Jev 的局部失败直接升级成整个来源任务失败。
