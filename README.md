# ShopSwarm

ShopSwarm 是一个可加载到 [DSH](https://github.com/deepseek-ai/deepseek-harness) 的通用购物研究插件。它让 DSH Agent 在独立的后台浏览器中读取商品或定价页面，核对型号、规格、卖家和价格，并把页面证据交回 Agent。

它只读页面，不下单、不支付、不绕过登录、验证码或站点限制。

## 工作方式

DSH Lead 分配来源、等待 Subagent 返回后汇总。ShopSwarm 只提供 shopswarm_browser：Jev 为具体浏览目标选动作，adapter 用 agent-browser CLI 执行。需要 fallback 时，来源 Agent 直接用返回的 CLI 参数继续操作同一持久 headless 浏览器。

不做商品硬匹配，也不要求所有购物字段齐全。只查标价时，库存、VAT 细项或运费未知不导致整个任务失败；用户要求到手价、交付等条件时才核对相应信息。最终报告直接交回 Lead，无需 finish JSON。

当前源码为单工具开发版；旧 Release 使用历史流程。设计与实际验证边界见 [设计说明](DOC/设计说明.md)、[使用教程](DOC/使用教程.md)。

## 前置条件

- Node.js 24.21.0、pnpm 11.7.0。
- DSH 固定 0.1.7-alpha.2，主模型需要有效配置。
- Jev 密钥仅在选择 Jev 辅助动作时需要。

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


历史 Release `v0.2.0` 使用旧流程。新接口请从当前源码打包安装；下面仅是历史版本的安装示例：

```bash
pnpm run install:dsh -- web \
  https://github.com/LetItBe12345/ShopSwarm/releases/download/v0.2.0/shopswarm-0.2.0.tgz
```

把 `web` 换成实际使用的 profile 名称。安装后重新启动 DSH。安装器会更新该 profile 的 `package.json` 和 lockfile，不会修改 DSH 源码。

### 从源码安装

以下命令适用于包含单工具实现的源码目录；旧 Release 不提供新接口。

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm build
pnpm pack
```

然后把生成的 tarball 安装到 DSH profile：

```bash
pnpm run install:dsh -- web /绝对路径/shopswarm-0.3.0.tgz
```

CLI 和 Web 使用不同 profile，插件不会自动共享。需要哪个界面，就为哪个 profile 安装：

```bash
pnpm run install:dsh -- headless /绝对路径/shopswarm-0.3.0.tgz
```

修改源码后必须重新执行 `pnpm build` 和 `pnpm pack`。

## 使用

源码 build/pack 后安装到 headless profile，在仓库目录执行：

```bash
bash scripts/run-dsh.sh --profile headless --json "使用 ShopSwarm 比较德国两家商店的 Shure SM7B。核对商品、报价、币种、条件和来源，缺失标未知。只读，不购买。"
```

shopswarm_browser 返回 sessionId、快照、来源时间和同会话 CLI 连接参数。默认 act 调用 Jev，open/observe/read 只观察；完成后 close。详见 [Skill](skills/shopping-research/SKILL.md)。

配置放在本地 .env 或启动环境，真实密钥不入库。源码启动入口会加载 .env 并清除代理。默认独立 headless 会话，不读取用户 Chrome Profile。

## CLI 和 Web UI

### DSH CLI

CLI 不启动 Web UI，适合自动化和端到端验证。在仓库目录使用统一入口，它调用 lockfile 固定的本地 DSH，不依赖全局 `dsh`：

```bash
bash scripts/run-dsh.sh --version
```

安装到 headless profile 后，直接执行任务：

```bash
bash scripts/run-dsh.sh --profile headless "检查 ShopSwarm 运行状态"
bash scripts/run-dsh.sh --profile headless --json "用 ShopSwarm 查看德国 Apple iPhone 商品页，只读"
```

headless 入口加载项目配置，让 Subagent 同步返回结果。多来源任务先收齐每个来源的结果，再输出最终汇总，避免把“等待子任务”当作最终回复后退出。Web/TUI 不加载这个 headless 配置。

### Web UI

安装到 web profile 后，从源码目录使用启动脚本，再打开终端输出的本地网址：

```bash
scripts/run-dsh-web.sh --no-open
```

CLI、Web 和 TUI 入口统一检查 Node.js `24.21.0`、pnpm `11.7.0` 和 DSH `0.1.7-alpha.2`，加载仓库 `.env`，并清除终端代理变量。也可以指定 DSH home：

```bash
SHOPSWARM_DSH_HOME=/path/to/dsh-home scripts/run-dsh-web.sh --no-open
```

## 结果与验证

工具步骤与购物回答分别判断。只查标价时，附加字段未知不自动算失败；比较时注明价格口径与未计费用。当前实现及验证状态见 [收尾 TODO](TODO/README.md)，历史三工具记录不代表单工具验收。

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
