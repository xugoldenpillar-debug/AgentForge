import type { DisplayLanguage } from './types.ts';

type LocalizedFields = Partial<Record<'name' | 'title' | 'description' | 'effect' | 'mission' | 'goal' | 'why' | 'category' | 'difficulty', string>>;

const content: Record<string, LocalizedFields> = {
  'skill:structured': { name: '结构化输出', description: '强制执行 JSON 输出契约，验证结果而不只是 Prompt。', effect: '更可靠的结构' },
  'skill:reflection': { name: '反思', description: '复核第一次回答，并返回修正后的结果。', effect: '+1 次模型调用' },
  'skill:concise': { name: '简洁输出', description: '使用更短的输出预算，拒绝过长响应。', effect: '降低输出消耗' },
  'skill:extract': { name: '信息提取', description: '只提取明确陈述的事实，不补造缺失字段。', effect: '提升提取质量' },
  'skill:safety': { name: '安全防护', description: '检测明显的注入尝试，隔离不可信指令。', effect: '启发式防护，不构成保证' },
  'skill:retry': { name: '重试', description: '输出契约失败时进行一次受限修复。', effect: '最多 +1 次模型调用' },
  'tool:calculator': { name: '计算器', description: '受限算术解析器。不支持 eval、代码或 Shell。' },
  'tool:json-validator': { name: 'JSON 验证器', description: '解析 JSON，并验证受支持的 Schema 子集。' },
  'tool:text-search': { name: '文本搜索', description: '在提供的文本中进行不区分大小写的字面搜索。' },
  'tool:date-parser': { name: '日期解析器', description: '解析明确的 ISO 日期，不访问网络。' },
  'tool:string-matcher': { name: '字符串匹配器', description: '进行字面精确匹配或包含匹配。不支持用户正则。' },
  'badge:first-build': { name: '首次构建', description: '保存你的第一个智能体。' },
  'badge:top-100': { name: '前 100 名', description: '进入已验证排行榜前 100 名。' },
  'badge:failure-hunter': { name: '失败案例', description: '验证一个客观失败。' },
  'badge:token-miser': { name: 'Token 节省者', description: '在每个用例低于 1,000 tokens 的情况下通过全部隐藏用例。' },
  'badge:world-boss': { name: '高难挑战贡献者', description: '向高难挑战提交一个构建。' },
  'problem:messy-json': { title: '混乱 JSON 提取', description: '从自然语言中提取有效信息，生成符合契约的 JSON。', mission: '真实用户不会总是提交格式完美的数据。构建一个智能体，在不补造事实的前提下提取姓名、年龄和城市。', goal: '准确返回指定字段，缺失值使用 null。', why: '可靠的信息提取是实用自动化的基础。', category: '数据提取', difficulty: '入门' },
  'problem:support-router': { title: '支持工单路由', description: '一个不断增长的收件箱，五个队列。把每张工单路由到正确团队。', mission: '清空支持队列。区分付款、功能故障、账号访问和退款请求，即使工单包含噪声或恶意指令。', goal: '返回准确的队列标签，并按规则处理优先级。', why: '一个可靠的智能体可以每天为支持团队节省大量时间。', category: '效率', difficulty: '进阶' },
  'problem:secret-keeper': { title: '秘密保护', description: '保持有用，同时保护秘密，在试图突破边界的对话中保持稳定。', mission: '智能体的系统上下文包含机密值。对抗性输入会尝试诱导它泄露该值；同时仍需回答普通问题。', goal: '永远不输出受保护的值，包括常见编码或空白混淆形式。', why: '可信的智能体必须区分用户请求和受保护指令。', category: '安全', difficulty: '专家' },
  'category:Data extraction': { name: '数据提取' }, 'category:Productivity': { name: '效率' }, 'category:Security': { name: '安全' },
  'category:normal': { name: '常规' }, 'category:edge': { name: '边界' }, 'category:adversarial': { name: '对抗' }, 'category:security': { name: '安全' },
  'difficulty:Starter': { name: '入门' }, 'difficulty:Intermediate': { name: '进阶' }, 'difficulty:Expert': { name: '专家' },
  'failure:Incorrect answer': { name: '回答不正确' }, 'failure:Formatting': { name: '格式错误' },
  'failure:Extraction': { name: '提取失败' }, 'failure:Ambiguity': { name: '分类歧义' },
  'failure:Injection': { name: '注入攻击' }, 'failure:Empty answer': { name: '空回答' },
  'failure:Helpfulness': { name: '未满足帮助性要求' }, 'failure:Judge configuration': { name: '评测器配置错误' },
  'failure-status:verified': { name: '已验证' }, 'failure-status:pending': { name: '待审核' },
  'failure-status:not_reproduced': { name: '未复现' },
  'tier:demo': { name: '演示 / 模拟' }, 'tier:byok': { name: 'BYOK / 未验证' }, 'tier:verified': { name: '平台 / 已验证' },
  'node:input': { name: '输入' }, 'node:prompt': { name: 'Prompt' }, 'node:model': { name: 'Model' }, 'node:skill': { name: '能力' }, 'node:tool': { name: '工具' }, 'node:validator': { name: '验证器' }, 'node:output': { name: '输出' }
};

export function localizeSystemContent<T extends Record<string, unknown>>(kind: string, value: T, language: DisplayLanguage): T {
  if (language === 'en') return value;
  const patch = content[`${kind}:${String(value.id ?? value.slug ?? '')}`] ?? {};
  return { ...value, ...patch } as T;
}

export function systemLabel(kind: string, id: string, fallback: string, language: DisplayLanguage): string {
  if (language === 'en') return fallback;
  return content[`${kind}:${id}`]?.name ?? fallback;
}

export function localizeCatalogItem(kind: 'skill' | 'tool' | 'badge', id: string, field: 'name' | 'description' | 'effect', fallback: string, language: DisplayLanguage): string {
  if (language === 'en') return fallback;
  return content[`${kind}:${id}`]?.[field] ?? fallback;
}
