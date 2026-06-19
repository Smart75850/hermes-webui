/**
 * Hermes Native UI — SSE Handler
 * 处理 Hermes WebUI 嘅 SSE 事件流 (chat/stream)
 *
 * 事件类型:
 *   token              → 流式文本 token
 *   reasoning          → 推理 token
 *   tool               → 工具调用
 *   interim_assistant  → 中间 assistant 消息
 *   done               → 流式完成
 *   error              → 错误
 */

export function connectChatStream(streamId, callbacks = {}) {
  const base = (location.hostname === '127.0.0.1' || location.hostname === 'localhost') ? '' : `http://127.0.0.1:${location.port}`;
  const url = `${base}/api/chat/stream?stream_id=${encodeURIComponent(streamId)}`;
  const source = new EventSource(url);

  let fullText = '';
  let toolCalls = [];
  let streamFinalized = false;  // ★ 防重入：done 之后忽略所有后续事件

  function guard(fn) {
    return (...args) => {
      if (streamFinalized) return;
      fn(...args);
    };
  }

  source.addEventListener('token', guard((e) => {
    try {
      const d = JSON.parse(e.data);
      fullText += d.text || '';
      callbacks.onToken?.(d.text, fullText);
    } catch (_) {}
  }));

  source.addEventListener('reasoning', guard((e) => {
    try {
      const d = JSON.parse(e.data);
      callbacks.onReasoning?.(d.text || '');
    } catch (_) {}
  }));

  source.addEventListener('tool', guard((e) => {
    try {
      const d = JSON.parse(e.data);
      if (d.name === 'clarify') return;
      const tc = {
        name: d.name,
        preview: d.preview || '',
        args: d.args || {},
        tid: d.tid || '',
        done: false,
        result: null,
      };
      toolCalls.push(tc);
      callbacks.onTool?.(tc);
    } catch (_) {}
  }));

  source.addEventListener('tool_complete', guard((e) => {
    try {
      const d = JSON.parse(e.data);
      const tc = toolCalls.find(t => t.tid === d.tid);
      if (tc) {
        tc.done = true;
        tc.result = d.result || d.preview || '';
        callbacks.onToolResult?.(tc);
      }
    } catch (_) {}
  }));

  source.addEventListener('interim_assistant', guard((e) => {
    try {
      const d = JSON.parse(e.data);
      callbacks.onInterim?.(d.text || '');
    } catch (_) {}
  }));

  source.addEventListener('done', (e) => {
    if (streamFinalized) return;  // ★ 双重保护
    streamFinalized = true;
    let data = {};
    try { data = JSON.parse(e.data); } catch (_) {}
    callbacks.onDone?.(fullText, toolCalls, data);
    source.close();
  });

  source.addEventListener('error', (e) => {
    if (streamFinalized) return;  // ★ done 之后的 error 忽略
    if (source.readyState === EventSource.CLOSED) {
      callbacks.onError?.('连接已关闭');
    } else {
      callbacks.onError?.('连接中断，重连中…');
    }
  });

  // 返回取消函数
  return {
    cancel() {
      source.close();
      callbacks.onCancel?.();
    },
    getFullText() { return fullText; },
    getToolCalls() { return toolCalls; },
  };
}
