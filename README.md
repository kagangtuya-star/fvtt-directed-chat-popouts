# Directed Chat Popouts

GM 可以在聊天消息的右键菜单中选择「推送悬浮卡片…」，向一个、多个或全部在线玩家以及 GM 自己打开原生聊天悬浮窗。模块 ID：`directed-chat-popouts`。目标版本：Foundry VTT v13 / v14。

列表包含在线玩家和标注为「我 · GM」的当前 GM。默认选择所有有权查看消息的在线非 GM 玩家，GM 自己默认不勾选；「全选」包含自己，也可仅勾选自己。离线及无权限玩家不可选，空选时禁用推送。接收者可拖动、调整大小、双击标题最小化、关闭窗口，同时继续操作地图。同一消息重复推送会恢复并聚焦已有窗口，关闭不删除原消息。不同消息可同时打开，长内容内部滚动。

悬浮窗采用 24px 紧凑标题栏，缩放手柄位于右下角内侧。卡片更新、展开/收起、图片加载、宽度调整及最小化恢复后，窗口持续按内容同步高度，消除短卡片下方留白。可调整宽度；纵向拖动设置长卡片的滚动高度上限，短卡片仍贴合底边。重复推送复用窗口及其宽度、滚动高度上限。

## 安装

本地构建产物在 `dist/directed-chat-popouts.zip`，配套 `dist/module.json`、`dist/SHA256SUMS`。

1. 将 ZIP 解压到 Foundry 用户数据目录 `Data/modules/directed-chat-popouts/`。
2. 确认路径为 `Data/modules/directed-chat-popouts/module.json`，避免重复嵌套目录。
3. 重启 Foundry，在世界的模组管理中启用 **Directed Chat Popouts**，所有客户端刷新页面。
4. GM 右键聊天消息，选择接收者并推送。浅色和深色界面沿用 Foundry 原生主题；语言跟随 Foundry，提供简体中文及英文。

正式发布 GitHub Release 并上传附件后，可以在 Foundry「安装模组」中使用：

```text
https://github.com/kagangtuya-star/fvtt-directed-chat-popouts/releases/latest/download/module.json
```

该 URL 是发布后的地址；本地开发完成不表示附件已上传，目前可直接用 ZIP 手动安装。

## 消息交互与权限

直接实例化 Foundry 原生 `ChatPopout`，由核心调用正式消息渲染机制，不复制聊天栏 DOM，不重写 PF2e 规则。保留 `renderChatMessageHTML`、`renderChatPopout` 等系统与模组扩展路径。普通文本、核心骰子、PF2e 的内联检定、物品、法术、动作和伤害卡片均走其原有渲染和权限逻辑。

推送通过核心服务器认证的 **ChatMessage 文档更新 / Socket 同步机制**传递：仅在消息 flag 中保存协议版本、消息 ID、接收者 ID、随机 nonce 和时间。没有 socketlib 或其他运行时依赖，也没有自定义的裸 Socket 监听器。接收端核验核心 `updateChatMessage` Hook 的实际更新发起用户是 GM，拒绝普通玩家的更新；载荷不提供可冒充的发送者 ID。再核验接收者、时效、去重及本机 `visible` / `isContentVisible`。后续普通消息编辑不会触发旧的推送记录。

这不会共享或公开消息：其他玩家的密语、GM-only 消息及盲掷不会通过推送获得可见性。所有非 GM 盲掷推送均被保守禁止。玩家没有推送菜单，即使自行更新其所写消息上的本模组 flag，也不能让其他客户端打开窗口。安全边界依赖 Foundry 服务器认证、文档权限和核心 Hook；不能防御接收者本机的恶意代码或被攻陷的服务器。

原消息的普通更新由原生弹窗同步；消息删除或本机失去查看权限时关闭关联窗口。每条消息最多保留最后一份小型推送 flag，不保存 HTML，不建立历史队列。离线期间不排队，重连/刷新不重放；请求有效期 120 秒，客户端时钟允许超前 30 秒。GM 提示表示服务器接受推送，不是玩家端阅读回执；断线、未启用模组或系统阻止渲染的客户端可能无法显示。

## 兼容范围与验证状态

已核实 v13.350、v14.370 官方 API 和 PF2e `v13-dev`（调查时 7.12.2）的渲染/弹窗绑定源码。兼容层只使用这些版本共同的公开 API；不覆盖核心方法，不使用私有 API。由于没有真实 Foundry 运行实例，manifest 不填写 `compatibility.verified`，避免将 API 调查写成实际运行认证。

自动测试使用隔离的 Foundry/DOM 合约替身，覆盖菜单权限、默认接收者、选择操作、发送/接收、安全处理、重复请求、生命周期、并发、v13/v14 适配和窗口边界；**不等同于真实服务器端到端或 PF2e 浏览器交互测试**。真实环境步骤见 [手工测试清单](docs/manual-testing.md)，已执行检查及环境见 [验证记录](docs/validation.md)。

第三方模组若只给 `#chat-log` 委托事件、依赖固定 DOM ID、依赖聊天栏专属状态、使用过时渲染 Hook 或主动禁止弹窗，其部分按钮可能失效。只在原生消息/弹窗渲染路径上正确注册交互的功能才能自然保留。Requestor 的旧版 Hook 及所有第三方组合、PF2e 在 v14 上的具体发行版本都需实机验收，不能宣称全部兼容。详情见 [API 调查与方案](docs/api-research.md)。

## 开发与构建

只需 Node.js 22 或更新版本，不需要安装任何依赖：

```sh
npm run check
npm test
npm run build
```

`check` 执行 JavaScript 语法、manifest、文件路径及双语键/插值一致性检查；没有依赖 ESLint。`test` 使用 Node 内置测试器。`build` 使用标准库生成确定性的标准 ZIP、独立 manifest 和 SHA-256 校验文件，不修改源码。ZIP 内根目录就是 `module.json`；仅打包运行文件、许可证和文档，不含测试、构建工具、Git、缓存或依赖。

```text
scripts/       入口、API 兼容层、接收策略、控制器、原生弹窗管理、玩家选择窗口
styles/        仅本模组窗口布局样式
languages/     简体中文 / English
tests/         隔离自动测试
tools/         无第三方依赖的检查与构建工具
docs/          API 依据、验证记录、手工验收清单
dist/          本地安装包与 manifest（生成，不纳入 Git）
```

## 发布

当前版本为 `0.1.4`，修复卡片底部持续贴合，保留 GM 自己接收、紧凑窗口布局和菜单启动顺序修复。覆盖安装后需要刷新所有客户端。发布前在 v13/v14 与实际使用的游戏系统中完成手工测试，再按结果决定是否填写 `compatibility.verified`。

1. 同步修改 `package.json`、`module.json` 的版本与源码 manifest 的下载版本路径。
2. 执行上述三个命令，检查安装包及文档，提交代码。
3. 在 GitHub 创建与版本对应的 Release（例如 `v0.1.4`）。仓库工作流会检查、测试、构建并上传 ZIP、module.json 和 SHA256SUMS；tag 与 manifest 版本不符会失败。
4. 在 Foundry 官方包管理页面登记模块及版本。开发过程未创建 Release、tag 或进行 push。

工作流使用当前 `GITHUB_REPOSITORY` 生成发布 URL，fork 发布时无需硬编码改构建器。推送、PR 和手动运行工作流只生成可下载构建附件；仅发布 Release 事件会上传发行附件。

## English

GM-only context menu → select online players and optionally yourself (GM) → native, nonmodal chat popouts. Online players are selected by default; the sending GM is optional and included by Select all. Repeated pushes focus/restore the same message window. Core authenticated document updates carry only a small request flag; recipient visibility and blind-roll restrictions are preserved. No runtime dependencies. Manual ZIP installation: extract into `Data/modules/directed-chat-popouts/`, enable in the world, and refresh clients. Foundry v13/v14 APIs were researched; real Foundry/PF2e end-to-end validation is still required. See the linked testing and compatibility documents.

MIT License. No third-party module or system implementation is bundled.
