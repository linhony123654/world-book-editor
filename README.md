# 世界书编辑器 (World Book Editor)

基于 Web 的 SillyTavern 世界书（World Info / Lorebook）可视化编辑器。支持多本世界书管理、JSON 导入导出、SQLite 自动保存、AI 流式对话修改世界书，以及按人物/地点/组织/规则等类型智能创建条目。

## 技术栈

- 前端：HTML + CSS + JavaScript ES Modules，无构建步骤
- 后端：Node.js + Express + better-sqlite3
- 数据库：SQLite，默认文件为 `world-books.db`
- AI 接口：OpenAI 兼容 Chat Completions API，支持流式 SSE 和工具调用
- 部署：pm2 管理，默认端口 `8084`

## 运行方式

```bash
cd world-book-editor
npm install
pm2 start server.js --name world-book-editor
```

访问：`http://localhost:8084`

开发时也可以直接运行：

```bash
node server.js
```

## 主要功能

### 世界书管理

- 多本世界书存储在 SQLite 中。
- 列出、搜索、新建、切换、删除世界书。
- 页面刷新后自动回到最后打开的世界书。
- 首次启动且数据库为空时自动导入 `sample.json`。

### 条目编辑

- 导入/导出 SillyTavern Lorebook JSON。
- 侧边栏按 UID 浏览条目，支持搜索和筛选。
- 编辑器覆盖常用字段和高级字段。
- 新建、删除、复制条目。
- 1.5 秒防抖自动保存，也支持手动保存。
- 撤销栈用于 AI 工具和部分破坏性操作回滚。

### AI 对话

- OpenAI 兼容接口配置，支持多 API 档案。
- 经本地 `/api/proxy/chat` 代理转发，避免第三方网关 CORS 问题。
- 支持原生 `tool_calls`，也兼容文本形式工具调用 fallback。
- 工具调用在界面中折叠显示，避免刷屏。
- 支持 DeepSeek 风格 `reasoning_content` 思考显示：流式期间展开，结束后自动收起。
- 支持 Markdown 渲染，包括正文和思考内容。
- 可在设置中配置“会话显示条数”，默认显示最近 10 个聊天元素，`0` 表示全部显示。

### AI 记忆

- 每本世界书单独保存 AI 操作记忆。
- 每回合记录自然语言摘要，避免把工具名或工具调用格式喂回模型。
- 每 10 回合自动整合为阶段总结。
- 记忆弹窗可查看近期记忆、阶段总结和工具明细。
- 记忆弹窗提供“模板”入口，可按世界书保存 AI 写作模板。
- “清空对话”和“清空记忆”相互独立。

### 智能写作

`plan_smart_entry` / `create_smart_entry` 工具会按世界书写作流程规划或创建条目：

- `plan_smart_entry`：生成预览弹窗，用户确认后才写入。
- `create_smart_entry`：直接创建，适合用户明确要求直接写入的场景。
- `get_writing_template`：读取当前世界书写作模板，供 AI 创建条目前参考。
- `update_writing_template`：让 AI 按你的自然语言要求微调当前世界书模板，可替换或追加指定标签。

- 判断语义类型：人物、地点、组织、阵营、事件、规则、物品、概念、关系、文风。
- 判断功能类型：关键词触发、常驻背景、递归补充、口吻约束、剧情钩子、隐藏设定、冲突修正。
- 支持 AI 自定义分类，例如“地下据点”“宫廷传闻”“禁术代价”。
- 支持 AI 自定义模板段落，例如“入口伪装”“交易规则”“隐藏风险”。
- `plan_smart_entry` / `create_smart_entry` 会自动读取当前世界书模板，AI 即使没先调用模板工具，也会用模板做兜底参考。
- 支持 AI 设置判断矩阵，例如触发方式、插入方式、递归角色、时效、随机性、影响强度、作用范围、匹配严格度。
- 根据类型推荐 `constant`、`position`、`depth`、`order` 等字段。
- 检查关键词过短、重复、缺失等触发风险。
- 类型信息写入兼容字段 `extensions.wbe`。

## 目录结构

```text
world-book-editor/
├── README.md
├── MODULES.md
├── server.js            # 后端：Express + SQLite + AI 代理
├── sample.json          # 首次启动导入的示例数据
├── package.json
├── scripts/
│   └── backup.js        # 数据库备份脚本
├── tests/               # node --test 单元测试
└── public/              # 前端静态文件（唯一对外暴露目录）
    ├── index.html
    ├── app.js
    ├── style.css
    ├── sw.js
    ├── manifest.json
    ├── icons/
    └── modules/
        ├── api.js
        ├── book-session.js
        ├── books.js
        ├── chat-view.js
        ├── chat.js
        ├── editor.js
        ├── memory-summary.js
        ├── reasoning.js
        ├── sidebar.js
        ├── state.js
        ├── tool-names.js
        ├── utils.js
        └── worldbook-intelligence/
```

> 安全说明：`server.js` 只对外暴露 `public/` 目录，后端源码、`package.json`、数据库均不可通过 HTTP 访问。

## 数据格式

基础格式保持 SillyTavern World Info JSON：

```json
{
  "entries": {
    "0": {
      "uid": 0,
      "key": ["关键词"],
      "content": "条目内容"
    }
  }
}
```

智能写作新增的编辑器元数据放在 `extensions.wbe`，用于保持酒馆兼容：

```json
{
  "extensions": {
    "wbe": {
      "semanticType": "location",
      "customType": "地下据点",
      "functionType": "plot_hook",
      "classificationReason": "展示给用户的分类理由",
      "templateSections": ["入口伪装", "隐藏风险"],
      "decision": {
        "activationMode": "keyword",
        "insertionMode": "depth",
        "recursionRole": "bridge",
        "persistence": "sticky",
        "priority": "high",
        "scope": "scene"
      }
    }
  }
}
```

## API 端点

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/books` | 列出所有世界书 |
| GET | `/api/books/:id` | 获取世界书详情 |
| POST | `/api/books` | 创建世界书 |
| PUT | `/api/books/:id` | 保存世界书 |
| DELETE | `/api/books/:id` | 删除世界书 |
| POST | `/api/proxy/models` | 代理拉取模型列表 |
| POST | `/api/proxy/chat` | 代理流式 Chat Completions |
| POST | `/api/test-tool` | 测试工具执行 |

## 测试与检查

项目没有打包步骤。修改后建议运行：

```bash
node --check server.js
node --check public/app.js
for f in public/modules/*.js public/modules/worldbook-intelligence/*.js; do node --check "$f" || exit 1; done
npm test
```

## 数据库备份

```bash
node scripts/backup.js
```

备份到 `backups/`（自动保留最近 14 份）。推荐用 cron 定时执行：

```
0 3 * * * cd /home/ubuntu/World\ Book\ Editor && /usr/bin/node scripts/backup.js >> backups/backup.log 2>&1
```

## 配置与本地存储

浏览器 `localStorage` 保存：

- `wbe-api-profiles`：AI 接口档案
- `wbe-api-active`：当前 AI 档案
- `wbe-last-book-id`：最后打开的世界书
- `wbe-chat-visible-limit`：会话显示条数
- `wbe-memory:<bookId>`：每本世界书的 AI 记忆
- `wbe-theme`：主题
- `wbe-autosave`：自动保存开关

API Key 只保存在浏览器本地，不写入数据库。

## 兼容性说明

- 导入时保留原始 JSON 结构。
- 编辑时直接修改条目对象，未编辑字段原样保留。
- 导出时写回完整 `worldBook`。
- 智能写作元数据放在 `extensions.wbe`，不会覆盖 SillyTavern 标准字段。
- DeepSeek 思考显示依赖上游返回 `reasoning_content` 或兼容字段；如果网关丢弃该字段，界面不会显示思考。
