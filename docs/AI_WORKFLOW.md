# AI 工作流

本文档说明 World Book Editor 的 AI 对话、工具调用、思考显示、记忆和智能写作流程。

## 目标

AI 对话不是单纯聊天，而是一个可操作世界书的编辑代理。它应该：

- 根据用户自然语言理解要做什么。
- 调用本地工具读取或修改世界书。
- 在多步操作中持续获得工具结果。
- 最终用简短自然语言说明完成情况。
- 把长期记忆保存为自然语言摘要，而不是保存工具调用格式。

## 请求构造

每次用户发送消息时，`chat.js` 会构造：

```text
system prompt
当前世界书名称和条目数
按书注入的记忆摘要
最近 chatMessages
当前用户消息
tools 定义
```

`chatMessages` 只保存用户消息和 AI 最终自然语言回复。工具记录不再作为隐藏文本附在历史里，避免模型模仿工具调用格式。

## 流式响应

`streamDisplay()` 会从 SSE 中解析：

- `delta.content`：正式回复文本。
- `delta.reasoning_content`：DeepSeek 风格思考。
- `delta.reasoning` / `delta.reasoning.content`：兼容字段。
- `delta.tool_calls`：OpenAI 兼容工具调用。

思考显示规则：

- 只显示上游显式返回的 reasoning 字段。
- 流式输出期间展开。
- 当前轮结束后自动收起。
- 支持 Markdown 渲染。
- 不写入后续模型上下文。

## 工具调用循环

AI 每一轮可能返回：

1. 正式文本，无工具调用：结束本回合。
2. 原生 `tool_calls`：执行工具，把结果作为 `tool` message 回填，再继续下一轮。
3. 文本工具调用格式：作为 fallback 解析并执行，再把结果作为用户消息回填。

最大轮数由 `MAX_ROUNDS` 控制，当前为 25。

## 工具结果展示

工具调用结果在界面中折叠成一个工具组：

```text
工具调用 3  最新结果摘要
```

展开后能看到每一步工具名和摘要。这样多工具操作不会把聊天页拉得过长。

## 记忆系统

记忆按世界书 ID 分开保存：

```text
wbe-memory:<bookId>
```

每回合结束后记录：

- 用户请求摘要。
- 工具操作的自然语言摘要。
- AI 最终回复摘要。
- 工具明细，供 UI 展开查看。

工具明细不会注入模型；模型只看到自然语言摘要。

每 10 个回合会触发一次阶段总结，把近期记忆压缩成长期记忆。阶段总结失败时不阻塞当前对话，下回合会重试。

## 为什么不保存工具调用格式

早期实现把类似下面的内容写回历史或记忆：

```text
search_entries: 找到 3 条
edit_entry: 已修改 #12
```

这会诱导模型在后续回复中输出伪工具调用，尤其是文本 fallback 会把这些格式误判为真实工具调用。

当前实现会转成自然语言：

```text
完成了 2 项操作：找到 3 条；已修改 #12。
```

## 智能写作工具

`plan_smart_entry` 和 `create_smart_entry` 是用于创建世界书条目的智能工具。

适用场景：

- 写一个人物。
- 写一个地点。
- 写一个组织。
- 写一个世界规则。
- 写一个剧情钩子。
- 写一个文风或口吻约束。

AI 还可以调用 `get_writing_template` 读取当前世界书的写作模板，或调用 `update_writing_template` 微调指定模板标签。模板由前端“记忆 > 模板”维护，按世界书保存。

复杂条目优先使用 `plan_smart_entry`：它只生成草稿并打开预览弹窗，不写入世界书。用户点击“确认创建”后，前端会把同一个草稿本地提交，避免预览和实际写入不一致。

预览草稿只保留当前最新的一份。用户确认、取消、点击遮罩关闭弹窗时都会清理 pending 草稿，避免后续误写入已经关闭的预览。

`create_smart_entry` 保留为直接创建工具，适合用户明确要求“直接创建”的场景。

即使 AI 没有先调用 `get_writing_template`，`plan_smart_entry` / `create_smart_entry` 也会自动读取当前世界书模板，并把通用模板、语义类型模板、剧情钩子模板合并为 `writingTemplate` 传入智能写作模块。

智能工具会调用 `worldbook-intelligence` 模块完成：

```text
用户请求
  ↓
读取本书写作模板
  ↓
语义类型 / 功能类型判断
  ↓
AI 自定义分类 customType
  ↓
模板段落生成
  ↓
AI 设置判断矩阵
  ↓
字段设置矩阵
  ↓
关键词风险检查
  ↓
创建条目
```

AI 可以传入：

- `customType`：自定义分类。
- `classificationReason`：展示给用户的分类理由。
- `templateSections`：自定义模板段落。
- `fieldHints`：覆盖推荐字段。
- `activationMode` / `insertionMode` / `recursionRole` / `persistence` / `randomness` / `priority` / `scope` / `matchStrictness`：高层设置判断。
- `reason`：展示给用户的设置判断理由。

这些信息会保存在条目的 `extensions.wbe` 中，便于后续 UI 展示或批量优化。

## 设置判断矩阵

为了避免 AI 直接裸写底层字段，智能写作先让 AI 判断高层意图，再由本地 `decision-matrix.js` 落成 SillyTavern 字段。

示例：

```json
{
  "activationMode": "keyword",
  "insertionMode": "depth",
  "recursionRole": "bridge",
  "persistence": "sticky",
  "randomness": "none",
  "priority": "high",
  "scope": "scene",
  "matchStrictness": "normal"
}
```

会映射为类似：

```json
{
  "constant": false,
  "position": 4,
  "depth": 4,
  "order": 280,
  "sticky": 3,
  "cooldown": 2,
  "preventRecursion": false
}
```

## 文本 fallback

部分网关不支持原生 `tool_calls`，模型可能输出文本工具调用格式。`parseTextToolCalls()` 会尝试解析：

- `<tool_use>{...}</tool_use>`
- `<tool_call><function=...>`
- `<function=...>`
- `{"name":"...","arguments":{...}}`
- `tool_name(...)`

这只是兼容层。优先使用原生 `tool_calls`。

## 会话显示条数

设置项 `wbe-chat-visible-limit` 只影响 DOM 显示：

- 默认 10。
- 0 表示全部显示。
- 不删除 `chatMessages`。
- 不影响模型上下文裁剪。

## 常见维护注意事项

- 新增 AI 工具时，要同时更新 `TOOL_NAMES`、`getTools()`、`executeTool()` 和文本 fallback 正则。
- 长期逻辑不要继续塞进 `chat.js`，优先拆出纯逻辑模块并加测试。
- 能进入模型上下文的内容必须避免工具调用格式污染。
- DeepSeek 思考只显示显式字段，不主动要求模型输出隐藏思维链。
- 智能写作的规则优先放到 `worldbook-intelligence/`，不要写死在工具函数里。
