/**
 * Hermes Native UI — API Client
 * 直连 Hermes WebUI 后端
 * API_BASE 动态检测，唔再写死端口
 */

// 自动检测当前端口，同源用相对路径（避免 CORS + Service Worker 缓存）
const API_BASE = (location.hostname === '127.0.0.1' || location.hostname === 'localhost')
  ? ''  // 同源：相对路径，自动跟当前端口
  : `http://127.0.0.1:${location.port}`;

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
    const data = await api(`/api/session?${params}`);
    // Normalize: API returns {session: {...}}, normalize to flat object
    return data.session || data;
  },

  async createSession(opts = {}) {
    const data = await api('/api/session/new', {
      method: 'POST',
      body: JSON.stringify({
        workspace: opts.workspace || '/Users/apple/workspace',
        profile: opts.profile || 'default',
        ...opts,
      }),
    });
    // Normalize: API returns {session: {session_id, ...}}, normalize to {session_id, ...}
    return data.session || data;
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

  // ── Memory Bridge (port 8791) — 经 fetch 直连，优雅降级 ──
  async _fetchMemory(path) {
    try {
      const res = await fetch(`http://127.0.0.1:8791${path}`);
      return res.ok ? res.json() : null;
    } catch { return null; }
  },
  async getMemoryGraph()    { return this._fetchMemory('/api/memory/graph') || { nodes: [], links: [] }; },
  async getFocusStack()     { return this._fetchMemory('/api/memory/focus') || { focus: [], stack: [] }; },
  async searchMemory(q, n)  { return this._fetchMemory(`/api/memory/search?q=${encodeURIComponent(q)}&limit=${n||20}`) || []; },
  async getCronJobs()       { return this._fetchMemory('/api/cron') || []; },
  async getWorkspace(p)     { return this._fetchMemory(`/api/workspace?path=${encodeURIComponent(p||'')}`) || { entries: [] }; },
  async getKanban()         { return this._fetchMemory('/api/kanban') || { todo:[], in_progress:[], done:[] }; },

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
