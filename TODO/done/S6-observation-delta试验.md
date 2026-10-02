# S6：observation delta 本地试验

范围：按 [issue #36](https://github.com/LetItBe12345/ShopSwarm/issues/36) 在同步后的 main `5e096a0` 上试验动作后小观察。分支 `experiment/observation-delta`。2026-10-02用户追加授权提交并推送此试验分支；不创建PR、不合并。当前版及直接 CLI 的已有五例结果保留，只跑新版五例。

- [x] 核对 main/origin/main、工作区及 issue 方案。
- [x] 实现有大小上限的原始快照变化窗口；ref 只在当前快照有效，不跨版本认定 DOM 身份。
- [x] 成功动作默认 delta；导航、大变化返回 bounded observation；首次 act 提示按需 read，失败不隐去上下文。
- [x] 保留原始完整 snapshot、来源时间和 read/observe；单次一个动作及同会话 fallback 不变。
- [x] 核对 Jev 独立问题的候选需求；保留必要描述，不盲删已验证信息。
- [x] 运行匹配的引用/变化/失败/证据回归和 pnpm check。
- [x] 新版原五例真实端到端，核对报价、来源、采集时间、耗时、DSH/Jev 用量、浏览动作、delta/full/read/observe 次数、后台焦点与清理。
- [x] 写三版对照和限制，更新 roadmap、TODO 索引及完成路径。

完成条件：可安装加载，新版五例都完成实测与人工证据审阅（受阻如实保留），不能以旧答案替代真实结果。检查通过，失败与收益未证明的边界有记录。候选进一步压缩非前置条件；这次不扩大 Jev 权限，也不增加购物字段规则。

验证完成：Node24.21.0 / pnpm11.7.0下80测试、类型检查与构建通过；Python语法、diff检查通过。隔离配置安装与真实五例全部执行并人工审阅，4/5核心标价可回答、BIKE24拒绝。delta2次、fallback4次、read4次、observe1次；同会话与后台清理均有日志，焦点采样无变化（X11覆盖有限）。

与当前版旧五例相比，wall time13:59（+27.4%）、DSH total3,612,226（+16.9%）、Jev总Token62,541（+35.7%）。Thomann误写起点绕搜索、iPhone未委派、导航与DOM状态干扰均保留。功能原型可用，但未证明优化收益，不建议直接作为默认新版。来源、时间、接口版本、失败与三版统计见[完整评估](../../DOC/评估记录-2026-10-02-observation-delta.md)。用户现已授权提交、推送试验分支，保留原型与评估；不创建PR、不合并。
