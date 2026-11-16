# API 调查与方案

调查日期：2026-11-16。目标 Foundry v13 / v14。官方文档页实际标注 v13.350 Stable、v14.370 Stable。以下是公开文档/源码阅读结论，不是实机兼容性认证。

## 查询途径

本会话没有暴露 Context7 专用工具；检查 `/home/chenzihan/.codex/config.toml` 确认已配置远程 `https://mcp.context7.com/mcp`。WSL 的 DNS/直连失败后，使用现有 Windows PowerShell MCP 经 HTTP JSON-RPC 调用该 **Context7 MCP**，未安装工具或依赖。

实际调用 `tools/call → resolve-library-id`，查询 `Foundry Virtual Tabletop API Documentation`；返回 `/websites/foundryvtt_api`，明确列出 `Versions: v13, v14`。随后实际调用 `query-docs`：

| libraryId | 查询主题 | 返回依据 |
| --- | --- | --- |
| `/websites/foundryvtt_api/v13` | ChatPopout、ChatMessage 渲染、菜单、更新 | `renderHTML`、`renderChatMessageHTML`、消息生命周期 |
| `/websites/foundryvtt_api/v14` | ChatPopout、ApplicationV2、窗口、菜单 | `renderHTML`、ApplicationV2 构造与 ChatLog 更新 |
| `/websites/foundryvtt_api/v13` | 更新发起用户、权限、blind/visible | `preUpdateDocument`、`updateDocument`、消息访问器与数据结构 |

检索结果对部分细节不完整，继续直接读取下列官方版本化页面及公开类型/系统源码。没有把 Context7 未返回的细节声称为 Context7 的结论。原始下载缓存位于系统临时目录，未打包第三方源码。

## 核心 API 与版本差异

| 问题 | 核实结论与采用方式 |
| --- | --- |
| ChatMessage 渲染 | 两版均提供 `renderHTML({canClose?, canDelete?}): Promise<HTMLElement>`。`renderChatMessageHTML(message, html, context)` 接收原生 HTMLElement。模块不手动触发渲染 Hook。 |
| v13 的旧系统渲染 | v13 官方 `ChatLog.renderMessage` 明确处理 `getHTML` 废弃过渡；原生 ChatPopout 走该路径，因此无需自行猜测旧版系统是否覆盖了 `getHTML`。v14 的公开 ChatLog 页面仍列出该静态入口，保留核心控制。 |
| ChatPopout | 两版都位于 `foundry.applications.sidebar.apps.ChatPopout`，继承 ApplicationV2，具有 `message` getter、`_renderHTML`、`_onFirstRender`、`_onClose`。使用 `new ChatPopout({message, position, window})`；构造入参还由公开类型定义确认。直接用核心类，保留系统的 `renderChatPopout` Hook。 |
| 实例注册 | `foundry.applications.instances` 是公开的已渲染 ApplicationV2 Map。优先复用同一消息已打开的核心弹窗，额外维护本模组的在途渲染记录处理并发去重。 |
| 窗口生命周期 | 使用 `render({force:true})`、`bringToFront()`、`minimize()` / `maximize()`、`close()`、`setPosition()`，以及公开 `render` / `close` 事件。`window.resizable`、`window.minimizable` 均为公开配置，最小化交互为双击标题。拖动由核心窗口框架处理。 |
| 右键菜单 | 两版通用 Hook 文档均为 `getDocumentContextOptions(application, menuItems)`，把 Document 替换为 ChatMessage，即 `getChatMessageContextOptions`。与旧版 `getChatLogEntryContext(html, entries)` 不同。监听在 `setup` 注册，赶在 UI 首次构建菜单之前，不能延至 `ready`。仅追加菜单项，不改原数组其他条目。目标 DOM 从 `data-message-id` 解析；兼容层也能归一化旧模组包装的目标元素。 |
| 消息更新/删除 | `updateChatMessage(document, changed, options, userId)` 在服务器处理完后对所有连接客户端触发；`deleteChatMessage(document, options, userId)` 关闭关联弹窗。原生 ChatPopout 注册消息应用以更新内容，本模组额外处理消息不可见与删除。 |
| v14 额外能力 | v14 ApplicationV2 增加子窗口/分离窗口等能力，ChatPopout 的默认动作还列出 `expandRoll`。模块不接管动作、不依赖这些新增能力，保留核心行为。 |

官方入口：[v13](https://foundryvtt.com/api/v13/) · [v14](https://foundryvtt.com/api/v14/)。详细来源：

- [v13 ChatMessage](https://foundryvtt.com/api/v13/classes/foundry.documents.ChatMessage.html)、[v14 ChatMessage](https://foundryvtt.com/api/v14/classes/foundry.documents.ChatMessage.html)
- [v13 ChatPopout](https://foundryvtt.com/api/v13/classes/foundry.applications.sidebar.apps.ChatPopout.html)、[v14 ChatPopout](https://foundryvtt.com/api/v14/classes/foundry.applications.sidebar.apps.ChatPopout.html)
- [v13 ChatLog](https://foundryvtt.com/api/v13/classes/foundry.applications.sidebar.tabs.ChatLog.html)、[v14 ChatLog](https://foundryvtt.com/api/v14/classes/foundry.applications.sidebar.tabs.ChatLog.html)
- [v13 菜单 Hook](https://foundryvtt.com/api/v13/functions/hookEvents.getDocumentContextOptions.html)、[v14 菜单 Hook](https://foundryvtt.com/api/v14/functions/hookEvents.getDocumentContextOptions.html)
- [v13 setup](https://foundryvtt.com/api/v13/functions/hookEvents.setup.html)、[v14 setup](https://foundryvtt.com/api/v14/functions/hookEvents.setup.html)：文档已初始化、UI 应用尚未初始化，适合提前注册菜单监听；通知应用按需访问，避免过早捕获尚未创建的 `ui.notifications`。
- [v13 ApplicationV2](https://foundryvtt.com/api/v13/classes/foundry.applications.api.ApplicationV2.html)、[v14 ApplicationV2](https://foundryvtt.com/api/v14/classes/foundry.applications.api.ApplicationV2.html)
- [窗口配置](https://foundryvtt.com/api/v13/interfaces/foundry.applications.types.ApplicationWindowConfiguration.html)、[v13 实例注册表](https://foundryvtt.com/api/v13/variables/foundry.applications.instances.html)、[v14 实例注册表](https://foundryvtt.com/api/v14/variables/foundry.applications.instances.html)
- [更新 Hook](https://foundryvtt.com/api/v13/functions/hookEvents.updateDocument.html)、[删除 Hook](https://foundryvtt.com/api/v13/functions/hookEvents.deleteDocument.html)
- [公开社区 ChatPopout 类型](https://github.com/League-of-Foundry-Developers/foundry-vtt-types/blob/main/src/foundry/client/applications/sidebar/apps/chat-popout.d.mts)：构造选项、核心渲染委托和文档应用注册的补充依据；属于社区资料，未冒充官方实现源码。

不分发或复制 Foundry 的专有实现。没有运行时私有 API 依赖；如果未来公开 API 缺失，明确报不支持，不降级为不安全的 HTML 复制。

通过两版均公开的 `ApplicationV2.window` 中 `header`、`title`、`content`、`resize`、`controls`、`close` 元素引用添加局部样式类，压缩标题栏和对齐手柄。不替换核心 DOM 或事件处理器。0.1.4 使用浏览器 `ResizeObserver` 观察原卡片、窗口和标题栏的尺寸，使用 `MutationObserver` 跟踪核心替换卡片节点，并监听公开 `render` / `position` 事件。布局通知合并到下一动画帧，仅在目标高度或位置改变时调用 `setPosition`，避免尺寸反馈循环。高度由卡片、标题及边框实测值决定，并受视口与滚动上限约束；用户纵向调整改变长卡片的上限，短卡片仍持续贴合。最小化时跳过同步，恢复后重新测量；关闭时断开观察器、取消待执行帧并移除监听器。没有浏览器观察器的合约替身仍在渲染/位置事件及主动视口检查时测量。

## 通信及威胁模型

裸 `game.socket` 的自定义消息不提供本模块可独立认证的发送者证明；载荷里的 `gmId` / `senderId` 可由玩家自行填写。socketlib 也不能仅凭声明身份满足该要求，且引入额外依赖。因此采用 **核心原生 Document Socket 通道**，而非另建自定义 Socket 事件：GM 调用 `ChatMessage.update`，服务器按当前认证会话处理，客户端通过核心的更新生命周期接收。

`updateDocument` 官方签名把 `userId` 作为独立的更新发起用户参数。接收端从 `game.users.get(userId).isGM` 判定角色，载荷中没有用于认证的身份字段。这里信任的是 Foundry 核心已经处理完成的数据库事件和其发起会话身份，而不是玩家可写的 flags、options 或自定义 Socket 数据。可以更新自己消息的玩家仍然只能产生其自身发起身份的更新。攻击者在自己的浏览器直接调用本机 Hooks，或修改本机 JS，无法通过这种方式向其他客户端广播受信的核心事件。

接收必须同时满足：本次差异中明确改变 nonce、它与该时刻文档 flag 一致、发起用户是 GM、协议/字段合法、请求尚未过期、接收用户在名单且在线、没有重复处理、本机消息及内容均可见、保守的 whisper/blind 过滤通过。普通 GM 内容编辑不能激活玩家事先写入的 flag；初始化不扫描旧记录。同步验证发生在异步窗口操作前，避免第二次更新覆盖第一次的接收者名单。

数据形状：

```json
{
  "flags.directed-chat-popouts.request": {
    "protocol": 1,
    "nonce": "随机 UUID",
    "messageId": "消息 ID",
    "recipients": ["玩家 ID 或本次推送 GM 自己的 ID"],
    "issuedAt": 0
  }
}
```

`issuedAt` 实际为毫秒时间戳。仅最后一份记录留在消息上。通过核心服务器的请求顺序传播，不对自定义 Socket 做盲目信任。离线不排队、重连不重放，不承诺应用级确认/阅读回执；任何客户端都必须保持模组启用。实际服务器会话身份防伪仍列入实机测试清单，隔离测试不能验证专有服务器内部实现。

0.1.3 允许发起推送的 GM 勾选自己。接收策略中的 GM 身份例外必须与核心 Hook 的实际发起用户 `userId` 匹配，不能从载荷声明身份；列表不扩展到其他 GM。GM 自己仍须通过本机 `visible` / `isContentVisible` 校验；普通玩家继续受到原有 whisper/blind 过滤。GM 自己默认不选中，避免改变原有默认推送对象。

## PF2e 和现有模组

直接阅读 PF2e `v13-dev` 分支，调查时 `package.json` 版本为 **7.12.2**：

- [`ChatMessagePF2e.renderHTML`](https://github.com/foundryvtt/pf2e/blob/v13-dev/src/module/chat-message/document.ts#L201) 调用核心渲染并扩展系统内容；系统检定、法术、动作及能力走其消息渲染/富文本机制。
- [`renderChatPopout` Hook](https://github.com/foundryvtt/pf2e/blob/v13-dev/src/scripts/hooks/render-chat-popout.ts#L3) 把原生窗口传给系统处理器。
- [`ChatLogPF2e.onRenderChatPopout`](https://github.com/foundryvtt/pf2e/blob/v13-dev/src/module/apps/sidebar/chat-log.ts#L112) 在首次渲染把 `activate`、`applyDamage`、`applyEffect`、`findToken`、`revertDamage`、`recoverPersistentDamage`、`setAsInitiative`、`shieldBlock` 注册到弹窗的 actions。系统已提供这一绑定，模块不重复注册，避免一次点击触发两次伤害。
- 最初还读取了 PF2e `master` 的旧版 `getHTML` / `activateClickListener` 实现，发现事件确实有只在聊天栏绑定的历史；最终依据 v13 专用分支选择原生弹窗路径，未照搬旧方法到新系统。

PF2e 的内联 `@Check`、伤害和物品交互仍受 Actor 所有权、当前 Token 选择和系统权限限制。推送不会授予角色操作权限，不执行宏或重写系统骰子/规则。v14 仍需用支持该核心版本的 PF2e 发行版逐项实测。

研究的其他实现：

| 项目 | 读取依据 / 得到的启示 | 许可处理 |
| --- | --- | --- |
| [Requestor](https://github.com/krbz999/requestor) | `scripts/requestor.mjs:9-16,51-80` 将弹窗选项、whisper、按钮元数据放到消息；`scripts/appendButtonListeners.mjs:8-12` 给每次渲染的真实元素绑定按钮。它的 v12 发行版不是 v13/v14 兼容证据。 | MIT，仅研究，没有复制代码。 |
| [Sephral's Roll Requests](https://github.com/Sephral/sephrals-roll-requests) | `scripts/card.mjs:164-185` 在 `renderChatMessageHTML` 对当前消息元素绑定点击，避免把静态 HTML 当成功能卡片；权限留给其原有处理。 | 自定义 Sephral Free Module License 有再分发限制；未复制、捆绑、移植其代码或资源。 |

上述公开分支会变化，行号为调查时位置。第三方如果只在 `#chat-log` 的父节点委托点击、查找唯一原聊天卡片、只监听旧 Hook，原生弹窗也可能缺少其交互。没有通用而安全的事件转发方式，因此不合成点击、不搬动原卡片、不统一代理第三方事件；必须由其维护者提供正式弹窗绑定。
