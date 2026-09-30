# ShopSwarm End-to-End Benchmark TODO

目标：用 5 个真实购物任务，对比：

- DeepSeek V4 Flash + agent-browser CLI
- DeepSeek V4 Flash + ShopSwarm

核心指标：

- Task Success
- E2E Time
- Token Consumption

- [ ] **1. 准备 5 个测试任务**
  - [ ] Herman Miller Aeron：指定尺寸和颜色，返回当前价格。
  - [ ] Apple Store：指定 iPhone 型号、容量和颜色，在指定国家商店返回价格和币种。
  - [ ] Thomann：查询 Shure SM7B 当前售价。
  - [ ] BIKE24：查询 Garmin Edge 1050 Bundle 当前售价。
  - [ ] Samsung Germany：指定 Galaxy S26、512GB、Black，返回当前售价。

- [ ] **2. 准备两个测试方案**
  - [ ] Baseline：DeepSeek V4 Flash 直接使用 agent-browser CLI 完成任务。
  - [ ] ShopSwarm：DeepSeek V4 Flash 使用 ShopSwarm 完成任务，正常使用 Jev 和现有 fallback。
  - [ ] 两个方案使用相同的任务 Prompt 和初始页面条件。

- [ ] **3. 记录三个核心指标**
  - [ ] 记录每次任务是否成功。
  - [ ] 记录从任务开始到最终返回结果的总耗时。
  - [ ] 记录一次完整任务消耗的总 Token。

- [ ] **4. 执行 Benchmark**
  - [ ] 每个任务分别运行 Baseline 和 ShopSwarm。
  - [ ] 每个方案每个任务运行 3 次。
  - [ ] 总计执行 30 次端到端任务。
  - [ ] 每次运行使用新的浏览器 session。

- [ ] **5. 实现 Benchmark Runner**
  - [ ] 新增配置文件保存 5 个任务。
  - [ ] 新增脚本运行两个方案。
  - [ ] 保存每次运行的 success、elapsed time、tokens 和最终答案。
  - [ ] 保存原始 JSON 结果。
  - [ ] 自动生成汇总表。

- [ ] **6. 输出最终结果**
  - [ ] 统计两个方案的 Success Rate。
  - [ ] 统计两个方案的 Median E2E Time。
  - [ ] 统计两个方案的 Median Token Consumption。
  - [ ] 输出按任务拆分的结果。

| System | Success Rate | Median E2E Time | Median Tokens |
| --- | ---: | ---: | ---: |
| DeepSeek V4 Flash + agent-browser CLI | | | |
| DeepSeek V4 Flash + ShopSwarm | | | |
