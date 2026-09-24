# ShopSwarm

ShopSwarm 是一个可加载到 [DSH](https://github.com/deepseek-ai/deepseek-harness) 的通用购物研究插件。它让 DSH Agent 在独立的后台浏览器中读取商品或定价页面，核对型号、规格、卖家和价格，并把页面证据交回 Agent。

它只读页面，不下单、不支付、不绕过登录、验证码或站点限制。

## 工作方式

DSH 负责理解任务和调度 Agent。需要比较多个来源时，Lead Agent 可以为每个来源派一个 Subagent；每个来源由自己的 Subagent 负责到底。

```text
DSH Agent
  -> ShopSwarm
  -> Jev 选择当前页面的下一步动作
  -> ShopSwarm 校验动作和页面版本
  -> agent-browser 在后台浏览器中执行
  -> 提取字段并重新打开页面核对证据
```

Jev 只选择动作，不直接点击浏览器；真正执行点击、填写、选择、按键和等待的是 ShopSwarm 调用的 agent-browser。

Jev 超时、返回无效动作、浏览器动作超时或页面没有进展时，当前来源的 Subagent 使用 `shopswarm_browse` 接管。只有需要登录、验证码、人工处理、换来源，或来源确实无法继续时，才把结果交回 Lead Agent。

## 前置条件

- Node.js `24.21.0`
- pnpm `11.7.0`
- DSH `0.1.7-alpha.2`（其他版本未验证）
- Jev API 密钥（使用 `shopswarm_research` 时需要）
- DeepSeek API 密钥（报价提取或自动填写缺少明确输入时需要）

## 安装

如果已安装 nvm，可先准备指定版本：

```bash
nvm install 24.21.0
nvm use 24.21.0
corepack enable
corepack prepare pnpm@11.7.0 --activate
node --version
pnpm --version
npm install -g @deepseek-ai/dsh@0.1.7-alpha.2
dsh --version
```

未安装 nvm 时，先按 [nvm 安装说明](https://github.com/nvm-sh/nvm#installing-and-updating) 安装，再执行上述命令。


GitHub Release `v0.1.0` 可以这样安装，但它不包含当前 `fix/runtime-research-errors` 分支的后续修复。需要这些修复时，请用下方源码安装方式：

```bash
dsh plugin --profile web add \
  https://github.com/LetItBe12345/ShopSwarm/releases/download/v0.1.0/shopswarm-0.1.0.tgz
```

把 `web` 换成实际使用的 profile 名称。安装后重新启动 DSH。安装器会更新该 profile 的 `package.json` 和 lockfile，不会修改 DSH 源码。

### 从源码安装

```bash
git clone https://github.com/LetItBe12345/ShopSwarm.git
cd ShopSwarm
git switch fix/runtime-research-errors
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm pack
```

然后把生成的 tarball 安装到 DSH profile：

```bash
dsh plugin --profile web add /绝对路径/shopswarm-0.1.0.tgz
```

CLI、TUI 和 Web 使用不同 profile，插件不会自动共享。需要哪个界面，就为哪个 profile 安装：

```bash
dsh plugin --profile headless add /绝对路径/shopswarm-0.1.0.tgz
dsh plugin --profile tui add /绝对路径/shopswarm-0.1.0.tgz
```

修改源码后必须重新执行 `pnpm build` 和 `pnpm pack`。

## 配置密钥

在启动 DSH 的环境中设置：

```bash
export JEV_API_KEY='你的 Jev API 密钥'
export DEEPSEEK_API_KEY='你的 DeepSeek API 密钥'
```

项目脚本各自决定是否加载 `.env`，不能假设所有 DSH 启动方式都会读取仓库根目录的 `.env`。上面的环境变量方式适用于后续命令；不要把真实密钥提交到 Git。

- `JEV_API_KEY`：页面动作选择，仅由 `shopswarm_research` 使用。
- `DEEPSEEK_API_KEY`：报价字段提取；页面需要填写文字且任务没有明确输入时，也用于文本输入辅助。
- `JEV_BASE_URL`：可选，默认 `https://api.tu-zi.com`。
- `JEV_MODEL`：可选，默认 `jev-1.13`。

ShopSwarm 的 Jev、报价提取、文本输入和其他插件 HTTP 请求使用直连传输，不读取 DSH 进程继承的代理变量。浏览器进程也会清除代理和前台 Chrome 连接变量。

## 直接使用

在 DSH 或 TUI 中直接说明商品、规格、比较条件和来源要求：

```text
找 2TB 移动固态硬盘，比较三个公开来源的型号、容量、价格、运费和卖家。
只读取页面，不购买。缺少页面证据的字段标记为未知。
```

比较套餐时：

```text
比较智谱官方和 Z.ai 的 GLM Coding Plan Lite 月付价格。
每个来源读取具体定价页，记录币种、计费周期和页面证据。
```

`shopswarm_research` 适合“单页、单目标、单卖家、一个明确价格或规格”。不要使用首页、搜索结果页或论坛列表页作为起点，也不要要求一个来源读取整站所有价格。不同来源可以由不同 Subagent 分工；当前插件默认一次执行一个浏览器任务。不要对同一来源重复并发调用。

## 三个工具

### `shopswarm_diagnose`

检查 Node.js、agent-browser 和运行路径。传入 `checkBrowser: true` 时，会打开临时后台浏览器，读取 `http://example.org/` 的 `Example Domain`，然后关闭会话。

### `shopswarm_research`

主研究工具。参数示例：

下面是参数结构示意，`example.org/product` 不是可测试的商品页，需替换为真实 URL。

```json
{
  "startUrl": "https://example.org/product",
  "goal": "读取该页指定商品的月付价格和币种",
  "model": "具体商品型号或套餐名",
  "specs": "[]",
  "seller": "卖家或提供方"
}
```

`model` 表示商品型号或套餐名，`specs` 表示规格，`seller` 表示要求核对的卖家。只有返回 `status: "success"` 且证据检查通过，报价才算已核实；模型返回 `DONE` 本身不代表成功。

### `shopswarm_browse`

当前来源 Subagent 在 Jev 失败后使用的直接浏览器工具。它不调用 Jev，调用方提供明确步骤：

```json
{
  "steps": "[{\"action\":\"open\",\"url\":\"https://example.org/product\"},{\"action\":\"waitText\",\"text\":\"Lite\",\"timeoutMs\":5000},{\"action\":\"snapshot\"},{\"action\":\"click\",\"role\":\"button\",\"name\":\"连续包年\"},{\"action\":\"snapshot\"}]"
}
```

上例同样是结构示意；按钮的 role/name 必须以实际页面为准。

每次 `shopswarm_browse` 调用会新建浏览器并在结束时关闭，最多执行 8 步。返回的 `session` 不是可恢复的会话句柄。接管 research 时需重新打开来源并恢复页面状态，当前尚不支持跨调用保留原标签页或自动移交回 Jev。

支持的动作是 `open`、`snapshot`、`click`、`fill`、`press` 和 `waitText`。点击或填写前，要依据同一会话的最新 snapshot 使用 `role` 和 `name`。

## CLI、TUI 和 Web UI

### DSH CLI

CLI 不启动 Web UI，适合自动化和端到端验证。先在当前终端定义统一的直连启动函数，CLI、TUI 和 Web 都可以用：

```bash
dsh_direct() {
  env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u FTP_PROXY -u NO_PROXY \
    -u http_proxy -u https_proxy -u all_proxy -u ftp_proxy -u no_proxy \
    -u AGENT_BROWSER_PROXY -u AGENT_BROWSER_PROXY_BYPASS dsh "$@"
}
```

安装到 headless profile 后，先诊断再执行任务：

```bash
dsh_direct --profile headless "检查 ShopSwarm 运行状态"
dsh_direct --profile headless --json "使用 shopswarm_diagnose 检查浏览器"
```

### Web UI

安装到 web profile 后，执行 `dsh_direct web --no-open`，再打开终端输出的本地网址。

也可以从源码目录使用启动脚本：

```bash
scripts/run-dsh-web.sh --no-open
```

脚本会检查 Node.js 24，并清除 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`、`AGENT_BROWSER_PROXY` 等变量后启动 DSH。也可以指定 DSH home：

```bash
SHOPSWARM_DSH_HOME=/path/to/dsh-home scripts/run-dsh-web.sh --no-open
```

### TUI

安装到 tui profile 后，执行 `dsh_direct tui` 即可进入终端界面。

项目脚本适用于已经准备好 `runtime/dsh-tui/home/profiles/tui` 的开发环境：

```bash
scripts/run-dsh-tui.sh
```

脚本会清除代理变量；如果 TUI profile 不存在，会直接提示并退出，不会修改用户现有 profile。

## 失败结果怎么处理

- `jev_error`、`browser_timeout`、`browser_error`、`no_progress`：当前来源 Subagent 继续使用 `shopswarm_browse`。
- `login_required`、`captcha`、`site_rate_limited`：交回 Lead，请求登录、换公开来源或结束来源。
- `verification_failed`、`offer_error`：证据不足或提取结果不可用，不能把候选值当成成功。

页面没有明确写出的价格、优惠、运费、税费、库存或兼容性保持未知。登录页、验证码页、空快照和反爬页面不能作为商品证据。

## 当前验证范围

DSH CLI 已验证插件加载、浏览器诊断和按键操作。真实定价页研究仍出现过 `no_progress`（缺少卖家、价格证据），不能据此承诺所有页面都能自动提取成功。页面摘要仍有长度上限；浏览工具返回 `ok` 只表示步骤执行完成，不等于价格已经核实。

Skill 描述的是 Agent 应遵循的流程，不会由插件代码强制创建 Subagent。默认不连接用户正在使用的 Chrome；真实登录态是否可复用需要单独验证。

## 开发检查

仓库要求 Node.js `24.21.0` 和 pnpm `11.7.0`。修改后运行：

```bash
pnpm check
```

这会执行类型检查、测试和构建。端到端验证使用 DSH CLI 的 headless profile，不用 Web UI 代替 CLI 验证。

## 文档和许可证

- [使用教程](DOC/使用教程.md)
- [设计说明](DOC/设计说明.md)
- [购物研究 Skill](skills/shopping-research/SKILL.md)
- [MIT License](LICENSE)
