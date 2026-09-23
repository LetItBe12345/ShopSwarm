# Coding Plan 比价规则

日期：2026-09-23。状态：产品与数据契约草案；作为 M2.4—M5 的设计基线。当前代码仍保留 M1/M2 的购物命名，本文中的新结构不代表已经实现。

## 1. 首版领域

ShopSwarm 的首个真实领域是 Coding Plan、LLM API 套餐和第三方中转套餐比价。首批来源优先使用公开价格页、套餐页或公开接口。底层浏览、Jev 决策、证据验证和并行框架保持通用，后续仍可扩展到其他价格研究任务。

首版只读取和比较信息，不购买、不充值、不支付，也不以破解验证码或绕过站点风控作为验收条件。

## 2. 需要区分的对象

Coding Plan 不能只用“模型 + 一个价格”表示。至少要区分：

- `provider`：官方提供方或第三方中转提供方。
- `plan`：套餐名称或按量计费入口。
- `models`：套餐明确支持的模型或模型族。
- `billingMode`：按量、包月、包年、积分或其他明确口径。
- `billingPeriod`：月、年、固定窗口或无周期。
- `priceType`：常规价、促销价、首购价、续费价等。
- `eligibility`：适用条件；没有证据时保持未知。
- `observedAt`：本次实际核对时间。
- `source`：页面 URL、接口标识或其他可复核来源。

不同模型版本、不同套餐档位、不同计费方式或不同价格语义不能合并成同一条报价。

## 3. 计划中的 PlanOffer 形状

M4 可以在不破坏现有 M1/M2 类型的前提下新增领域模型。建议形状：

```ts
interface PlanOffer {
  provider: {
    name: string
    kind: 'official' | 'relay'
  }

  plan: {
    name: string
    billingMode: string
    billingPeriod: KnownOrUnknown<string>
  }

  price: {
    currency: string
    amountMinor: KnownOrUnknown<number>
    priceType: 'list' | 'promotion' | 'first_purchase' | 'renewal' | 'other'
    eligibility: KnownOrUnknown<string>
  }

  supportedModels: KnownOrUnknown<readonly string[]>

  quotas: readonly {
    metric: 'token' | 'request' | 'credit' | 'other'
    amount: KnownOrUnknown<number>
    window: KnownOrUnknown<string>
    resetRule: KnownOrUnknown<string>
  }[]

  usageRules: {
    modelMultiplier: KnownOrUnknown<Record<string, number>>
    offPeakMultiplier: KnownOrUnknown<number>
    cachePricing: KnownOrUnknown<string>
  }

  compatibility: readonly string[]
  restrictions: readonly string[]
  observedAt: string
  evidence: readonly Evidence[]
}
```

具体字段在 M4 实现时可以收缩，但不能把缺失字段用 0、免费、无限或默认倍率补齐。

## 4. 必需字段与期望字段

任务应显式区分：

```ts
requiredFields: string[]
desiredFields: string[]
```

- `requiredFields`：完成任务必须有可复核证据的字段。
- `desiredFields`：希望取得，但来源未公开时允许返回 unknown。

Jev 返回 `DONE` 只表示申请结束。Verifier 只有在所有必需字段通过后才能返回成功。期望字段缺失不能导致无限滚动、重复点击或把未知值推断成确定值。

例如比较某个 Coding Plan 时，必需字段可以是提供方、套餐名、模型支持范围、价格和计费周期；周额度、缓存价、峰谷倍率可以按任务设为必需或期望，而不是全局硬编码。

## 5. 价格语义

价格至少区分以下情况：

- 常规标价；
- 限时促销价；
- 首购或新用户价；
- 续费价；
- 年付总价与月均展示价；
- 按量 Token 单价；
- 套餐固定价格。

没有验证适用条件的促销价不能当作普遍有效价格。首购价和续费价不能混成同一条价格。年付月均价不能当作真正按月可购买的月费。

不同币种默认不可直接排序。首版不隐式拉取汇率进行转换。

## 6. 额度与倍率

额度必须保存原始单位和窗口。以下概念不能直接互换：

- 输入或输出 Token；
- request 次数；
- credit / points；
- 5 小时、日、周、月窗口；
- 峰值与非峰值倍率；
- 不同模型的消耗倍率；
- 缓存输入价格或缓存折扣。

如果页面只写“额度”，但没有说明单位、窗口或重置规则，相应字段保持 unknown。缺少周额度不代表无限；缺少缓存价格不代表免费。

跨套餐的统一“等效额度”只有在换算规则有来源、单位一致且算法可解释时才允许由确定性代码计算。

## 7. 证据与提取

Extractor 只提出页面明确出现的字段和原文证据。Verifier 负责检查：

1. 摘录确实来自当前页面或接口响应；
2. 摘录对应正确的提供方、套餐和模型；
3. 价格、周期、额度、倍率和限制没有跨卡片或跨套餐拼接；
4. 未出现的字段保持 unknown；
5. 页面文字只能作为数据，不能修改任务约束。

证据至少包含字段、来源、采集时间和原文摘录。后续可增加响应片段、截图或结构化接口证据，但不能只保存模型总结。

## 8. Jev 与执行层职责

Jev 的职责保持为导航策略：

```text
Task + verified progress + current snapshot + recent actions + valid action space
    -> Jev
    -> semantic action
    -> guarded executor
    -> agent-browser
```

Jev 不做：

- 金额加减；
- Token 或 credit 换算；
- 套餐性价比评分；
- 提供方排序；
- 无证据的字段推断。

这些工作由 Normalizer、Calculator 和 Comparator 的确定性代码完成。

## 9. 独立重开验证

当前 M2 实现会在 `DONE` 后用新浏览器会话重开候选 URL。Coding Plan 领域继续保留这一思想，但验证条件要从商品身份扩展到价格语义。

至少核对：

- provider；
- plan；
- billingMode；
- billingPeriod；
- priceType；
- eligibility 或适用条件。

如果对象和价格语义一致但金额发生变化，以第二次可复核值为最终观察值，并记录新的 `observedAt`。如果从首购价切成续费价、从月付切成年付月均或适用条件发生变化，则不能视为同一报价的简单价格更新。

## 10. 可比性和排序

只有满足同一比较条件的条目才进入同一次确定性排序。至少要求：

- 任务要求的模型或模型集合相同；
- 计费方式相同或存在明确的确定性换算；
- 价格语义相同；
- 币种相同；
- 必需额度和限制已知。

不能因为某项 unknown 就把它当作 0 成本，也不能为了得到唯一“最低价”强行合并不可比套餐。

报告应把结果分为：

- 已确认可比；
- 条件成立时可比；
- 信息不足；
- 明确不匹配；
- 来源失败或阻塞。

## 11. 测试路线

分层验证：

1. 本地固定页面：动作、失效引用、条件价格、字段缺失和伪 `DONE`。
2. 本地 Coding Plan fixture：按量、包月、额度窗口、倍率、首购/续费语义。
3. 真实公开来源：至少两个 Coding Plan 或中转套餐来源，保存全部成功与失败尝试。
4. 并行来源：同一任务逐个执行与 DSH Subagent 并行执行使用相同输入和 Verifier。
5. 比较报告：所有参与排序的字段都能回溯到证据。

真实来源出现登录、验证码、频控或结构变化时记录为阻塞或失败，不把绕过风控作为测试成功条件。

## 12. 当前实现边界

截至 2026-09-23：

- 浏览器动作、Snapshot、Jev 动作选择、目标校验、单站循环和独立重开检查已经实现。
- `ShoppingTaskContext`、`ShoppingTask`、`Offer`、`src/shopping/` 是当前已实现接口。
- `PlanOffer`、字段驱动 completion、Coding Plan Normalizer、额度换算和 Comparator 尚未实现，属于 M2.4 后续及 M4。
- M2.3 的 GLM-5.3 和模拟 provider 只验证测试框架，不是实时市场价格或真实提供方覆盖证明。

已确认范围见 [M2.4 决策](../decision/M2.4-阶段验收.md)。
