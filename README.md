# ShopSwarm

ShopSwarm 是一个可由 DSH 加载的**通用购物研究插件**。它帮助 Agent 浏览商品页面、核对商品和报价信息、保留来源证据，并在信息足够时比较多个商品或卖家的报价。具体商品类别和比较条件由用户任务决定。

DSH 负责理解用户任务和 Subagent 调度。ShopSwarm 提供可调用工具并管理研究流程；`shopswarm_research` 可用 Jev 选择页面动作，ShopSwarm 校验目标并调用 agent-browser 实际操作浏览器。Jev 超时或返回无效动作时，由当前来源 Subagent 改用 `shopswarm_browse` 接管；只有该 Subagent 判断来源无法继续时才交回 Lead。商品字段和报价比较以证据及确定性规则为准，不让模型臆造缺失价格或费用。

## 当前目标

快速收尾为一个能被 DSH 安装和调用的通用购物研究插件。用户只需向 DSH Agent 描述商品和比较条件，Agent 按 Skill 选择工具；需要多个来源时再派 Subagent。插件只读页面，不购买或支付。

## 安装

在 DSH 使用的 profile 中安装：

```bash
pnpm add shopswarm
```

然后重新启动 DSH。需要 Jev 时，在 profile 环境中设置 `JEV_API_KEY`；需要文本输入辅助时设置 `DEEPSEEK_API_KEY`。

## 文档入口

- [使用教程](DOC/使用教程.md)
- [设计说明](DOC/设计说明.md)
- [收尾 TODO](TODO/README.md)

开发安装和真实使用步骤见 [使用教程](DOC/使用教程.md)。

`可参考项目/` 只用于本地查阅，已被 Git 忽略，不属于 ShopSwarm 源码或运行时依赖。

## 许可证

项目许可证尚未确定。当前公开内容可供查阅和讨论；在许可证文件添加前，请勿假定已有复制、修改或分发授权。
