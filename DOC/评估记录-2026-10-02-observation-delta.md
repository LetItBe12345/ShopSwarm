# observation delta 本地试验与三版对照

状态：本地原型、统一检查及新版五例真实实测与人工审阅已完成。核心标价4/5可回答，但本轮比当前版更慢、Token更多，未证实delta的整轮收益。用户现已授权提交并推送试验分支，不创建PR、不合并；不建议把此原型直接作为下一版默认优化。

## 版本与方案判断

2026-10-02先核对工作区：main干净，fetch后与origin/main一致，提交`5e096a0`。当前0.3.0实现、Jev优化和已有五例评估已由PR #35合并。在分支`experiment/observation-delta`试验[issue #36](https://github.com/LetItBe12345/ShopSwarm/issues/36)。用户要求仅测新版，当前版和直接CLI结果直接引用，不修改历史统计。

方案的动作后小观察、按需原始证据及单动作交回Agent可以采用。收益仍是待验证假设：正文少不一定减少整轮Token，额外read也会增加轮次。ref不能用于跨快照识别DOM身份；同名控件也可能重复。此次不加入价格变化判断、商品匹配、固定字段gate或调度器。

Jev候选压缩暂不采用：此前真实独立问题已证明operation head需要当前批次完整描述；只放到target head会选错。保留这部分必要重复，让这轮只检验observation transport；没有承诺Jev Token一定下降。

## 实现与使用

成功act返回`observationMode=delta`、当前snapshotId/URL/时间/revision、trace与CLI连接。delta最多3000字节JSON，包含完整原始变化行、前后revision/URL、选定动作和ref映射增删。对齐时仅忽略原生ref标注；不把同ref或同名当持久控件。共同前后段之外的单个变化窗口超过预算时回退，不截掉变化。分散变化可能包含大量未变中间行，因此保守回退；不引入额外diff依赖。

导航、大变化回退原有6000字节pageExcerpt。失败、DONE、BLOCKED和MORE_TARGETS保留正文。动作后原先复用的compact快照改为完整快照，保持一次刷新，确保read不是读取省略过的证据。空delta只代表文本/ref映射未显示变化，不覆盖视觉状态或证明目标完成。

核对事实用`shopswarm_browser(action="read", sessionId=原会话, snapshotId=返回的ID)`，按nextOffset继续；需要fresh状态用observe。首次act即使未给初始全文，也不能从小变化推断商品和价格，Skill明确按需读取。旧快照仍按原ID保留。所有权、有效引用、取消、超时、清理与同会话CLI不变。

## 接口来源

检索2026-10-02：[agent-browser](https://github.com/vercel-labs/agent-browser)，v0.38.1，tag提交`aff6125c023b810ea3f2e5deec5379e9a4270bdc`。查安装版本README的snapshot、diff接口及上游`cli/src/native/diff.rs`、`skill-data/core/references/snapshot-refs.md`。原生diff使用Rust similar/Myers和独立baseline，不能直接比较插件已保存的两份快照而不加CLI调用；此次选保守线性窗口，没有复制源码或新增依赖。外部agent-browser本地参考副本缺失，按需读取固定tag上游，不把路径当运行依赖。

本地只读查阅[forvela/jev-agent-browser](https://github.com/forvela/jev-agent-browser)，提交`b4d4e0284a4b0336f12831ef6fe64ba5d29b1efb`的`src/decision.js`；其state refs与questions target criteria亦分别提供候选。接口依据同时结合本项目历史真实失败，不复制其关键词规则。DSH0.1.7-alpha.2、agent-browser0.38.1、Jev1.13及调用通道均未更换。

## 检查与真实运行

Node24.21.0、pnpm11.7.0下`pnpm check`通过：16文件、80测试、类型检查与构建。覆盖原始变化/Unicode、ref复用/重编号、插入删除、导航/大变化回退、动作后全文与旧证据、执行失败正文；既有会话隔离、取消、清理、复制Profile原数据保护测试也通过。Python语法与diff检查通过。

试验tarball SHA256：`902f4ee6c64d2bb8821b7b11fac59c58c2d4363f36f23c3fadd91035ccf93c44`，已安装到私有隔离DSH_HOME，旧headless profile和旧包未修改。实测命令为`SHOPSWARM_DSH_HOME="$PWD/runtime/observation-delta-20261002/dsh-home" python3 scripts/evaluate-shopping.py --compare --mode shopswarm --output runtime/observation-delta-20261002/comparison`，仅运行新版。主模型和原五例比较prompt沿用，首步act；不读取历史答案、无人介入，不用旧报价代替。

后台独立headless，headed=false、auto-connect=false，无用户Profile/CDP，原生daemon未继承代理。日志和私有配置只留runtime，不纳入提交。焦点采样沿用X11，不完全覆盖Wayland。

## 结果

本轮运行2026-10-02T12:56:53Z–13:10:54Z。五例全部自然退出；逐项核对原始tool结果、快照/DOM、同源接口和配置。四例支持当前标价，BIKE24无商品/报价。不是把exit0、DONE或动作成功当购物成功。五例结束后插件与default会话均为空，X11 focusChanges均为空、前后均0x0；未连接用户窗口，Wayland焦点仍未全面监测。

| 用例 | 本轮核心结果 | 采集时间（UTC） | 新版耗时 | Jev请求 / 成功动作 | delta / 正文回退 | read / observe |
|---|---|---|---:|---:|---:|---:|
| Aeron B Graphite | 标准底座1760EUR、抛光底座2114EUR，配置分列 | 13:03:17 | 6:49 | 0 / 0 | 0 / 0 | 0 / 0 |
| iPhone17 Black256GB | 1099EUR；两选项checked=true | 13:04:38.720 | 1:26 | 2 / 2 | 0 / 2大变化 | 2 / 0 |
| Thomann SM7B | 398EUR，129929、1Stück；新品unknown | 13:06:15.474，后续HTTP复核至13:07 | 2:02 | 9 / 4 | 2 / 2导航 | 1 / 1 |
| BIKE24 Edge1050 Bundle | Access Denied，商品/报价未核实 | 13:07:35.987 | 1:02 | 1 / 0 | 0 / 0 | 1 / 0 |
| Samsung S26 Black512GB | 当前展示标价1299EUR，型号SM-S942BZKHEUB | 初始快照13:09:30.551；核心CTA核对13:10:11.384 | 2:40 | 4 / 0 | 0 / 0 | 0 / 0 |

正文回退只计成功真实动作后delta无法使用的返回，不把无动作的BLOCKED/MORE_TARGETS或初始超时算fallback。2次delta+4次fallback覆盖全部6次Jev成功动作。read/observe为插件调用，不包含CLI观察和HTTP读取。

实际动作按变更命令计：adapter五次初始导航尝试、六次Jev动作（全部执行成功）；Aeron同会话CLI另有三次open、两次click和一次eval展开两个details，共六条变更命令。其余四例CLI仅读取。合计17条变更命令尝试，包含初始导航；wait、snapshot、read、get、取证eval及close不计。展开两个details是一条eval命令，不称一个DOM动作。旧两组未按此口径完整统计CLI动作，因此不制造三组全动作同比；下表仅比较可审计的Jev动作。

### 原始来源与事实核对

- [Herman Miller配置页](https://destore.hermanmiller.com/products/aeron-office-chair?variant=58039500800382)：CLI DOM显示Graphite Graphite、B–Mittelgroß、购买价格176000分；同源商品JSON的variant58039500800382对应相同配置。扶手/腰托/倾角保持明确选择；抛光底座B另一个variant为211400分，不能混作同一配置。
- [Apple配置页](https://www.apple.com/de/shop/buy-iphone/iphone-17/6,3%22-display-256gb-schwarz)：两次保存快照read分别确认Schwarz及256GB勾选，1099EUR与分期45.79/月分开；同会话CLI核对最终URL和配置摘要。
- [Thomann商品页](https://www.thomann.de/de/shure_sm_7b_studiomikro.htm?type=quickSearch)：本轮原始商品文本/HTTP200响应支持SM7B、129929、1Stück、398EUR；UVP479与套装价分开。没写B-Stock不证明新品，报告保留unknown。
- [BIKE24起点](https://www.bike24.de/p1843537.html)：read重复核对保存的拒绝页，Access Denied和edgesuite引用均可溯源。没有更换UA/请求头/出口或试探同类URL；没有以别的版本/旧价填补。
- [Samsung购买页](https://www.samsung.com/de/smartphones/galaxy-s26/buy/?modelCode=SM-S942BZKHEUB)：CLI DOM显示基础S26、512GB12GB、Black勾选，CTA型号一致且modelprice/discountprice/modelrevenue均1299。此次页面与昨天1199不同，保留当前证据；54.13/月及旧机优惠另列。页面还说无旧机100EUR自动购物车抵扣，未进结账，不把展示标价1299称最终到手价，也不自行用旧1199代替。

### 三版对照（旧结果直接引用）

直接CLI来自[既有五例基线](评估记录-2026-10-01-单工具与直接CLI.md)，当前版来自[修正版五例](优化记录-2026-10-01-Jev效率.md)。main源码与修正版相同，之后Skill加强不穿透拒绝页；旧统计仍按当时那轮引用，不假称今天重跑main。

| 五例合计 | DSH+agent-browser CLI旧基线 | 当前版旧五例 | delta本地试验 |
|---|---:|---:|---:|
| 核心标价可回答 | 4/5 | 4/5 | 4/5 |
| wall time | 2,225,580ms（37:06） | 659,078ms（10:59） | 839,352ms（13:59） |
| 耗时中位 | 5:27 | 1:32 | 2:02 |
| DSH input | 213,823 | 123,819 | 192,207 |
| DSH output | 180,707 | 87,948 | 96,755 |
| DSH cacheRead | 6,731,136 | 2,878,976 | 3,323,264 |
| DSH total | 7,125,666 | 3,090,743 | 3,612,226 |
| Jev requests | 0 | 12 | 16 |
| Jev input / output | 0 / 0 | 40,947 / 5,157 | 55,403 / 7,138 |
| Jev decision wait | — | 8,535ms | 13,881ms |
| Jev实际动作 | — | 3成功 | 6成功 |
| delta / full fallback | — | 无此接口 | 2 / 4 |

此前优化前单工具五例为14:55、DSH3,950,727、Jev9请求，仍保存在原文，不修改。新表以用户指定的当前版与最初直接CLI为对照，不挑选首轮原型或自然流程补充中的最好结果拼表。

相对当前版，本轮wall time增加27.4%，DSH input增加55.2%、output增加10.0%、cacheRead增加15.4%、total增加16.9%；Jev input/output合计增加35.7%。虽然仍比直接CLI旧基线少49.3% DSH total、少62.3%耗时，这并不能归因delta。DSH含缓存Token不代表费用同比，Jev独立计量，不按同一价格相加。单轮、跨日期、页面状态/价格变化和Agent流程差异，不具统计显著性。

### 正面证据、失败与干扰

真实delta功能工作：Thomann的搜索输入返回原始控件展开、输入值及按钮标签变化；CLICK small Geht klar返回空变化，来源没有据此声称商品研究完成。2次导航均正确返回正文；iPhone两次真实选择变化较大，原型退回正文，没有隐藏未知变化。来源能继续read/CLI并正确close，四例报价与原始事实相符。

端到端收益没有得到证明。2次delta集中在一次偏离预定流程的Thomann研究，其余关键动作没有压缩返回。当前单个变化窗口和完整ref映射对大页面较保守；不能把回退次数多说成优化有效，也不能为了提高压缩率省掉尚未核对的变化。

保留如下偏差，不用它们宣称全程无错误：

- Aeron初始页面加载超时，Jev未请求；CLI后来在正确商品页完成配置。Lead把日志中的404及后续导航说成301重定向，缺少对应网络证据。标价仍可核对，但这句过程描述不成立。
- iPhone由Lead直接研究，没有按prompt同步委派。2次Jev请求比旧6次少，不能归因delta（实际上2次都full fallback）。
- Thomann原问题和fixture给的是正确`studiomikro.htm`，Agent却把起点写成`studiomik.htm`，访问未知商品页后绕站内搜索，9次请求对比旧1次；最终还误称用户起点错误。不能改fixture或重跑较快结果来掩盖。新URL与398报价有真实证据，Lead的重复HTTP核对仍增加上下文。
- Samsung四次MORE_TARGETS受页面变化重置候选影响，没有实际Jev动作。Lead额外检索DSH代码、私有runtime和本轮来源日志查回传，增加上下文；没有读旧评估答案。delta未参与，报价变化也不是代码优化产物。

建议保留这个本地原型用于复查接口，当前版继续作为下一步设计基准；本轮不建议直接发布“delta降低整轮Token”的承诺。后续若继续，优先让已有两份快照支持多个独立变化窗口，减少大页面的保守full fallback；这是设计建议，尚未实现或验证。不要先压缩已证实必要的Jev独立候选信息或扩大动作权限。本次不追加旧版本重测或大规模评估。

私有原始日志、prompt、五项metadata、plugin结果、usage、人工review与summary保存在`runtime/observation-delta-20261002/comparison/`，五项都reviewed=true。当前公开文档仅记录脱敏事实，不提交凭据、Profile或全量页面日志。
