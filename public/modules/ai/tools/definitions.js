import { TOOL_NAMES } from '../../tool-names.js';

// Static OpenAI-compatible tool schemas. This module must stay free of DOM and conversation state.
// ===== AI 工具定义 =====
export function buildToolsList() {
  return [
    {
      type: 'function',
      function: {
        name: 'search_entries',
        description: '搜索世界书条目。返回匹配的条目列表；可带语义类型筛选，或要求返回完整正文以便跨条目编辑。',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索关键词（匹配标题、关键词、内容）；为空则匹配筛选条件下的全部' },
            filter: { type: 'string', enum: ['all','constant','keyword','disabled'], description: '筛选类型' },
            type: { type: 'string', enum: ['character','location','geography','organization','faction','law','history','economy','magic','culture','event','rule','item','concept','relationship','style'], description: '按语义类型筛选（智能写作分类），如 law=法律、magic=超凡体系；也匹配 AI 自定义分类' },
            includeContent: { type: 'boolean', description: '是否返回每条匹配条目的完整正文（批量编辑前查看用）；默认 false 只返回标题列表' }
          },
          required: []
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_entry',
        description: '获取指定 UID 的条目完整信息',
        parameters: {
          type: 'object',
          properties: {
            uid: { type: 'number', description: '条目 UID' }
          },
          required: ['uid']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'edit_entry',
        description: '整字段覆盖式修改条目：传入的每个字段会被整体替换为新值（只传要改的字段）。适合换标题、整体重写某字段、改 enabled/position 等。若只是改长正文里的个别词句，请改用 replace_text 做查找替换，不要用本工具整段重写。',
        parameters: {
          type: 'object',
          properties: {
            uid: { type: 'number', description: '条目 UID' },
            fields: { type: 'object', description: '要修改的字段键值对' }
          },
          required: ['uid', 'fields']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'add_entry',
        description: '新建一个基础条目。若用户要你按人物/地点/组织/规则等类型写世界书，优先使用 create_smart_entry。',
        parameters: {
          type: 'object',
          properties: {
            comment: { type: 'string', description: '标题' },
            content: { type: 'string', description: '内容' },
            key: { type: 'array', items: { type: 'string' }, description: '触发关键词' },
            constant: { type: 'boolean', description: '是否常驻激活，默认 false' },
            semanticType: { type: 'string', description: '可选：人物/地点/组织/规则等语义类型' },
            functionType: { type: 'string', description: '可选：关键词触发/常驻背景等功能类型' }
          },
          required: ['content']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_writing_template',
        description: '读取当前世界书的写作模板。创建智能条目前可调用它参考本书偏好的正文结构、段落和禁忌。',
        parameters: {
          type: 'object',
          properties: {
            semanticType: { type: 'string', enum: ['character','location','organization','faction','event','rule','item','concept','relationship','style'], description: '可选：条目语义类型，用于筛选人物/地点/组织/规则模板' },
            functionType: { type: 'string', enum: ['keyword_trigger','constant_background','recursive_detail','voice_constraint','plot_hook','hidden_fact','conflict_fix'], description: '可选：条目功能类型，用于附加剧情钩子等模板' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'update_writing_template',
        description: '修改当前世界书的 AI 写作占位模板。用于用户要求微调模板时，例如“把地点模板写得更细”“给剧情钩子模板增加触发条件”。只传需要修改的标签；mode=append 表示追加，默认 replace 表示替换对应标签。不要用它写正式世界书条目正文。',
        parameters: {
          type: 'object',
          properties: {
            mode: { type: 'string', enum: ['replace','append'], description: 'replace 替换指定标签；append 追加到指定标签末尾。默认 replace。' },
            general: { type: 'string', description: '通用占位模板，如“世界观核心：根据用户输入描述当前世界观，约150字”。' },
            character: { type: 'string', description: '人物占位模板。' },
            location: { type: 'string', description: '地点占位模板。' },
            organization: { type: 'string', description: '组织占位模板。' },
            rule: { type: 'string', description: '规则占位模板。' },
            plot_hook: { type: 'string', description: '剧情钩子占位模板。' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'plan_smart_entry',
        description: '生成智能世界书条目草稿并打开预览弹窗，不写入世界书。调用本工具后你会停止当前回合，等待用户在预览弹窗中确认或取消；用户确认后条目由前端写入。禁止在本回合继续调用 create_smart_entry 或其他工具，也不要假装条目已创建。复杂条目、递归条目、剧情钩子、隐藏设定优先用这个工具。',
        parameters: smartEntryParameters()
      }
    },
    {
      type: 'function',
      function: {
        name: 'create_smart_entry',
        description: '直接创建智能世界书条目并写入数据库。除非用户明确要求直接创建，否则复杂条目优先使用 plan_smart_entry 让用户预览确认。',
        parameters: smartEntryParameters()
      }
    },
    {
      type: 'function',
      function: {
        name: 'add_entries',
        description: '批量新建多个条目，一次传入一个数组。比逐条 add_entry 高效。',
        parameters: {
          type: 'object',
          properties: {
            entries: {
              type: 'array',
              description: '要新建的条目数组',
              items: {
                type: 'object',
                properties: {
                  comment: { type: 'string', description: '标题' },
                  content: { type: 'string', description: '内容' },
                  key: { type: 'array', items: { type: 'string' }, description: '触发关键词' },
                  constant: { type: 'boolean', description: '是否常驻激活，默认 false' }
                },
                required: ['content']
              }
            }
          },
          required: ['entries']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'delete_entry',
        description: '删除指定 UID 的条目',
        parameters: {
          type: 'object',
          properties: {
            uid: { type: 'number', description: '条目 UID' }
          },
          required: ['uid']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'delete_entries',
        description: '批量删除条目。二选一：传 uids 数组按 UID 删，或传 filter 按条件删。',
        parameters: {
          type: 'object',
          properties: {
            uids: { type: 'array', items: { type: 'number' }, description: '要删除的 UID 列表' },
            filter: { type: 'object', description: '筛选条件：constant(bool)、disable(bool)、uid_range([min,max])、query(关键词，匹配标题/关键词/内容)' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'batch_edit',
        description: '批量修改条目。按条件筛选后统一更新字段。',
        parameters: {
          type: 'object',
          properties: {
            filter: { type: 'object', description: '筛选条件：可含 constant(bool)、disable(bool)、uid_range([min,max])、query(关键词，匹配标题/关键词/内容)' },
            fields: { type: 'object', description: '要修改的字段键值对' }
          },
          required: ['filter', 'fields']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'list_entries',
        description: '列出条目概览（仅 UID + 标题 + 状态，不含内容）。用于快速了解世界书全貌，比逐条搜索更省。',
        parameters: {
          type: 'object',
          properties: {
            filter: { type: 'string', enum: ['all','constant','keyword','disabled'], description: '筛选类型，默认 all' },
            limit: { type: 'number', description: '最多返回多少条，默认 100' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'toggle_entry',
        description: '启用或禁用条目',
        parameters: {
          type: 'object',
          properties: {
            uid: { type: 'number', description: '条目 UID' },
            disable: { type: 'boolean', description: 'true=禁用，false=启用；不传则切换当前状态' }
          },
          required: ['uid']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'reorder_entry',
        description: '修改条目的 order（插入顺序，数字越小越靠前）',
        parameters: {
          type: 'object',
          properties: {
            uid: { type: 'number', description: '条目 UID' },
            order: { type: 'number', description: '新的 order 值' }
          },
          required: ['uid', 'order']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'duplicate_entry',
        description: '复制一个已有条目，生成新 UID 的副本',
        parameters: {
          type: 'object',
          properties: {
            uid: { type: 'number', description: '要复制的条目 UID' }
          },
          required: ['uid']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'merge_entries',
        description: '把两条或多条条目合并为一条：正文拼接、关键词取并集，其他字段取第一条的。用于清理重复设定。',
        parameters: {
          type: 'object',
          properties: {
            uids: { type: 'array', items: { type: 'number' }, description: '要合并的条目 UID 数组（2 条以上，至少 2 条）' },
            keep: { type: 'number', description: '保留哪个 UID（默认保留第一个），其余条目删除' }
          },
          required: ['uids']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'split_entry',
        description: '把一条大条目拆分成多条独立条目（如把大人物卡拆成设定+剧情钩子两条）。parts 至少 2 个。',
        parameters: {
          type: 'object',
          properties: {
            uid: { type: 'number', description: '要拆分的条目 UID' },
            parts: { type: 'array', items: { type: 'object', properties: { comment: { type: 'string', description: '新条目标题' }, content: { type: 'string', description: '新条目正文' } }, required: ['comment','content'] }, description: '拆分后的条目列表（至少 2 个），原条目被删除' }
          },
          required: ['uid', 'parts']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'check_entries',
        description: '全书体检：检查永不触发（无关键词且非常驻）、关键词过短/重复冲突、空正文、标题重复等质量问题。返回问题清单。',
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'find_duplicates',
        description: '查重：按标题相同/互相包含、关键词重叠(≥2)、正文开头相同找出疑似重复条目对，返回 UID 与相似原因。发现后可用 merge_entries 合并确认的重复项，或 edit_entry 调整。只读不修改。',
        parameters: {
          type: 'object',
          properties: {
            limit: { type: 'number', description: '最多返回的重复组数（默认 10，最大 20）' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'test_triggers',
        description: '触发预演：给一段场景文本，模拟 SillyTavern 世界书触发逻辑，返回会命中哪些条目（常驻恒命中、关键词子串匹配），按注入顺序排列。检查世界书是否按预期工作。',
        parameters: {
          type: 'object',
          properties: {
            text: { type: 'string', description: '要测试的场景文本（如一段角色对话或场景描述）' }
          },
          required: ['text']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'export_book',
        description: '把当前世界书导出为 SillyTavern 兼容 JSON 文件并触发下载。',
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'web_search',
        description: '联网搜索现实资料（历史、地理、文化、法律等），供创作设定时参考。搜索结果可能不准，需甄别后使用；适合查真实世界知识，不适合查世界书内部内容。',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: '搜索词，如“唐朝宵禁制度”' },
            limit: { type: 'integer', minimum: 1, maximum: 5, description: '返回条数，默认 3' }
          },
          required: ['query']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'cleanup_book',
        description: '对当前世界书做全面体检并输出整改计划。本地执行全书检查（空正文/永不触发/关键词过短或冲突/标题重复），然后你必须输出逐项整改计划（条目、问题、建议处理方式：补全/合并/补关键词/删除），等待用户确认后再执行修改。输出计划前禁止调用任何修改类工具（edit/delete/merge/batch_edit 等）。用户要求“整理/体检/看看这本书有什么问题”时调用。',
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'undo_last',
        description: '撤销对世界书的修改（新增/删除/编辑/批量/复制等），恢复到操作前的状态；steps 大于 1 时一次回退多步',
        parameters: {
          type: 'object',
          properties: {
            steps: { type: 'integer', minimum: 1, maximum: 10, description: '回退步数，默认 1' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'get_book_info',
        description: '获取当前世界书概览：书名、条目数、常驻/关键词/禁用分布、各语义类型条目数。规划编辑前先调用一次。',
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'list_books',
        description: '列出数据库里所有世界书（ID、书名、条目数），并标出当前打开的是哪一本',
        parameters: { type: 'object', properties: {} }
      }
    },
    {
      type: 'function',
      function: {
        name: 'switch_book',
        description: '切换到另一本世界书并打开它。可用 id 或 name 指定（name 支持模糊匹配）。',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'number', description: '目标世界书 ID（优先）' },
            name: { type: 'string', description: '目标世界书名称（id 未提供时按名称匹配）' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'create_book',
        description: '新建一本空白世界书并切换过去',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '新世界书名称，默认「新世界书」' }
          }
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'rename_book',
        description: '重命名世界书。不传 id 则重命名当前打开的这一本。',
        parameters: {
          type: 'object',
          properties: {
            name: { type: 'string', description: '新名称' },
            id: { type: 'number', description: '目标世界书 ID，省略则为当前世界书' }
          },
          required: ['name']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'replace_text',
        description: '在条目里做查找替换，免去整段重写。默认对全书所有条目的正文(content)替换；' +
          '可传 uid 只改一条，或传 filter 缩小范围。默认按字面匹配，可开 regex 用正则。带撤销。',
        parameters: {
          type: 'object',
          properties: {
            find: { type: 'string', description: '要查找的文本（regex=true 时为正则表达式）' },
            replace: { type: 'string', description: '替换成的文本（regex 模式下可用 $1 等捕获组），删除则传空字符串' },
            fields: { type: 'array', items: { type: 'string', enum: ['content', 'comment', 'key'] }, description: '在哪些字段替换，默认 ["content"]。key 为关键词数组。' },
            uid: { type: 'number', description: '只在该 UID 条目内替换' },
            filter: { type: 'object', description: '缩小范围：{constant:bool, disable:bool, uid_range:[min,max], query:"关键字"}，与 uid 二选一' },
            regex: { type: 'boolean', description: '是否把 find 当正则，默认 false' },
            ignore_case: { type: 'boolean', description: '是否忽略大小写，默认 false' }
          },
          required: ['find', 'replace']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'manage_keys',
        description: '增删某条目的关键词，不用整条覆盖。add/remove 为字符串数组；secondary=true 时操作次要关键词(keysecondary)。带撤销。',
        parameters: {
          type: 'object',
          properties: {
            uid: { type: 'number', description: '目标条目 UID' },
            add: { type: 'array', items: { type: 'string' }, description: '要新增的关键词（已存在的自动跳过）' },
            remove: { type: 'array', items: { type: 'string' }, description: '要删除的关键词' },
            secondary: { type: 'boolean', description: 'true 则操作次要关键词 keysecondary，默认操作主关键词 key' }
          },
          required: ['uid']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'move_entry',
        description: '设置条目的插入位置 position（reorder_entry 只改 order 数值，这个改位置类型）。' +
          'position: 0=角色定义前, 1=角色定义后, 2=作者注释前, 3=作者注释后, 4=@深度(配合 depth)。',
        parameters: {
          type: 'object',
          properties: {
            uid: { type: 'number', description: '目标条目 UID' },
            position: { type: 'number', description: '位置类型 0~4，见说明' },
            depth: { type: 'number', description: '当 position=4 时的注入深度，默认 4' }
          },
          required: ['uid', 'position']
        }
      }
    },
    {
      type: 'function',
      function: {
        name: 'delete_book',
        description: '删除整本世界书（不可恢复！）。不传 id 则删当前打开的这本。安全起见必须显式传 confirm:true 才真正删除。',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'number', description: '目标世界书 ID，省略则为当前打开的这本' },
            name: { type: 'string', description: '按名称指定（id 未提供时模糊匹配）' },
            confirm: { type: 'boolean', description: '必须为 true 才执行删除，否则只返回待确认提示' }
          }
        }
      }
    }
  ];
}

// 工具定义是纯静态的：模块级缓存一次，避免每轮请求重建 29 个对象
const TOOLS_CACHE = buildToolsList();
export function getTools() { return TOOLS_CACHE; }

// 开发期一致性校验：工具定义与名单单一来源保持一致
{
  const missing = TOOLS_CACHE.filter(t => !TOOL_NAMES.includes(t.function.name)).map(t => t.function.name);
  if (missing.length) console.warn('[WBE] getTools 存在名单外的工具名:', missing.join(', '));
}

export function smartEntryParameters() {
  return {
    type: 'object',
    properties: {
      userRequest: { type: 'string', description: '用户原始需求，用于判断条目类型与功能' },
      title: { type: 'string', description: '条目标题；不传则从 userRequest 推断' },
      semanticType: { type: 'string', enum: ['character','profession','location','geography','organization','faction','law','history','economy','magic','culture','event','rule','item','concept','relationship','style'], description: '语义类型：character 人物 / profession 职业设定(空姐、警察、医生等，写职业本身而非具体个人) / location 具体地点 / geography 地理地貌 / organization 组织 / faction 阵营 / law 法律制度 / history 历史沿革 / economy 经济贸易 / magic 超凡体系(魔法科技) / culture 文化习俗信仰 / event 事件 / rule 通用规则 / item 物品 / concept 概念 / relationship 关系 / style 文风。不确定可不传' },
      customType: { type: 'string', description: 'AI 自定义分类，如“地下据点”“宫廷传闻”“禁术代价”“边境黑市”等' },
      functionType: { type: 'string', enum: ['keyword_trigger','constant_background','recursive_detail','voice_constraint','plot_hook','hidden_fact','conflict_fix'], description: '功能类型，不确定可不传' },
      classificationReason: { type: 'string', description: '简短说明为什么这样分类。展示给用户作为可审计理由，不要写隐藏思维链。' },
      templateSections: { type: 'array', items: { type: 'string' }, description: '自定义模板段落标题，如“入口伪装”“内部气味与陈设”“交易规则”“隐藏风险”。只给标题不等于写正文；正文必须放在 content。' },
      fieldHints: {
        type: 'object',
        description: '字段设置建议，可覆盖矩阵推荐。允许 constant/selective/position/depth/order/probability/sticky/cooldown/delay 等。'
      },
      activationMode: { type: 'string', enum: ['always','keyword','selective','recursive','manual'], description: '高层触发判断。' },
      insertionMode: { type: 'string', enum: ['lore','depth','example','author_note','outlet'], description: '高层插入位置判断。' },
      recursionRole: { type: 'string', enum: ['none','entry','bridge','terminal','isolated','delayed'], description: '递归角色。' },
      persistence: { type: 'string', enum: ['none','sticky','cooldown','delayed'], description: '时效判断。' },
      randomness: { type: 'string', enum: ['none','rare','occasional','weighted'], description: '随机性判断。' },
      priority: { type: 'string', enum: ['low','normal','high','critical'], description: '影响强度。' },
      scope: { type: 'string', enum: ['global','character','scene','plot','style','safety'], description: '作用范围。' },
      matchStrictness: { type: 'string', enum: ['loose','normal','strict','exact'], description: '匹配严格度。' },
      reason: { type: 'string', description: '设置判断理由，展示给用户。' },
      relatedEntries: { type: 'array', items: { type: 'object', properties: { name: { type: 'string', description: '关联词条名称（正文中提到的具体地点/建筑/组织/人物/物品）' }, type: { type: 'string', description: '建议类型：location/profession/organization/character/item/law 等' }, note: { type: 'string', description: '为什么值得单独建条（一句话）' } }, required: ['name'] }, description: '关联词条：正文涉及的具体地点/建筑/部门/人物，若值得单独建条则列出。工具会检查是否已有同名条目，没有的会提示用户考虑创建。' },
      content: { type: 'string', description: '完整可写入的世界书正文草稿——它是注入给扮演 AI 的设定片段，不是给用户看的文章：直接陈述设定事实、信息密度高、按段落组织；篇幅按复杂度：小条目 80–300 字，主要人物/组织/规则等大卡可 500 字以上，完整优先。严禁只给框架/段落标题/“需要写成…”等指令占位；缺失段落会自动补全。' },
      key: { type: 'array', items: { type: 'string' }, description: '触发关键词：书里会出现的人名/地名/物品/概念等具体词，2–6 个，避免“他”“王城”等过泛词；不传则按标题/类型推断' },
      constant: { type: 'boolean', description: '强制常驻设置（常驻用于始终生效的规则/口吻）；不传则按矩阵推荐' }
    },
    required: ['userRequest', 'content']
  };
}
