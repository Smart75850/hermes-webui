/**
 * Hermes Native UI — API Client
 * 直连 Hermes WebUI 后端 (端口 8788)
 */

// 自动检测：如果用 Hermes WebUI 同源，用相对路径；否则用完整 URL
const API_BASE = (location.hostname === '127.0.0.1' && location.port === '8788')
  ? ''  // 同源，冇 CORS 问题
  : 'http://127.0.0.1:8788';

async function api(path, opts = {}) {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

export const HermesAPI = {
  // ── Sessions ──
  async listSessions() {
    const data = await api('/api/sessions');
    return data.sessions || [];
  },

  async getSession(sessionId, messageLimit = 0) {
    const params = new URLSearchParams({ session_id: sessionId, messages: String(messageLimit), resolve_model: '0' });
    return api(`/api/session?${params}`);
  },

  async createSession(opts = {}) {
    return api('/api/session/new', {
      method: 'POST',
      body: JSON.stringify({
        workspace: opts.workspace || '/Users/apple/workspace',
        profile: opts.profile || 'default',
        ...opts,
      }),
    });
  },

  async deleteSession(sessionId) {
    return api('/api/session/delete', {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId }),
    });
  },

  async renameSession(sessionId, title) {
    return api('/api/session/rename', {
      method: 'POST',
      body: JSON.stringify({ session_id: sessionId, title }),
    });
  },

  // ── Chat ──
  async chatStart(sessionId, message, opts = {}) {
    return api('/api/chat/start', {
      method: 'POST',
      body: JSON.stringify({
        session_id: sessionId,
        message,
        model: 'deepseek-v4-pro',
        workspace: '/Users/apple/workspace',
        ...opts,
      }),
    });
  },

  async chatCancel(streamId) {
    return api('/api/chat/cancel', {
      method: 'POST',
      body: JSON.stringify({ stream_id: streamId }),
    });
  },

  async chatStreamStatus(streamId) {
    return api(`/api/chat/stream/status?stream_id=${encodeURIComponent(streamId)}`);
  },

  // ── Memory (from memory_server.py on port 8791) ──
  async getMemoryGraph() {
    const res = await fetch('http://127.0.0.1:8791/api/memory/graph');
    return res.json();
  },

  async getFocusStack() {
    const res = await fetch('http://127.0.0.1:8791/api/memory/focus');
    return res.json();
  },

  async searchMemory(query, limit = 20) {
    const res = await fetch(`http://127.0.0.1:8791/api/memory/search?q=${encodeURIComponent(query)}&limit=${limit}`);
    return res.json();
  },

  // ── Cron + Workspace (from memory_server.py :8791) ──
  async getCronJobs() {
    const res = await fetch('http://127.0.0.1:8791/api/cron');
    return res.json();
  },
  async getWorkspace(subpath = '') {
    const res = await fetch(`http://127.0.0.1:8791/api/workspace?path=${encodeURIComponent(subpath)}`);
    return res.json();
  },
  async getKanban() {
    const res = await fetch('http://127.0.0.1:8791/api/kanban');
    return res.json();
  },

  async getMemory() {
    const data = await api('/api/memory');
    return data.memory || '';
  },

  // ── Config ──
  async getConfig() {
    return api('/api/session?session_id=latest&messages=0&resolve_model=1');
  },

  // ── SSE stream URL ──
  streamUrl(streamId) {
    return `${API_BASE}/api/chat/stream?stream_id=${encodeURIComponent(streamId)}`;
  },
};

export { API_BASE };
