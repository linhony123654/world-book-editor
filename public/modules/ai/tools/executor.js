// Tool execution boundary: registry-based dispatch + error isolation.
// This module deliberately knows nothing about DOM, world-book state, or persistence.

export function createToolExecutor({ handlers = {} } = {}) {
  const registry = new Map();
  for (const [name, handler] of Object.entries(handlers || {})) {
    if (!name || typeof handler !== 'function') continue;
    if (registry.has(name)) throw new Error('Duplicate tool handler: ' + name);
    registry.set(name, handler);
  }

  return async function executeTool(name, args = {}) {
    const handler = registry.get(name);
    if (!handler) return { summary: '未知工具', detail: 'Unknown tool: ' + name };
    return await handler(args == null ? {} : args);
  };
}

export function createSafeToolExecutor({
  executeTool,
  isMutating = () => false,
  beforeMutation = null,
  onError = null
} = {}) {
  if (typeof executeTool !== 'function') throw new TypeError('executeTool must be a function');

  return async function safeExecuteTool(name, args = {}) {
    // Preserve the existing semantic: the AI-turn rollback boundary is established
    // immediately before the first mutating tool, outside tool-level error isolation.
    if (isMutating(name) && typeof beforeMutation === 'function') {
      await beforeMutation(name, args);
    }

    try {
      return await executeTool(name, args);
    } catch (error) {
      if (typeof onError === 'function') onError(error, name, args);
      const message = error && error.message ? error.message : String(error);
      return {
        summary: name + ' 执行失败',
        detail: '工具 ' + name + ' 执行出错: ' + message
      };
    }
  };
}
