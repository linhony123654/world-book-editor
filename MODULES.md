# 模块说明

本文档面向维护者，说明 World Book Editor 的前端模块边界、数据流和 AI 工具链路。

## 总览

前端是原生 ES Modules，无构建步骤。`app.js` 是主入口，负责初始化各屏幕、绑定全局设置、协调模块。

```text
app.js
├── modules/utils.js
├── modules/state.js
├── modules/api.js
├── modules/sidebar.js
├── modules/editor.js
├── modules/books.js
├── modules/chat.js
├── modules/book-session.js
├── modules/chat-view.js
├── modules/writing-template.js
├── modules/smart-draft.js
├── modules/smart-draft-state.js
└── modules/worldbook-intelligence/
```

后端 `server.js` 提供静态文件、SQLite 世界书 API、AI 代理 API。

## 核心状态

### state.js

维护当前打开的世界书状态：

- `worldBook`
- `entries`
- `currentUid`
- `currentBookId`
- `dirty`
- `undoStack`

提供条目创建、UID 分配、应用世界书数据、撤销快照等基础能力。

### book-session.js

管理“最后打开的世界书”：

- `rememberLastBookId(bookId)`
- `readLastBookId()`
- `chooseInitialBookId(books)`

刷新页面时优先打开上次使用的世界书；如果该书已删除，则回退到列表第一本。

## 数据与 API

### api.js

负责前端到后端的世界书请求：

- `loadBookList`
- `loadBook`
- `createBook`
- `deleteBook`
- `renameBook`
- `importFile`
- `exportFile`
- `scheduleSave` / `autoSave`
- `updateSaveIndicator`

`loadBook()` 成功后会更新 `currentBookId`，并调用 `rememberLastBookId()`。

### server.js

后端职责：

- 静态服务当前目录。
- SQLite 表 `world_books` 管理多本世界书。
- `/api/books` CRUD。
- `/api/proxy/models` 代理模型列表。
- `/api/proxy/chat` 代理流式 Chat Completions。

## UI 模块

### sidebar.js

负责条目列表：

- 渲染条目摘要。
- 搜索与筛选。
- 选中条目。
- 移动端列表/编辑器 tab 切换。

### editor.js

负责条目编辑器：

- 标题、正文、主关键词、次关键词。
- 常用注入参数。
- 高级字段折叠区。
- 新建、删除、复制条目。

### books.js

负责 Archives 世界书管理页：

- 当前刊号展示。
- 世界书网格。
- 搜索、分页。
- 新建、切换、删除世界书。

### chat-view.js

负责聊天界面显示数量设置：

- `wbe-chat-visible-limit` 存在 localStorage。
- 默认显示最近 10 个聊天元素。
- `0` 表示显示全部。
- 只隐藏 DOM 中的旧消息，不删除 `chatMessages` 历史。

## AI 对话模块

### chat.js

负责 AI 对话编排：

- 输入发送。
- 流式 SSE 解析。
- DeepSeek 思考显示。
- 工具调用循环。
- 工具调用结果展示。
- 文本工具调用 fallback。
- 分层记忆入口。
- 调用世界书操作工具。

`chat.js` 仍然偏大，新增复杂逻辑时优先拆到独立模块，再由 `chat.js` 编排调用。

### reasoning.js

负责显式思考字段处理：

- `reasoning_content`
- `reasoning`
- `reasoning.content`

思考显示规则：

- 流式输出期间展开。
- 当前轮结束后自动收起。
- 支持 Markdown 渲染。
- 不写入 `chatMessages` 历史，避免污染后续上下文。

### memory-summary.js

负责把工具执行 trace 转成自然语言记忆摘要。

目的：避免把 `search_entries(...)`、`<tool_call>`、工具名列表等格式回灌给模型，减少模型“假装调用工具”的概率。

### smart-draft.js / smart-draft-state.js

`smart-draft.js` 负责把智能条目草稿渲染为预览行，并把已确认的草稿确定性写入条目对象。

`smart-draft-state.js` 负责预览弹窗的临时状态：同一时间只保留最新草稿；确认、取消或关闭弹窗都会清理 pending 草稿，避免用户关闭预览后误提交旧草稿。

### writing-template.js

负责当前世界书的 AI 写作模板：

- `wbe-writing-template:<bookId>` 按书保存。
- 前端模板弹窗读写它。
- `get_writing_template` 工具读取它。
- `update_writing_template` 工具按标签替换或追加它。
- `plan_smart_entry` / `create_smart_entry` 自动选择通用模板、语义类型模板和剧情钩子模板作为智能写作参考。

## AI 工具链路

`chat.js` 中的工具调用流程：

```text
用户输入
  ↓
构造 system + chatMessages + 记忆注入
  ↓
调用 /api/proxy/chat
  ↓
streamDisplay 解析 content / reasoning / tool_calls
  ↓
executeTool 执行本地工具
  ↓
工具结果回填 messages
  ↓
模型继续下一轮，直到给出最终回复
  ↓
保存最终回复和自然语言记忆摘要
```

工具结果只在本回合 `messages` 中反馈给模型。长期记忆保存的是自然语言摘要，不保存可模仿的工具调用格式。

## 智能写作模块

目录：`modules/worldbook-intelligence/`

### index.js

对外入口：`planWorldbookEntry(input)`。

输入可以包含：

- `userRequest`
- `title`
- `semanticType`
- `customType`
- `functionType`
- `classificationReason`
- `templateSections`
- `fieldHints`
- `content`
- `writingTemplate`
- `key`
- `constant`
- `entries`

输出包含：

- 类型判断
- 标题
- 正文草稿
- 模板段落
- 字段建议
- 触发风险检查

### taxonomy.js

固定类型底座：

- 语义类型：人物、地点、组织、阵营、事件、规则、物品、概念、关系、文风。
- 功能类型：关键词触发、常驻背景、递归补充、口吻约束、剧情钩子、隐藏设定、冲突修正。

AI 可以通过 `customType` 生成更贴合本书的自定义分类。

### intent.js

根据用户请求推断：

- `semanticType`
- `functionType`
- `title`
- 默认关键词

### templates.js

生成条目正文结构：

- 内置模板按语义类型选择。
- 如果 AI 提供 `templateSections`，优先使用自定义模板段落。

### settings-matrix.js

根据语义类型 + 功能类型推荐字段：

- `constant`
- `selective`
- `position`
- `depth`
- `order`
- `probability`

AI 可以通过 `fieldHints` 覆盖推荐值。

### decision-matrix.js

把 AI 的高层设置判断落成 SillyTavern 字段。高层判断包括：

- `activationMode`：常驻、关键词、选择性、递归、手动。
- `insertionMode`：背景、@D 深度、示例、作者注释、出口。
- `recursionRole`：入口、中继、终点、隔离、延迟递归。
- `persistence`：无、sticky、cooldown、delay。
- `randomness`：无、少见、偶尔、分组权重。
- `priority`：低、普通、高、关键。
- `scope`：全局、人物、场景、剧情、风格、安全。
- `matchStrictness`：宽松、普通、严格、精确。

AI 负责判断这些高层维度，本地矩阵负责转换为 `constant`、`position`、`depth`、`order`、递归开关、时效字段等底层字段。

### trigger-safety.js

检查关键词风险：

- 过短关键词。
- 重复关键词。
- 缺少关键词。
- 无明显风险。

## 本地存储 Key

```text
wbe-api-profiles
wbe-api-active
wbe-api-url
wbe-api-key
wbe-model
wbe-system-prompt
wbe-last-book-id
wbe-chat-visible-limit
wbe-writing-template:<bookId>
wbe-memory:<bookId>
wbe-theme
wbe-autosave
```

## 测试

测试位于 `tests/*.test.mjs`。当前覆盖：

- 最后打开世界书选择。
- 聊天显示条数。
- AI 写作模板保存、选择和工具输出格式。
- 工具 trace 自然语言摘要。
- DeepSeek 思考字段解析与折叠规则。
- 智能条目草稿渲染、写入和 pending 状态清理。
- 智能写作规划。

运行：

```bash
node --test tests/*.test.mjs
```

语法检查：

```bash
node --check server.js
node --check app.js
for f in modules/*.js modules/worldbook-intelligence/*.js; do node --check "$f" || exit 1; done
```
