# Jev 调用与状态

日期：2026-09-23。状态：调用方式说明，供实现上下文时对照。

本文说明一次 Jev 调用的输入和输出，以及上一轮信息为什么要由调用方放进 `state`。它不是 ShopSwarm 已确认的请求契约，也不是已实现或已验证的客户端。文中 Python 和 JSON 示例是概念形状。接入时以当时 SDK 为准，并把仓库 URL、提交哈希和检索日期写入兼容性记录。

来源：

- TypeSafe 博客 *Introducing System One Models & Jev*（2026-09-15）：<https://typesafe.ai/blog/introducing-system-one-models-and-jev>
- Jev 问题类型说明：<https://jev-agent.com/>
- 社区使用笔记（调用不继承 Agent 对话）：<https://github.com/wuyoscar/jev-skill>
- 本地副本，检索日期 2026-09-23：
  - `可参考项目/jev-ultrafast`，提交 `1231850a0bf1a0c0341fe408ef1668dbbfdfac46`，见 `jev_ultrafast/model.py`
  - `可参考项目/typesafe-playground`，提交 `84e99e00265e0467c90dd7ba462e4bf84edad73a`，见 `lib/api.ts`
  - 这两份哈希只表示当时的本地副本，不代表上游当前版本。

## 一次调用

Jev 的接口可以理解成：

> 输入：当前状态 `state` + 这次要做的判断 `questions`
> 输出：结构化决策 + 概率或置信度

TypeSafe 对 System One Model 的描述是：unstructured state in, typed probabilistic decisions out。它不是 `messages -> text` 的聊天模型。

做工具路由时，一次调用可以写成：

```python
state = """
用户当前请求：
帮我看看今天有没有重要邮件。

当前可用工具：
- gmail_search: 搜索邮件
- web_search: 搜索互联网
- calendar_search: 查询日历

最近的对话：
User: ...
Assistant: ...
User: 帮我看看今天有没有重要邮件
"""

questions = {
    "next_tool": Choice(
        instructions="选择下一步最合适的工具",
        criteria={
            "gmail_search": "需要查询用户邮件",
            "web_search": "需要查询公开互联网信息",
            "calendar_search": "需要查询日历",
        },
    )
}
```

返回的不是一句 “I think you should use Gmail...”，而是类似：

```json
{
  "next_tool": {
    "choice": "gmail_search",
    "probabilities": {
      "gmail_search": 0.98,
      "web_search": 0.01,
      "calendar_search": 0.01
    },
    "confidence": 0.97
  }
}
```

目前主要是三类问题：

- `choice`：从几个候选项里选一个。
- `score`：按调用方定义的等级打分。
- `noul`：判断一个命题成立的概率，也就是类似 `P(true)`。讨论里有时把这一类写成 Noul。

## `state` 放什么

凡是这次判断需要知道的信息，都要放进 `state`。通常包括：

- 当前用户输入
- 当前任务或目标
- 跟当前决策有关的历史对话
- Agent 当前执行状态
- 上一步 tool result
- 当前允许执行的 action 或 tool
- 业务规则和约束
- 判断所需的事实

`state = user_message` 只在这一句话已经包含全部判断依据时才够用。更准确的是：

```text
state = 做当前 decision 所需要的全部 observable context
```

官方对输入的对比是：现有 LLM 强调 sequential messages；System One 强调 structured program state。`state` 可以是一段文本，也可以是程序已经整理好的结构。

## 多轮：Jev 不会自动知道上一轮

Jev 没有跨调用的会话。和 Chat API 的差别在这里。

假设：

```text
Turn 1
User: 我要订北京的酒店

Turn 2
User: 最好离国贸近一点
```

第二次如果只传：

```python
state = "最好离国贸近一点"
```

Jev 并不知道上一轮说的是北京酒店。调用方要自己传：

```python
state = """
Goal: 预订酒店
City: 北京
User preferences:
- 靠近国贸

Latest user message:
最好离国贸近一点
"""
```

或者：

```python
state = """
Conversation:
User: 我要订北京的酒店
Assistant: 好的。
User: 最好离国贸近一点
"""
```

社区使用笔记也提醒：Jev 不继承 Agent 的 conversation，相关 history 要显式放进 `state`。本次未再打开该仓库核对原文；本地 `jev-ultrafast` 的做法与此一致，它把页面和最近动作放进当次 `state`，请求里没有消息列表。

因此：

```text
              ┌────────────────┐
User ────────>│                │
History ─────>│  State Builder │
Tool Result ─>│                │
Memory ──────>│                │
              └───────┬────────┘
                      │
                      ▼
             ┌─────────────────┐
             │      Jev        │
             │                 │
             │ state           │
             │ + questions     │
             └───────┬─────────┘
                     │
                     ▼
          choice / score / probability
```

Memory 和多轮状态属于调用方程序，不属于 Jev。

## 不要每轮塞进整段对话

每轮都执行 `state = entire_conversation` 会把与当前判断无关的内容一并送入。更稳妥的做法是先维护 Agent State，再按这次判断取出相关子集：

```python
agent_state = {
    "goal": "预订酒店",
    "city": "北京",
    "location_preference": "国贸附近",
    "budget": None,
    "current_step": "select_hotel",
    "latest_user_message": "...",
    "relevant_tool_results": [],
}
jev_state = relevant_subset(agent_state)
```

数据流是：

```text
Conversation
      ↓
State extraction / update
      ↓
Current Agent State
      ↓
Relevant state
      ↓
Jev
      ↓
Decision
```

Jev 不负责聊天，也不负责记忆。它更接近一个带概率的条件判断。官方把这类用法称为 smart if-statements：

```python
if semantic_condition(state):
    ...
```

## 一句话

Jev 没有跨调用的会话状态。每次调用都要提供当前 `state`。需要上一轮信息时，把上一轮原文或提炼后的状态放进 `state`。`questions` 定义基于这些状态要做的判断。输出是 `choice`、`score` 或概率。

## 和 ShopSwarm 的关系

ShopSwarm 里，高层自然语言购物任务和多轮对话属于 DSH。一次页面动作循环内部的目标、进度、当前页面和近期动作结果，由插件在调用 Jev 前组织成当次 `state`。Jev 只从当前有效集合里选择语义动作和目标。动作执行、完成检查、字段证据、领域归一化、可比性和排序都不由 Jev 承担。

这些分工见 [分支设计](分支-购物比价项目设计.md) 和 [架构与文件规划](项目架构与文件规划.md) 第 3 节。`loop/context.ts` 仍是规划中的文件，本文不表示它已经存在。

当前代码的 `ShoppingTaskContext` 是历史命名。无论任务是实体商品还是 Coding Plan，它都应表达当前子任务目标、硬约束、完成条件、已验证进度、verification gaps、页面快照和近期动作结果。后续完成条件改为 required / desired 字段后，Jev 看到的是字段进度，而不是某个领域的固定 schema。页面文本始终是观察数据，不能改写任务规则。Jev 返回 `DONE` 之后仍由 Verifier 决定是否真正完成。

## 本地副本里的请求形状

上面的 `Choice(...)` 和按问题名直接嵌套的 JSON 用来说明输入输出，不是下面两份副本里的 HTTP 体。

`typesafe-playground` 的 `lib/api.ts` 把请求校验为：

- `model`：字符串，缺省时该校验函数使用 `jev-latest`。
- `state`：非空字符串、对象或数组。
- `questions`：1 到 100 个具名问题。每个问题有 `type` 和字符串 `instructions`。
- `type` 只能是 `choice`、`score`、`noul`。
- `choice` 的 `criteria` 至少两个具名候选项，值是字符串。
- `score` 的 `criteria` 是至少两个等级的字符串列表。
- 该校验函数不要求 `noul` 提供 `criteria`。

`jev-ultrafast` 的 `jev_ultrafast/model.py` 向 `https://api.typesafe.ai/v1/systemone` 发送的体是：

```json
{
  "model": "jev-latest",
  "state": {
    "page": {},
    "elements": [],
    "recent_actions": []
  },
  "questions": {
    "operation": {
      "type": "choice",
      "criteria": {},
      "instructions": {}
    }
  }
}
```

它从响应的 `answers.<问题名>` 读取 `choice`、`probabilities` 和 `confidence`。这里的 `instructions` 是对象。playground 的校验函数则要求 `instructions` 为非空字符串。两份副本不一致，接入前要按实际 SDK 确定，不能把其中一种当成已确认契约。

`model.py` 还把 `goal` 放在问题的 `instructions` 里，把最近最多 10 条动作放在 `state.recent_actions`。这同样说明目标、页面和近期结果都由调用方在当次请求中给出。


## 领域无关的职责边界

当前产品范围是通用自然语言购物研究。Jev 的职责始终保持窄：

```text
Task + field progress + snapshot + recent actions + valid actions
    -> Jev chooses next navigation action
```

Jev 不判断哪个商品或套餐“最值”，不做金额算术、无依据的单位换算或最终排序。Coding Plan 中 request/credit/token、首购/续费和年付月均只是复杂领域例子；实体商品同样可能存在容量、包装数量、会员价、运费等不可直接合并的语义。具体领域规则由后续确定性模块处理。

当前产品范围见 [通用购物任务决策](../decision/产品范围-通用购物任务.md)，多领域测试策略见 [真实购物任务与测试策略](真实购物任务与测试策略.md)。Coding Plan 的详细规则继续见 [Coding Plan 比价规则](Coding%20Plan%20比价规则.md)。
