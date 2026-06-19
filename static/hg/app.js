/**
 * Hermes Native UI — 主应用入口
 * Phase 2: 接入真实 Hermes Agent 数据
 */

import { HermesAPI } from './api.js';
import { connectChatStream } from './sse.js';
import { initVoicePanel } from './voice.js';
import { initACUI, mountCard } from './acui/renderer.js';
import { t, getLang, setLang } from './i18n.js';

// ═══════════════════════════════════════════════════════════════
// 配置常量
// ═══════════════════════════════════════════════════════════════
const CONFIG = {
  API_BASE: `http://127.0.0.1:${location.port}`,
  THEME_KEY: 'hermes-ui-theme',
  GRAPH_TOGGLE_KEY: 'hermes-graph-visible',
  DEFAULT_THEME: 'midnight',
  MAX_CHAT_HISTORY: 60,
};

// ═══════════════════════════════════════════════════════════════
// 全局状态
// ═══════════════════════════════════════════════════════════════
let activeSessionId = null;
// ═══ Per-Session 状态隔离 ═══
// 每个 session 有独立嘅 stream/发送锁/停止掣
// key = session_id, value = { stream, streamId, stopHandler, isSending }
const sessionStates = new Map();
// 按钮 DOM 上当前注册嘅 stopHandler（独立于 per-session state）
let domStopHandler = null;

function getSessionState(sid) {
  if (!sessionStates.has(sid)) {
    sessionStates.set(sid, { stream: null, streamId: null, stopHandler: null, isSending: false });
  }
  return sessionStates.get(sid);
}

function clearAllSessionStates() {
  for (const state of sessionStates.values()) {
    try { state.stream?.cancel(); } catch(_) {}
  }
  sessionStates.clear();
}

// ═══════════════════════════════════════════════════════════════
// DOM 引用
// ═══════════════════════════════════════════════════════════════
const $ = (id) => document.getElementById(id);

const dom = {
  graph: $('graph-svg'),
  tip: $('tip'),
  sidebar: $('session-sidebar'),
  sidebarToggle: $('sidebar-toggle'),
  infoPanel: $('info-panel'),
  infoToggle: $('info-toggle'),
  brandName: $('brand-name'),
  connDot: $('conn-dot'),
  connText: $('conn-text'),
  aiActivityDot: $('ai-activity-dot'),
  aiActivityLabel: $('ai-activity-label'),
  chatMessages: $('chat-messages'),
  thoughtStream: $('thought-stream'),
  msgInput: $('msg-input'),
  sendBtn: $('send-btn'),
  slashMenu: $('slash-menu'),
  sessionList: $('session-list'),
  sessionEmpty: $('session-empty'),
  sessionCount: $('session-count'),
  newSessionBtn: $('new-session-btn'),
  memoryList: $('memory-list'),
  contextRingArc: $('context-ring-arc'),
  statSessions: $('stat-sessions'),
  statMemories: $('stat-memories'),
  statTokRate: $('stat-tok-rate'),
  infoStatus: $('info-status'),
  infoModel: $('info-model'),
  gravitySlider: $('gravity-slider'),
  repulsionSlider: $('repulsion-slider'),
  nodesizeSlider: $('nodesize-slider'),
  gravityVal: $('gravity-val'),
  repulsionVal: $('repulsion-val'),
  nodesizeVal: $('nodesize-val'),
  settingsOverlay: $('settings-overlay'),
  settingsBtn: $('settings-btn'),
  settingsClose: $('settings-close'),
  graphToggleBtn: $('memory-graph-toggle-btn'),
  voiceBtn: $('voice-btn'),
};

// ═══════════════════════════════════════════════════════════════
// 主题系统
// ═══════════════════════════════════════════════════════════════
function initTheme() {
  let saved = CONFIG.DEFAULT_THEME;
  try { saved = localStorage.getItem(CONFIG.THEME_KEY) || CONFIG.DEFAULT_THEME; } catch {}
  applyTheme(saved);

  document.querySelectorAll('.theme-dot').forEach(dot => {
    dot.addEventListener('click', () => applyTheme(dot.dataset.t));
  });
}

function applyTheme(name) {
  document.body.dataset.theme = name;
  try { localStorage.setItem(CONFIG.THEME_KEY, name); } catch {}
  document.querySelectorAll('.theme-dot').forEach(d => {
    d.classList.toggle('active', d.dataset.t === name);
  });
}

// ═══════════════════════════════════════════════════════════════
// 面板折叠
// ═══════════════════════════════════════════════════════════════
function initPanelCollapse() {
  let sidebarOpen = true, infoOpen = true;

  dom.sidebarToggle.addEventListener('click', () => {
    sidebarOpen = !sidebarOpen;
    dom.sidebar.classList.toggle('collapsed', !sidebarOpen);
    dom.sidebarToggle.classList.toggle('collapsed', !sidebarOpen);
    dom.sidebarToggle.textContent = sidebarOpen ? '◀' : '▶';
  });

  dom.infoToggle.addEventListener('click', () => {
    infoOpen = !infoOpen;
    dom.infoPanel.classList.toggle('collapsed', !infoOpen);
    dom.infoToggle.classList.toggle('collapsed', !infoOpen);
    dom.infoToggle.textContent = infoOpen ? '▶' : '◀';
  });

  // ★ 拖動調整面板大小
  function makeResizable(panel, isRight) {
    let dragging = false, startX, startW;
    const handle = isRight ? panel.querySelector('::before') : panel.querySelector('::after');
    panel.addEventListener('mousedown', (e) => {
      const rect = panel.getBoundingClientRect();
      const edge = isRight ? (e.clientX - rect.left) : (rect.right - e.clientX);
      if (edge > -8 && edge < 8) {
        dragging = true; startX = e.clientX; startW = rect.width;
        e.preventDefault();
      }
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const newW = isRight ? startW - (e.clientX - startX) : startW + (e.clientX - startX);
      const clamped = Math.max(180, Math.min(500, newW));
      panel.style.width = clamped + 'px';
      panel.style.minWidth = clamped + 'px';
    });
    window.addEventListener('mouseup', () => { dragging = false; });
  }
  try { makeResizable(dom.sidebar, false); makeResizable(dom.infoPanel, true); } catch(_) {}
}

// ═══════════════════════════════════════════════════════════════
// AI 活动指示器
// ═══════════════════════════════════════════════════════════════
function setAiActivity(state, label = '') {
  dom.aiActivityDot.className = 'ai-activity-dot ' + state;
  dom.aiActivityLabel.textContent = label || state;
}

// ═══════════════════════════════════════════════════════════════
// 思考流 (Thought Stream) — Phase 1 mock
// ═══════════════════════════════════════════════════════════════
const TOOL_ICONS = {
  web_search: '🔎', read_file: '📄', write_file: '✏️',
  exec_command: '⚡', memory_search: '🧠', memory_write: '💾',
  browser_read: '🧭', fetch_url: '🌐', send_message: '💬',
  todo_write: '📋', completion: '✅', think: '💭',
};

function tsTime() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`;
}

function thoughtLine(type, msg, toolName = '', ok = true) {
  const div = document.createElement('div');
  div.className = 'stream-line';
  const time = document.createElement('span');
  time.className = 'stream-time';
  time.textContent = tsTime();
  div.appendChild(time);

  const content = document.createElement('span');
  if (type === 'msg') {
    content.className = 'stream-msg';
    content.textContent = msg;
  } else if (type === 'tool') {
    content.className = ok ? 'stream-ok' : 'stream-err';
    const icon = TOOL_ICONS[toolName] || '🔧';
    content.textContent = `${icon} ${msg}`;
  }
  div.appendChild(content);
  dom.thoughtStream.appendChild(div);
  dom.thoughtStream.scrollTop = dom.thoughtStream.scrollHeight;
}

// ═══════════════════════════════════════════════════════════════
// 聊天消息
// ═══════════════════════════════════════════════════════════════
// ── 滾動加載更多歷史 ──
dom.chatMessages.addEventListener('scroll', () => {
  if (dom.chatMessages.scrollTop < 60 && !isLoadingMore && !allMessagesLoaded) {
    loadMoreMessages();
  }
});

function addChatMessage(role, text, label = '') {
  const div = document.createElement('div');
  div.style.cssText = `
    display:flex;flex-direction:column;gap:4px;padding:8px 0;
    animation: fade-up 0.3s ease-out;
  `;

  const header = document.createElement('div');
  header.style.cssText = `
    display:flex;align-items:center;gap:8px;font-size:12px;
  `;

  const roleLabel = document.createElement('span');
  roleLabel.style.cssText = `
    font-weight:600;color:${role === 'user' ? 'var(--accent-cool)' : 'var(--brand-primary)'};
  `;
  roleLabel.textContent = label || (role === 'user' ? 'You' : 'Hermes');
  header.appendChild(roleLabel);

  const time = document.createElement('span');
  time.style.cssText = 'color:var(--dim);font-size:10px;';
  time.textContent = tsTime();
  header.appendChild(time);

  div.appendChild(header);

  const body = document.createElement('div');
  body.style.cssText = `
    color:var(--ink);font-size:14px;line-height:1.7;
    padding:8px 12px;border-radius:var(--radius-sm);
    background:${role === 'user' ? 'var(--panel-hover)' : 'var(--brand-glow)'};
    border:1px solid ${role === 'user' ? 'var(--line)' : 'rgba(124,92,231,0.15)'};
    max-width:85%;
    ${role === 'user' ? 'align-self:flex-end;' : ''}
  `;
  body.innerHTML = renderMarkdown(text);
  div.appendChild(body);

  dom.chatMessages.appendChild(div);
  dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
}

// ═══════════════════════════════════════════════════════════════
// 简易 Markdown 渲染
// ═══════════════════════════════════════════════════════════════
function renderMarkdown(text) {
  if (!text) return '';
  let html = String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  html = html.replace(/`([^`]+)`/g, '<code style="background:var(--panel);padding:1px 5px;border-radius:3px;font-size:13px;">$1</code>');
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g,
    '<pre style="background:var(--panel);padding:10px;border-radius:6px;overflow-x:auto;font-size:12px;"><code>$2</code></pre>');
  html = html.replace(/\n/g, '<br>');
  return html;
}

// ═══════════════════════════════════════════════════════════════
// 斜杠命令
// ═══════════════════════════════════════════════════════════════
const SLASH_COMMANDS = [
  { cmd: '/llm', label: '配置 LLM 模型', desc: '选择大模型服务商并填入 API Key', run: () => openSettings() },
  { cmd: '/tts', label: '配置语音合成', desc: 'Agent 回复转语音', run: () => openSettings() },
  { cmd: '/theme', label: '切换主题', desc: 'midnight / aurora / forest / crimson / abyss / arctic / sand',
    run: () => { const themes = ['midnight','aurora','forest','crimson','abyss','arctic','sand']; const next = themes[(themes.indexOf(document.body.dataset.theme)+1)%themes.length]; applyTheme(next); addChatMessage('system','主题已切换至 **'+next+'**'); } },
  { cmd: '/session', label: '会话管理', desc: '新建 / 列表 / 切换会话', run: () => { addChatMessage('system','点击左侧会话列表切换，或点击「+ 新会话」创建。当前会话: `'+String(activeSessionId||'无').slice(0,12)+'…`'); } },
  { cmd: '/memory', label: '记忆搜索', desc: '搜索 5239 条历史消息', run: () => { document.getElementById('memory-search-input')?.focus(); } },
  { cmd: '/graph', label: '记忆图谱', desc: '切换背景图谱显示', run: () => { dom.graphToggleBtn?.click(); } },
  { cmd: '/help', label: '查看全部命令', desc: '列出所有可用斜杠命令', run: showSlashHelp },
];

function initSlashMenu() {
  const input = dom.msgInput;
  const menu = dom.slashMenu;

  input.addEventListener('input', () => {
    const v = input.value;
    if (!v.startsWith('/')) { menu.hidden = true; return; }
    const q = v.slice(1).trim().toLowerCase();
    const items = q ? SLASH_COMMANDS.filter(c =>
      c.cmd.slice(1).startsWith(q) || c.label.includes(q)
    ) : SLASH_COMMANDS;

    menu.innerHTML = '';
    items.forEach(c => {
      const item = document.createElement('div');
      item.style.cssText = `
        padding:8px 12px;border-radius:6px;cursor:pointer;display:flex;gap:10px;align-items:center;
      `;
      item.innerHTML = `<span style="color:var(--accent-cool);font-weight:600;font-size:13px;">${c.cmd}</span>
        <span><span style="color:var(--ink);font-size:13px;">${c.label}</span>
        <span style="color:var(--dim);font-size:11px;display:block;">${c.desc}</span></span>`;
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        input.value = '';
        menu.hidden = true;
        c.run?.();
      });
      item.addEventListener('mouseenter', () => {
        menu.querySelectorAll('div').forEach(d => d.style.background = '');
        item.style.background = 'var(--panel-hover)';
      });
      menu.appendChild(item);
    });
    menu.hidden = items.length === 0;
  });

  input.addEventListener('keydown', (e) => {
    if (!menu.hidden && (e.key === 'Escape' || e.key === 'Enter')) {
      if (e.key === 'Escape') { menu.hidden = true; e.preventDefault(); }
    }
  });

  input.addEventListener('blur', () => setTimeout(() => { menu.hidden = true; }, 150));
}

// ═══════════════════════════════════════════════════════════════
// 设置面板
// ═══════════════════════════════════════════════════════════════
function openSettings() {
  dom.settingsOverlay.hidden = false;
  dom.settingsOverlay.style.display = 'flex';
  // 读取当前配置（Phase 1: 显示 placeholder）
  $('settings-llm-status').textContent = 'deepseek · deepseek-v4-pro';
}

function closeSettings() {
  dom.settingsOverlay.hidden = true;
  dom.settingsOverlay.style.display = 'none';
}

function initSettings() {
  dom.settingsBtn.addEventListener('click', openSettings);
  dom.settingsClose.addEventListener('click', closeSettings);
  dom.settingsOverlay.addEventListener('click', (e) => {
    if (e.target === dom.settingsOverlay) closeSettings();
  });

  $('settings-save').addEventListener('click', () => {
    $('settings-feedback').textContent = '配置已保存（Phase 2 对接 Hermes）';
    setTimeout(() => { $('settings-feedback').textContent = ''; }, 2000);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !dom.settingsOverlay.hidden) {
      closeSettings();
    }
    if (e.key === 's' && e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      dom.settingsOverlay.hidden ? openSettings() : closeSettings();
    }
  });
}

// ═══════════════════════════════════════════════════════════════
// D3 记忆图谱 — 核心视觉组件
// ═══════════════════════════════════════════════════════════════
let graphVisible = true;

function initMemoryGraph() {
  // 从 localStorage 读取
  try {
    const saved = localStorage.getItem(CONFIG.GRAPH_TOGGLE_KEY);
    if (saved === 'false') graphVisible = false;
  } catch {}

  if (!graphVisible) {
    dom.graph.parentElement.style.display = 'none';
    dom.graphToggleBtn.classList.remove('active');
  } else {
    dom.graphToggleBtn.classList.add('active');
  }

  const W = window.innerWidth;
  const H = window.innerHeight;

  if (typeof d3 === 'undefined') { console.warn('D3 not loaded'); return; }
  const svg = d3.select('#graph-svg')
    .attr('width', W).attr('height', H);

  // ══ SVG 滤镜层 — 三种发光效果 ══
  const defs = svg.append('defs');
  defs.html(`
    <!-- 外发光：普通节点 -->
    <filter id="neb-glow" x="-80%" y="-80%" width="260%" height="260%">
      <feGaussianBlur stdDeviation="3.2" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <!-- 强发光：核心节点 -->
    <filter id="neb-glow-strong" x="-120%" y="-120%" width="340%" height="340%">
      <feGaussianBlur stdDeviation="6" result="blur"/>
      <feMerge><feMergeNode in="blur"/><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
    <!-- 底部阴影 -->
    <filter id="neb-shadow" x="-50%" y="-50%" width="200%" height="200%">
      <feDropShadow dx="0" dy="0" stdDeviation="2" flood-opacity="0.4"/>
    </filter>
    <!-- 连线渐变 -->
    <radialGradient id="link-grad-core" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="var(--accent-warm)" stop-opacity="0.5"/>
      <stop offset="100%" stop-color="var(--link-stroke)" stop-opacity="0.08"/>
    </radialGradient>
  `);

  const world = svg.append('g');
  const gLink = world.append('g').attr('stroke-linecap', 'round');
  const gNode = world.append('g');
  const gLabel = world.append('g');  // 节点标签层
  const gParticle = world.append('g'); // 粒子层

  // 自定义滚轮缩放
  const zoom = d3.zoom()
    .scaleExtent([0.1, 5])
    .filter(event => event.type === 'wheel')
    .on('zoom', event => world.attr('transform', event.transform));

  svg.call(zoom);
  svg.on('wheel.zoom', null);
  svg.on('dblclick.zoom', null);

  svg.node().addEventListener('wheel', event => {
    event.preventDefault();
    const current = d3.zoomTransform(svg.node());
    const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
    const nextScale = Math.max(0.1, Math.min(5, current.k * factor));
    const k = nextScale / current.k;
    const px = W / 2, py = H / 2;
    const nextX = px - (px - current.x) * k;
    const nextY = py - (py - current.y) * k;
    svg.call(zoom.transform, d3.zoomIdentity.translate(nextX, nextY).scale(nextScale));
  }, { passive: false });

  const tip = d3.select('#tip');

  // ══ Mock 记忆数据 — 4 种类型 ══
  const mockMemories = [
    { id:'core', title:'Hermes Agent 核心', type:'core', desc:'系统枢纽 · 所有记忆汇聚于此', ts:Date.now() },
    { id:'m1', title:'用户偏好：暗黑主题', type:'memory', desc:'2026-06-05 记录', ts:Date.now()-12000 },
    { id:'m2', title:'项目：hermes-native-ui', type:'knowledge', desc:'白龙马启发 · 原生 JS + D3', ts:Date.now()-8000 },
    { id:'m3', title:'AI Agent 架构设计', type:'memory', desc:'上次深度对话 · 2026-06-04', ts:Date.now()-30000 },
    { id:'m4', title:'DeepSeek v4 模型配置', type:'config', desc:'API: api.deepseek.com', ts:Date.now()-60000 },
    { id:'m5', title:'微信平台已连接', type:'config', desc:'ClawBot · 扫码登录', ts:Date.now()-2000 },
    { id:'m6', title:'nousresearch/hermes', type:'knowledge', desc:'GitHub · Hermes Agent 源码', ts:Date.now()-45000 },
    { id:'m7', title:'工作区路径配置', type:'config', desc:'~/projects/ai-agents', ts:Date.now()-1000 },
    { id:'m8', title:'TTS 引擎选型', type:'config', desc:'Edge TTS · en-US-AriaNeural', ts:Date.now()-70000 },
    { id:'m9', title:'记忆召回优化策略', type:'knowledge', desc:'FTS5 + 向量双路召回', ts:Date.now()-22000 },
    { id:'m10',title:'前端架构讨论', type:'memory', desc:'昨天 · 三面板毛玻璃方案', ts:Date.now()-90000 },
    { id:'m11',title:'白龙马 UI 分析', type:'knowledge', desc:'参考: xiaoyuanda666/BaiLongma', ts:Date.now()-5000 },
    { id:'m12',title:'Session 持久化方案', type:'memory', desc:'SQLite · 断点续传', ts:Date.now()-15000 },
    { id:'m13',title:'D3 力导向图参数', type:'knowledge', desc:'6种力场 · 0.025衰减', ts:Date.now()-40000 },
    { id:'m14',title:'Discord Bot 已配置', type:'config', desc:'2026-05-28 部署', ts:Date.now()-100000 },
    { id:'m15',title:'知识星图系统', type:'knowledge', desc:'match-knowledge.py 集成', ts:Date.now()-6000 },
    { id:'m16',title:'CSS 变量主题引擎', type:'knowledge', desc:'7套主题 · 20+色板变量', ts:Date.now()-3000 },
    { id:'m17',title:'记忆压缩测试', type:'memory', desc:'上周 · 压缩率 85%', ts:Date.now()-180000 },
    { id:'m18',title:'向量嵌入模型对比', type:'knowledge', desc:'OpenAI vs Ollama vs Qwen', ts:Date.now()-55000 },
    { id:'m19',title:'Telegram 平台接入', type:'config', desc:'Bot Token · 已激活', ts:Date.now()-120000 },
    { id:'m20',title:'前端性能优化清单', type:'memory', desc:'lazy load · contain · throttle', ts:Date.now()-8000 },
    { id:'m21',title:'ACUI 卡片系统设计', type:'knowledge', desc:'WebSocket · Web Components', ts:Date.now()-20000 },
    { id:'m22',title:'毛玻璃效果 CSS', type:'knowledge', desc:'backdrop-filter · rgba 叠加', ts:Date.now()-12000 },
    { id:'m23',title:'Hermes Gateway 架构', type:'knowledge', desc:'端口8642 · SSE+WS双通道', ts:Date.now()-35000 },
    { id:'m24',title:'多平台消息分发', type:'memory', desc:'10+平台 · 统一路由', ts:Date.now()-50000 },
    { id:'m25',title:'中英双语需求', type:'memory', desc:'用户偏好 · 今日记录', ts:Date.now()-7000 },
  ];

  let nodes = mockMemories.map((m, i) => ({
    _nid: m.id, title: m.title, type: m.type, desc: m.desc,
    _core: m.type === 'core', _ts: m.ts,
    _deg: 0, _childCount: 0,
    _strength: m.type === 'core' ? 1.0 : 0.35 + Math.random() * 0.45,
    x: W/2 + (Math.random()-0.5)*320,
    y: H/2 + (Math.random()-0.5)*260,
    vx:0, vy:0,
  }));

  // 连线
  let links = [];
  const linkSet = new Set();
  nodes.forEach((source, i) => {
    const count = source._core ? 8 : Math.floor(Math.random()*3)+1;
    for (let j=0; j<count; j++) {
      const ti = (i+1+Math.floor(Math.random()*(nodes.length-1)))%nodes.length;
      if (ti===i) continue;
      const lid = `${source._nid}-${nodes[ti]._nid}`;
      const rev = `${nodes[ti]._nid}-${source._nid}`;
      if (linkSet.has(lid)||linkSet.has(rev)) continue;
      linkSet.add(lid);
      links.push({ source:source._nid, target:nodes[ti]._nid, _lid:lid,
        _kind: source._core ? 'core_link' : (Math.random()<0.7?'memory_link':'weak_link') });
    }
  });

  // 度数
  nodes.forEach(n=>{n._deg=0;n._childCount=0;});
  links.forEach(l=>{
    const s=nodes.find(n=>n._nid===(typeof l.source==='object'?l.source._nid:l.source));
    const t=nodes.find(n=>n._nid===(typeof l.target==='object'?l.target._nid:l.target));
    if(s)s._deg++; if(t)t._deg++;
  });

  function cssVar(n){return getComputedStyle(document.body).getPropertyValue(n).trim();}

  // ══ 节点颜色 — 按类型 + 时效衰减 ══
  const TYPE_COLORS = {
    core:     () => cssVar('--accent-warm')||'#d39872',
    memory:   () => cssVar('--accent-cool')||'#8fb6d8',
    knowledge:() => cssVar('--brand-primary')||'#7c5ce7',
    config:   () => cssVar('--ok')||'#74d89f',
  };

  function nodeColor(d) {
    const base = TYPE_COLORS[d.type]?.() || (cssVar('--node-high')||'#cfe3f5');
    const age = (Date.now()-(d._ts||Date.now()))/20000;
    const fade = Math.max(0.3, 1-age);
    const c = d3.color(base);
    if (!c) return base;
    return c.darker(0.5-fade*0.4)+'';
  }

  function nodeRadius(d) {
    if (d._core) return 16;
    const base = 4 + Math.min((d._deg||0)*1.0, 6);
    const childBonus = 1+Math.min(1.0,(d._childCount||0)*0.15);
    return base*childBonus;
  }

  // ══ D3 力模拟 ══
  const sim = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id(d=>d._nid)
      .distance(d=>d._kind==='core_link'?70:d._kind==='memory_link'?110:150)
      .strength(d=>d._kind==='core_link'?0.22:d._kind==='memory_link'?0.12:0.05))
    .force('charge', d3.forceManyBody().strength(d=>-140-(d._deg||0)*4))
    .force('center', d3.forceCenter(W/2,H/2))
    .force('x', d3.forceX(W/2).strength(0.03))
    .force('y', d3.forceY(H/2).strength(0.03))
    .force('collision', d3.forceCollide().radius(d=>nodeRadius(d)+6).strength(0.8))
    .alphaDecay(0.025).velocityDecay(0.3)
    .on('tick', tick);

  function tick() {
    // 连线
    gLink.selectAll('line')
      .attr('x1',d=>d.source.x).attr('y1',d=>d.source.y)
      .attr('x2',d=>d.target.x).attr('y2',d=>d.target.y);
    // 节点组（circle + ring）
    gNode.selectAll('g.node-group').each(function(d) {
      d3.select(this).select('circle.node-body')
        .attr('cx',d.x).attr('cy',d.y);
      d3.select(this).select('circle.node-ring')
        .attr('cx',d.x).attr('cy',d.y);
    });
    // 标签
    gLabel.selectAll('text').each(function(d) {
      d3.select(this).attr('x',d.x).attr('y',d.y-nodeRadius(d)-8);
    });
    // 粒子
    gParticle.selectAll('circle.particle').each(function(d) {
      const p = d3.select(this);
      const t = (Date.now()/1000+d._seed)*1.5;
      const r = d._orbit||20;
      p.attr('cx',d._anchorX+Math.cos(t)*r)
       .attr('cy',d._anchorY+Math.sin(t)*r*0.6);
    });
  }

  // ══ 渲染连线 — 三种样式 ══
  const linkSel = gLink.selectAll('line').data(links).enter().append('line')
    .attr('stroke', d=>{
      if (d._kind==='core_link') return cssVar('--accent-warm')||'rgba(211,152,114,0.4)';
      if (d._kind==='memory_link') return cssVar('--link-stroke')||'rgba(143,182,216,0.18)';
      return cssVar('--line')||'rgba(138,168,200,0.08)';
    })
    .attr('stroke-width', d=>d._kind==='core_link'?1.2:d._kind==='memory_link'?0.6:0.3)
    .attr('stroke-dasharray', d=>d._kind==='weak_link'?'3,6':null)
    .attr('opacity', d=>d._kind==='weak_link'?0.3:0.5);

  // ══ 渲染节点 — 用 g 包裹（body + ring + label） ══
  const nodeGroup = gNode.selectAll('g.node-group').data(nodes).enter()
    .append('g').attr('class','node-group')
    .style('cursor','pointer')
    .call(d3.drag()
      .on('start',(event,d)=>{if(!event.active)sim.alphaTarget(2).restart();d.fx=d.x;d.fy=d.y;})
      .on('drag',(event,d)=>{d.fx=event.x;d.fy=event.y;})
      .on('end',(event,d)=>{if(!event.active)sim.alphaTarget(0);d.fx=null;d.fy=null;}));

  // 底部光晕圈（大一圈的半透明圈）— 极淡，不干扰阅读
  nodeGroup.append('circle')
    .attr('class','node-halo')
    .attr('r', d=>nodeRadius(d)*1.6)
    .attr('fill','none')
    .attr('stroke', d=>nodeColor(d))
    .attr('stroke-width',0.5)
    .attr('opacity',0.12);

  // 主体圆
  nodeGroup.append('circle')
    .attr('class','node-body')
    .attr('r', nodeRadius)
    .attr('fill', nodeColor)
    .attr('filter', d=>d._core?'url(#neb-glow-strong)':'url(#neb-glow)')
    .attr('stroke', d=>d3.color(nodeColor(d))?.brighter(0.5)+''||'none')
    .attr('stroke-width', d=>d._core?1.5:0.5)
    .attr('stroke-opacity', d=>d._core?0.8:0.25);

  // 核心节点：额外旋转光环
  nodeGroup.filter(d=>d._core).append('circle')
    .attr('class','node-ring')
    .attr('r', d=>nodeRadius(d)+8)
    .attr('fill','none')
    .attr('stroke', cssVar('--accent-warm')||'#d39872')
    .attr('stroke-width',1.2)
    .attr('stroke-dasharray','8,4')
    .attr('opacity',0.35)
    .style('animation','vinyl-spin 12s linear infinite')
    .style('transform-origin','center');

  // 高连接度节点：虚线外环
  nodeGroup.filter(d=>d._deg>=5&&!d._core).append('circle')
    .attr('class','node-ring')
    .attr('r', d=>nodeRadius(d)+5)
    .attr('fill','none')
    .attr('stroke', d=>nodeColor(d))
    .attr('stroke-width',0.6)
    .attr('stroke-dasharray','3,3')
    .attr('opacity',0.4);

  // ══ 渲染标签 — 核心 + 重要节点 ══
  const labeledNodes = nodes.filter(d=>d._core||d._deg>=5);
  gLabel.selectAll('text').data(labeledNodes).enter().append('text')
    .text(d=>d.title.length>10?d.title.slice(0,10)+'…':d.title)
    .attr('text-anchor','middle')
    .attr('dy', d=>-nodeRadius(d)-8)
    .attr('fill', cssVar('--ink2')||'#9aabbe')
    .attr('font-size', d=>d._core?12:10)
    .attr('font-weight', d=>d._core?700:400)
    .attr('font-family','"PingFang SC","Microsoft YaHei",sans-serif')
    .attr('paint-order','stroke')
    .attr('stroke', cssVar('--bg0')||'#0a1118')
    .attr('stroke-width',3)
    .attr('stroke-linejoin','round')
    .attr('opacity',0.55);

  // ══ 粒子 — 核心节点周围的轨道粒子 ══
  const coreNode = nodes.find(n=>n._core);
  if (coreNode) {
    const particles = [];
    for (let i=0;i<6;i++) {
      particles.push({
        _anchorX: coreNode.x, _anchorY: coreNode.y,
        _orbit: 28+Math.random()*18, _seed: i*1.1,
        x:coreNode.x, y:coreNode.y,
      });
    }
    gParticle.selectAll('circle.particle').data(particles).enter().append('circle')
      .attr('class','particle')
      .attr('r',1.5)
      .attr('fill', cssVar('--accent-warm')||'#d39872')
      .attr('opacity',0.25);
  }

  // ══ 交互事件 ══
  nodeGroup
    .on('mouseover', function(event,d) {
      // 放大节点
      d3.select(this).select('.node-body').transition().duration(200)
        .attr('r', nodeRadius(d)*1.25);
      d3.select(this).select('.node-halo').transition().duration(200)
        .attr('opacity',0.35).attr('r', nodeRadius(d)*2.0);
      // tooltip
      const typeZH = {core:'🧠 核心',memory:'💾 记忆',knowledge:'📚 知识',config:'⚙ 配置'};
      tip.style('display','block')
        .style('left',(event.clientX+14)+'px')
        .style('top',(event.clientY-10)+'px')
        .html(`<div style="font-size:10px;color:var(--dim);margin-bottom:2px;">${typeZH[d.type]||d.type}</div>
          <div style="font-weight:600;color:var(--ink);margin-bottom:2px;">${d.title}</div>
          <div style="font-size:10px;color:var(--ink2);">${d.desc||''}</div>
          <div style="font-size:9px;color:var(--dim);margin-top:2px;">连接: ${d._deg||0} · 强度: ${((d._strength||0)*100).toFixed(0)}%</div>`);
    })
    .on('mousemove', event=>{
      tip.style('left',(event.clientX+14)+'px').style('top',(event.clientY-10)+'px');
    })
    .on('mouseout', function(event,d) {
      d3.select(this).select('.node-body').transition().duration(300)
        .attr('r', nodeRadius(d));
      d3.select(this).select('.node-halo').transition().duration(300)
        .attr('opacity',0.12).attr('r', nodeRadius(d)*1.6);
      tip.style('display','none');
    })
    .on('click', function(event,d) {
      d._ts = Date.now();
      d._strength = Math.min(1,(d._strength||0.5)+0.25);
      const body = d3.select(this).select('.node-body');
      body.transition().duration(150).attr('r',nodeRadius(d)*1.6)
        .transition().duration(600).attr('r',nodeRadius(d));
      const nid = d._nid;
      linkSel.transition().duration(400)
        .attr('opacity', l=>{
          const sid=typeof l.source==='object'?l.source._nid:l.source;
          const tid=typeof l.target==='object'?l.target._nid:l.target;
          return (sid===nid||tid===nid)?1:0.12;
        });
      setTimeout(()=>{
        linkSel.transition().duration(600)
          .attr('opacity',l=>l._kind==='weak_link'?0.5:0.8);
      },1200);
      // ★ 更新右側面板節點詳情
      showNodeDetail(d);
    });

  // ══ 粒子动画循环 ══
  function animateParticles() {
    if (!graphVisible||!coreNode) return;
    coreNode._anchorX = coreNode.x;
    coreNode._anchorY = coreNode.y;
    gParticle.selectAll('circle.particle').each(function(d) {
      d._anchorX = coreNode.x; d._anchorY = coreNode.y;
    });
    requestAnimationFrame(()=>setTimeout(animateParticles,50));
  }
  animateParticles();

  // ══ 自然微抖 ══
  setInterval(()=>{
    if (!graphVisible) return;
    const candidates = nodes.filter(n=>!n._core);
    const twitchCount = Math.max(3,Math.floor(candidates.length*0.25));
    for (let i=0;i<twitchCount;i++) {
      const n=candidates[Math.floor(Math.random()*candidates.length)];
      const a=Math.random()*Math.PI*2,d=30+Math.random()*40;
      n.x=(n.x||W/2)+Math.cos(a)*d*0.3;
      n.y=(n.y||H/2)+Math.sin(a)*d*0.3;
      n.vx=(n.vx||0)+Math.cos(a)*d*0.12;
      n.vy=(n.vy||0)+Math.sin(a)*d*0.12;
    }
    sim.alpha(0.75).restart();
  },6000);

  // ══ 图谱控制 ══
  function updateGraphForces() {
    const gs=$('gravity-slider'), rs=$('repulsion-slider'), ns=$('nodesize-slider');
    if(!gs||!rs||!ns) return;
    const grav=parseFloat(gs.value), rep=parseFloat(rs.value), nsize=parseFloat(ns.value);
    setText('gravity-val',grav.toFixed(2)+'x'); setText('repulsion-val',rep.toFixed(2)+'x'); setText('nodesize-val',nsize.toFixed(2)+'x');
    sim.force('x').strength(0.03*grav);
    sim.force('y').strength(0.03*grav);
    sim.force('charge').strength(d=>(-140-(d._deg||0)*4)*rep);
    gNode.selectAll('.node-body').attr('r',d=>nodeRadius(d)*nsize);
    sim.alpha(1).restart();
  }
  $('gravity-slider')?.addEventListener('input',updateGraphForces);
  $('repulsion-slider')?.addEventListener('input',updateGraphForces);
  $('nodesize-slider')?.addEventListener('input',updateGraphForces);

  const resetBtn=$('qa-reset-graph')||$('reset-graph-btn');
  if(resetBtn) resetBtn.addEventListener('click',()=>{
    svg.transition().duration(500).call(zoom.transform,d3.zoomIdentity);
  });

  dom.graphToggleBtn.addEventListener('click',()=>{
    graphVisible=!graphVisible;
    dom.graph.parentElement.style.display=graphVisible?'':'none';
    dom.graphToggleBtn.classList.toggle('active',graphVisible);
    try{localStorage.setItem(CONFIG.GRAPH_TOGGLE_KEY,String(graphVisible));}catch{}
  });

  window.addEventListener('resize',()=>{
    const nW=window.innerWidth,nH=window.innerHeight;
    svg.attr('width',nW).attr('height',nH);
    sim.force('center',d3.forceCenter(nW/2,nH/2));
    sim.force('x',d3.forceX(nW/2));
    sim.force('y',d3.forceY(nH/2));
    sim.alpha(0.3).restart();
  });

  // ── 动态更新图谱节点（Phase 2: 从 Hermes 记忆数据加载）──
  function renderDynamicNodes() {
    gNode.selectAll('g.node-group').remove();
    gLabel.selectAll('text').remove();
    const ng = gNode.selectAll('g.node-group').data(nodes).enter()
      .append('g').attr('class','node-group').style('cursor','pointer')
      .call(d3.drag()
        .on('start',(e,d)=>{if(!e.active)sim.alphaTarget(2).restart();d.fx=d.x;d.fy=d.y;})
        .on('drag',(e,d)=>{d.fx=e.x;d.fy=e.y;})
        .on('end',(e,d)=>{if(!e.active)sim.alphaTarget(0);d.fx=null;d.fy=null;}));
    ng.append('circle').attr('class','node-halo')
      .attr('r',d=>nodeRadius(d)*1.6).attr('fill','none')
      .attr('stroke',d=>nodeColor(d)).attr('stroke-width',0.5).attr('opacity',0.12);
    ng.append('circle').attr('class','node-body')
      .attr('r',nodeRadius).attr('fill',nodeColor)
      .attr('filter',d=>d._core?'url(#neb-glow-strong)':'url(#neb-glow)')
      .attr('stroke',d=>d3.color(nodeColor(d))?.brighter(0.5)+''||'none')
      .attr('stroke-width',d=>d._core?1.5:0.5)
      .attr('stroke-opacity',d=>d._core?0.8:0.25);
    const labeled=nodes.filter(d=>d._core||d._deg>=5);
    gLabel.selectAll('text').data(labeled).enter().append('text')
      .text(d=>d.title.length>10?d.title.slice(0,10)+'…':d.title)
      .attr('text-anchor','middle').attr('dy',d=>-nodeRadius(d)-8)
      .attr('fill',cssVar('--ink2')).attr('font-size',d=>d._core?12:10)
      .attr('font-weight',d=>d._core?700:400)
      .attr('font-family','"PingFang SC","Microsoft YaHei",sans-serif')
      .attr('paint-order','stroke').attr('stroke',cssVar('--bg0'))
      .attr('stroke-width',3).attr('opacity',0.55);
    ng.on('mouseover',function(e,d){
      d3.select(this).select('.node-body').transition().duration(200).attr('r',nodeRadius(d)*1.25);
      d3.select(this).select('.node-halo').transition().duration(200).attr('opacity',0.35).attr('r',nodeRadius(d)*2.0);
      const tz={core:'🧠 核心',memory:'💾 记忆',knowledge:'📚 知识',config:'⚙ 配置'};
      tip.style('display','block').style('left',(e.clientX+14)+'px').style('top',(e.clientY-10)+'px')
        .html(`<div style="font-size:10px;color:var(--dim);">${tz[d.type]||d.type}</div>
          <div style="font-weight:600;color:var(--ink);">${d.title}</div>
          <div style="font-size:10px;color:var(--ink2);">${d.desc||''}</div>`);
    }).on('mousemove',e=>{tip.style('left',(e.clientX+14)+'px').style('top',(e.clientY-10)+'px');})
      .on('mouseout',function(e,d){
        d3.select(this).select('.node-body').transition().duration(300).attr('r',nodeRadius(d));
        d3.select(this).select('.node-halo').transition().duration(300).attr('opacity',0.12).attr('r',nodeRadius(d)*1.6);
        tip.style('display','none');
      });
    sim.nodes(nodes); sim.alpha(1).restart();
  }

  window.__memoryGraph={sim,nodes,links,nodeGroup,linkSel,gLink,gNode,gLabel,gParticle,svg,zoom,coreNode,
    renderDynamicNodes,
    addMemoryNodes(items){
      if(!items||!items.length) return;
      const nodeMap=new Map(nodes.map(n=>[n._nid,n]));
      let added=0;
      items.forEach(item=>{
        const nid=item.id||item._nid;
        if(!nid||nodeMap.has(String(nid))) return;
        const node={_nid:String(nid),title:item.title,type:item.type||'memory',
          desc:item.desc||'',_core:item.type==='core',_ts:item.ts||Date.now(),
          _deg:0,_childCount:0,_strength:0.5+Math.random()*0.3,
          x:W/2+(Math.random()-0.5)*300,y:H/2+(Math.random()-0.5)*250,vx:0,vy:0};
        nodes.push(node);nodeMap.set(node._nid,node);added++;
      });
      if(added){renderDynamicNodes();}
    },
  };
}

// ═══════════════════════════════════════════════════════════════
// 聊天发送
// ═══════════════════════════════════════════════════════════════
// ── 思考流折疊 ──
function initThoughtStreamCollapse() {
  const header = document.getElementById('thought-stream-header');
  const panel = document.getElementById('thought-stream-panel');
  if (!header || !panel) return;
  header.addEventListener('click', () => {
    panel.classList.toggle('collapsed');
  });
}

function initChat() {
  dom.sendBtn.addEventListener('click', sendMessage);
  dom.msgInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  dom.newSessionBtn.addEventListener('click', async () => {
    dom.newSessionBtn.disabled = true;
    dom.newSessionBtn.textContent = '创建中…';
    try {
      // 1. 取消旧会话嘅活跃 stream（Gateway + 客户端）
      const oldSid = activeSessionId;
      const oldState = getSessionState(oldSid);
      if (oldState.streamId) {
        try { await HermesAPI.chatCancel(oldState.streamId); } catch(_) {}
      }
      if (oldState.stream) {
        try { oldState.stream.cancel(); } catch(_) {}
      }
      oldState.stream = null;
      oldState.streamId = null;

      // 2. 创建新会话（先创建，获取 ID）
      const result = await HermesAPI.createSession();
      activeSessionId = result.session?.session_id || result.session_id;

      // 3. 而家先同步按钮（用新 session ID）
      syncButtonForSession();
      dom.sendBtn.disabled = false;

      dom.chatMessages.innerHTML = '';
      addChatMessage('system', `新会话已创建: \`${activeSessionId.slice(0, 8)}…\``);
      thoughtLine('msg', `新会话: ${activeSessionId.slice(0, 12)}…`);
      loadSessions();
    } catch (e) {
      addChatMessage('system', `创建失败: ${e.message}`);
    } finally {
      dom.newSessionBtn.disabled = false;
      dom.newSessionBtn.textContent = '+ 新会话';
    }
  });
}

let isSending = false;

/** 根据当前 session 状态同步按钮 UI */
function syncButtonForSession() {
  const sb = document.getElementById('send-btn');
  if (!sb) return;
  const state = activeSessionId ? getSessionState(activeSessionId) : null;

  // 先彻底清除所有监听器
  if (domStopHandler) {
    sb.removeEventListener('click', domStopHandler);
    domStopHandler = null;
  }
  sb.removeEventListener('click', sendMessage);

  if (state && state.isSending && state.stopHandler) {
    // 当前 session 有活跃 stream → 停止掣
    sb.textContent = '停止';
    sb.style.background = '#ff4444'; sb.style.color = '#fff';
    sb.disabled = false;
    sb.addEventListener('click', state.stopHandler);
    domStopHandler = state.stopHandler;
  } else {
    // 冇活跃 stream → 发送掣
    sb.textContent = t('send');
    sb.style.background = ''; sb.style.color = '';
    sb.disabled = false;
    sb.addEventListener('click', sendMessage);
    domStopHandler = null;
    if (state) { state.isSending = false; state.stopHandler = null; }
  }
}

/** 恢复发送掣 — 清除 DOM 上嘅 stopHandler，重新绑定 sendMessage */
function restoreSendButton() {
  syncButtonForSession();
}

function showSlashHelp() {
  const lines = SLASH_COMMANDS.map(c => `· \`${c.cmd}\` — ${c.label}：${c.desc}`).join('\n');
  addChatMessage('system', `可用命令（输入 \`/\` 调出菜单）：\n\n${lines}`);
}

async function sendMessage() {
  const state = getSessionState(activeSessionId);
  if (state.isSending) return;
  const text = dom.msgInput.value.trim();
  if (!text) return;

  state.isSending = true;
  dom.msgInput.value = '';
  dom.sendBtn.disabled = true;

  // 如果冇活跃 session，自动创建一个
  if (!activeSessionId) {
    try {
      const result = await HermesAPI.createSession();
      activeSessionId = result.session?.session_id || result.session_id;
      loadSessions();
      thoughtLine('msg', `新会话已创建: ${activeSessionId.slice(0, 8)}…`);
    } catch (e) {
      addChatMessage('system', `创建会话失败: ${e.message}`);
      dom.sendBtn.disabled = false;
      return;
    }
  }

  addChatMessage('user', text);
  thoughtLine('msg', `发送消息 → Hermes`);
  // ★ 發送後自動停止錄音
  window.__voice?.stopRecording();

  // 如果之前有流式连接（同 session），先取消 Gateway + 客户端
  if (state.streamId) {
    try { await HermesAPI.chatCancel(state.streamId); } catch(_) {}
  }
  if (state.stream) {
    state.stream.cancel();
    state.stream = null;
    state.streamId = null;
  }

  setAiActivity('thinking', '思考中…');

  try {
    // 1. 先取消之前嘅 active stream（如果有）
    try {
      const sessions = await HermesAPI.listSessions();
      const active = sessions.find(s => s.session_id === activeSessionId);
      if (active?.active_stream_id) {
        await HermesAPI.chatCancel(active.active_stream_id);
        // Stream cancelled — previous session context cleaned
      }
    } catch (_) {}

    // 2. 启动对话
    const startResult = await HermesAPI.chatStart(activeSessionId, text);
    const streamId = startResult.stream_id;
    if (!streamId) throw new Error('No stream_id returned');
    state.streamId = streamId;  // 记录当前 stream，新会话创建时取消
    const owningSessionId = activeSessionId;  // 闭包捕获 — stream 回调始终用创建时嘅 session

    thoughtLine('msg', `流式连接已建立`);

    // 2. 连接 SSE 流
    let liveText = '';
    if (window.__voice) window.__voice.setState('thinking');  // ★ 一開始等待就顯示思考
    // ★ 切換發送掣→停止掣
  const stopHandler = () => {
      const st = getSessionState(owningSessionId);
      if (st.stream) { st.stream.cancel(); st.stream = null; }
      st.streamId = null;
      if (window.__voice) window.__voice.setState('idle');
      finalizeLiveBubble(liveText);
      if (liveText) addChatMessage('ai', liveText);
      thoughtLine('msg', '已停止生成');
      // 如果当前显示嘅就系呢个 session，恢复按钮
      if (activeSessionId === owningSessionId) restoreSendButton();
      else { st.isSending = false; st.stopHandler = null; }
    };
    state.stopHandler = stopHandler;
    syncButtonForSession();  // 统一刷新按钮到停止状态

  state.stream = connectChatStream(streamId, {
      onToken(token, fullText) {
        liveText = fullText;
        if (activeSessionId === owningSessionId) updateLiveBubble(liveText);
        if (activeSessionId === owningSessionId && window.__voice) window.__voice.setState('speaking');
      },
      onReasoning(text) {
        if (activeSessionId === owningSessionId) {
          if (window.__voice) window.__voice.setState('thinking');
          setAiActivity('thinking', '推理中…');
          updateLiveBubble(liveText + '\n\n_💭 推理中…_');
        }
      },
      onTool(tc) {
        if (activeSessionId === owningSessionId) {
          setAiActivity('executing', tc.name);
          window.__voice?.setState('speaking');
          thoughtLine('tool', `${tc.name}: ${(tc.preview || JSON.stringify(tc.args||{}).slice(0, 80))}`, tc.name, true);
          updateLiveBubble(liveText + `\n\n> 🔧 **${tc.name}** _执行中…_`);
        }
      },
      onToolResult(tc) {
        if (activeSessionId === owningSessionId) {
          const ok = !tc.result?.startsWith?.('Error');
          thoughtLine('tool', `${tc.name} ${ok ? '✓' : '✗'}`, tc.name, ok);
          const resultPreview = (tc.result || '').slice(0, 120);
          updateLiveBubble(liveText + `\n\n> 🔧 **${tc.name}** ${ok ? '✅' : '❌'} ${resultPreview}`);
        }
      },
      onDone(finalText, toolCalls, data) {
        finalizeLiveBubble(finalText);
        setAiActivity('idle', '空闲');
        window.__voice?.setState('idle');
        thoughtLine('msg', `回复完成 · ${finalText.length} 字符 · ${toolCalls.length} 次工具调用`);
        const doneState = getSessionState(owningSessionId);
        doneState.stream = null;
        doneState.streamId = null;
        if (activeSessionId === owningSessionId) restoreSendButton();
        else doneState.isSending = false;
        setTimeout(loadSessions, 1000);
        setTimeout(loadTokenUsage, 1500);
      },
      onError(err) {
        console.warn('[SSE]', err);
        const errState = getSessionState(owningSessionId);
        if (errState.stream) { finalizeLiveBubble(liveText); errState.stream = null; }
        errState.streamId = null;
        if (activeSessionId === owningSessionId) { setAiActivity('idle', '空闲'); restoreSendButton(); }
        else errState.isSending = false;
      },
      onCancel() {
        const cancelState = getSessionState(owningSessionId);
        cancelState.stream = null;
        cancelState.streamId = null;
        if (activeSessionId === owningSessionId) { restoreSendButton(); setAiActivity('idle', '空闲'); }
        else cancelState.isSending = false;
      },
    });
  } catch (e) {
    console.error('[send]', e);
    thoughtLine('msg', `发送失败: ${e.message}`);
    setAiActivity('idle', '空闲');
    dom.sendBtn.textContent = t('send'); dom.sendBtn.style.background = '';
    dom.sendBtn.onclick = sendMessage; dom.sendBtn.disabled = false; isSending = false;
  }
}

// ── 流式气泡管理 ──
let liveBubbleEl = null;

function updateLiveBubble(text) {
  if (!liveBubbleEl) {
    liveBubbleEl = document.createElement('div');
    liveBubbleEl.style.cssText = `
      display:flex;flex-direction:column;gap:4px;padding:8px 0;
      animation: fade-up 0.3s ease-out;
    `;
    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:12px;';
    header.innerHTML = `<span style="font-weight:600;color:var(--brand-primary);">Hermes</span>
      <span style="color:var(--dim);font-size:10px;" class="live-time">${tsTime()}</span>
      <span style="color:var(--warn);font-size:10px;">● 流式</span>`;
    liveBubbleEl.appendChild(header);
    const body = document.createElement('div');
    body.className = 'live-body';
    body.style.cssText = `
      color:var(--ink);font-size:14px;line-height:1.7;
      padding:8px 12px;border-radius:var(--radius-sm);
      background:var(--brand-glow);border:1px solid rgba(124,92,231,0.15);
      max-width:85%;
    `;
    liveBubbleEl.appendChild(body);
    dom.chatMessages.appendChild(liveBubbleEl);
  }
  const body = liveBubbleEl.querySelector('.live-body');
  if (body) body.innerHTML = renderMarkdown(text);
  dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;
}

function finalizeLiveBubble(text) {
  if (liveBubbleEl) {
    const liveDot = liveBubbleEl.querySelector('.live-time');
    if (liveDot) {
      const headerDiv = liveDot.parentElement;
      const streamBadge = headerDiv?.querySelector('span:last-child');
      if (streamBadge && streamBadge.textContent.includes('流式')) {
        streamBadge.remove();
      }
    }
    liveBubbleEl = null;
  } else if (text) {
    // 冇流式气泡（极快响应），直接加普通消息
    addChatMessage('ai', text);
  }
}

// ═══════════════════════════════════════════════════════════════
// Session 列表
// ═══════════════════════════════════════════════════════════════
async function loadSessions() {
  try {
    const sessions = await HermesAPI.listSessions();
    dom.statSessions.textContent = String(sessions.length);

    // 渲染 session 列表
    const listEl = dom.sessionList;
    // 保留 "新会话" 按钮
    const existingItems = listEl.querySelectorAll('.session-item');
    existingItems.forEach(el => el.remove());

    if (sessions.length === 0) {
      dom.sessionEmpty.style.display = '';
      dom.sessionCount.textContent = '0';
      return;
    }

    dom.sessionEmpty.style.display = 'none';
    dom.sessionCount.textContent = String(sessions.length);

    sessions.forEach(s => {
      const div = document.createElement('div');
      div.className = 'session-item';
      if (s.session_id === activeSessionId) div.classList.add('active');
      const sourceIcon = s.source === 'weixin' ? '💬' : s.source === 'cron' ? '⏰' : '🌐';
      div.innerHTML = `
        <span style="font-size:10px;flex-shrink:0;">${sourceIcon}</span>
        <span class="session-title" title="${escapeHtml(s.title||'')}">${escapeHtml(s.title || '未命名会话')}</span>
        <span class="session-time">${s.message_count || 0}</span>
        <button class="session-delete-btn" title="删除会话" style="display:none;background:none;border:none;color:var(--danger);cursor:pointer;font-size:12px;padding:0 4px;">×</button>
      `;
      div.addEventListener('click', () => selectSession(s.session_id));
      div.addEventListener('mouseenter', () => { div.querySelector('.session-delete-btn').style.display = ''; });
      div.addEventListener('mouseleave', () => { div.querySelector('.session-delete-btn').style.display = 'none'; });
      div.querySelector('.session-delete-btn').addEventListener('click', async (ev) => {
        ev.stopPropagation();
        if (confirm(`删除会话 "${s.title || s.session_id}" ？`)) {
          try { await HermesAPI.deleteSession(s.session_id); loadSessions(); if (activeSessionId === s.session_id) { activeSessionId = null; dom.chatMessages.innerHTML = ''; } } catch(e) { alert('删除失败: '+e.message); }
        }
      });
      listEl.appendChild(div);
    });

    // 自动选择第一个 session（如果冇活跃嘅）
    if (!activeSessionId && sessions.length > 0) {
      selectSession(sessions[0].session_id, true);
    }
  } catch (e) {
    console.warn('[sessions]', e.message);
    dom.sessionEmpty.textContent = '无法加载会话';
    dom.sessionEmpty.style.display = '';
  }
}

let currentMessageOffset = 0;
const MESSAGE_PAGE_SIZE = 30;
let isLoadingMore = false;
let allMessagesLoaded = false;

async function selectSession(sid, silent = false) {
  // ⚠️ 切换会话时唔取消旧 stream — 旧会话继续运行
  // 只切换 UI 状态到新会话
  activeSessionId = sid;
  currentMessageOffset = 0;
  allMessagesLoaded = false;

  // 同步按钮状态到新会话
  syncButtonForSession();

  // 更新 UI 高亮
  document.querySelectorAll('.session-item').forEach(el => {
    el.classList.toggle('active', el.querySelector('.session-title')?.textContent && sid === activeSessionId);
  });

  if (silent) return;

  try {
    const data = await HermesAPI.getSession(sid, MESSAGE_PAGE_SIZE);
    dom.chatMessages.innerHTML = '';
    const messages = data.messages || [];
    messages.forEach(m => {
      const role = m.role === 'user' ? 'user' : m.role === 'assistant' ? 'ai' : 'system';
      const content = m.content || '';
      if (content.trim()) addChatMessage(role, content, true);
    });
    currentMessageOffset = messages.length;
    if (messages.length < MESSAGE_PAGE_SIZE) allMessagesLoaded = true;
    if (messages.length === 0) {
      addChatMessage('system', `会话 \`${sid.slice(0, 8)}…\` 已加载 · 暂无消息`);
    }
    if (data.model) dom.infoModel.textContent = data.model;
  } catch (e) {
    console.warn('[session]', e.message);
  }
}

async function loadMoreMessages() {
  if (!activeSessionId || isLoadingMore || allMessagesLoaded) return;
  isLoadingMore = true;
  try {
    const data = await HermesAPI.getSession(activeSessionId, currentMessageOffset + MESSAGE_PAGE_SIZE);
    const messages = data.messages || [];
    if (messages.length <= currentMessageOffset) { allMessagesLoaded = true; isLoadingMore = false; return; }
    const newMsgs = messages.slice(currentMessageOffset);
    // 記住當前 scroll 高度
    const chatEl = dom.chatMessages;
    const oldScroll = chatEl.scrollHeight;
    // 插入舊消息到頂部
    newMsgs.reverse().forEach(m => {
      const role = m.role === 'user' ? 'user' : m.role === 'assistant' ? 'ai' : 'system';
      const content = m.content || '';
      if (content.trim()) {
        const div = buildChatMessage(role, content);
        chatEl.insertBefore(div, chatEl.firstChild);
      }
    });
    currentMessageOffset = messages.length;
    if (newMsgs.length < MESSAGE_PAGE_SIZE) allMessagesLoaded = true;
    // 保持 scroll 位置
    chatEl.scrollTop = chatEl.scrollHeight - oldScroll;
  } catch(e) { console.warn('[loadMore]', e.message) }
  finally { isLoadingMore = false; }
}

function buildChatMessage(role, text) {
  const div = document.createElement('div');
  div.style.cssText = 'display:flex;flex-direction:column;gap:4px;padding:8px 0;animation: fade-up 0.3s ease-out;';
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;gap:8px;font-size:12px;';
  const label = document.createElement('span');
  label.style.cssText = `font-weight:600;color:${role==='user'?'var(--accent-cool)':'var(--brand-primary)'};`;
  label.textContent = role === 'user' ? 'You' : 'Hermes';
  header.appendChild(label);
  div.appendChild(header);
  const body = document.createElement('div');
  body.style.cssText = `color:var(--ink);font-size:14px;line-height:1.7;padding:8px 12px;border-radius:var(--radius-sm);background:${role==='user'?'var(--panel-hover)':'var(--brand-glow)'};border:1px solid ${role==='user'?'var(--line)':'rgba(124,92,231,0.15)'};max-width:85%;`;
  body.innerHTML = renderMarkdown(text);
  div.appendChild(body);
  return div;
}

// ═══════════════════════════════════════════════════════════════
// 右側面板：焦點列表 + Token 用量 + 記憶搜索
// ═══════════════════════════════════════════════════════════════
async function loadFocusList() {
  try {
    const data = await HermesAPI.getFocusStack();
    if (!data || !data.focus_stack) return;
    const list = document.getElementById('focus-list');
    if (!list) return;
    const actives = data.focus_stack.filter(f => f.is_active);
    list.innerHTML = actives.length ? actives.slice(0, 6).map(f => {
      const topics = (f.topic || []).join(', ');
      return `<div style="display:flex;align-items:center;gap:6px;padding:3px 0;">
        <span style="width:6px;height:6px;border-radius:50%;background:var(--accent-warm);flex-shrink:0;"></span>
        <span style="color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(topics)}</span>
        <span style="color:var(--dim);flex-shrink:0;">×${f.hit_count}</span>
      </div>`;
    }).join('') : '<div style="color:var(--dim);text-align:center;padding:8px;">无活跃焦点</div>';
  } catch (e) { /* silent */ }
}

async function loadTokenUsage() {
  try {
    const sessions = await HermesAPI.listSessions();
    if (!sessions || !sessions.length) return;
    // Token 數據喺 sessions list 入面，唔係單個 session GET
    const active = sessions.find(s => s.session_id === activeSessionId) || sessions[0];
    if (active) {
      setText('tok-input', formatNum(active.input_tokens || 0));
      setText('tok-output', formatNum(active.output_tokens || 0));
      setText('tok-cache', (active.cache_hit_percent || 0) + '%');
      setText('tok-cost', '$' + (active.estimated_cost || 0).toFixed(4));
      updateContextRing(active.last_prompt_tokens || 0, active.context_length || 100000);
    }
  } catch (e) { /* silent */ }
}
function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }

function formatNum(n) {
  if (n >= 1e6) return (n/1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n/1e3).toFixed(1) + 'K';
  return String(n);
}

function updateContextRing(used, total) {
  const arc = document.getElementById('context-ring-arc');
  if (!arc) return;
  const pct = Math.min(100, (used / total) * 100);
  const circumference = 100.5;
  const offset = circumference - (pct / 100) * circumference;
  arc.setAttribute('stroke-dashoffset', String(offset));
  const text = arc.parentElement?.querySelector('text');
  if (text) text.textContent = Math.round(pct) + '%';
}

// ── ACUI 卡片：定時任務 + 工具調用 + 記憶更新 ──
let lastKnownSessionCount = 0;
let lastKnownToolCount = 0;

async function loadCronCards() {
  try {
    const sessions = await HermesAPI.listSessions();
    if (!sessions || !sessions.length) return;

    // 1. Cron 定時任務
    const cronSessions = sessions.filter(s => s.source === 'cron');
    if (cronSessions.length) {
      const lines = cronSessions.slice(0, 4).map(s => {
        const ok = s.last_message_at && (Date.now()/1000 - s.last_message_at) < 86400;
        return `${ok?'✅':'⚠️'} ${(s.title||'').slice(0, 30)}`;
      });
      mountCard({ title: '⏰ Cron Jobs', body: lines.join('\n'), kind: 'cron', duration: 8000 });
    }

    // 2. Session 變化檢測
    const totalMsgs = sessions.reduce((sum,s) => sum + (s.message_count||0), 0);
    if (lastKnownSessionCount && sessions.length !== lastKnownSessionCount) {
      const diff = sessions.length - lastKnownSessionCount;
      mountCard({ title: '📊 Sessions', body: `${diff>0?'+':''}${diff} 個新會話 · 共 ${sessions.length} 個 · ${totalMsgs} 條消息`, kind: 'session', duration: 6000 });
    }
    lastKnownSessionCount = sessions.length;

    // 3. 每 5 分鐘輪詢
    setTimeout(loadCronCards, 300000);
  } catch (e) { setTimeout(loadCronCards, 300000); }
}

// ── Cron 面板 ──
async function loadCronPanel() {
  try {
    const data = await HermesAPI.getCronJobs();
    if (!data || !data.jobs) return;
    const list = document.getElementById('cron-list');
    if (!list) return;
    list.innerHTML = data.jobs.map(j => {
      const s = j.last_status === 'ok' ? '✅' : j.last_status === 'error' ? '❌' : j.enabled ? '⏳' : '⏸';
      return `<div style="display:flex;align-items:center;gap:4px;padding:1px 0;">
        <span>${s}</span><span style="color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">${escapeHtml((j.name||'').slice(0,25))}</span>
        <span style="color:var(--dim);flex-shrink:0;">${(j.schedule||'').slice(0,10)}</span>
      </div>`;
    }).join('') || '<div style="color:var(--dim);text-align:center;padding:4px;">无任务</div>';
  } catch(e) {}
}

// ── 工作區檔案面板 ──
async function loadWorkspacePanel() {
  try {
    const data = await HermesAPI.getWorkspace();
    if (!data || !data.files) return;
    const list = document.getElementById('workspace-list');
    if (!list) return;
    const recent = data.files.sort((a,b)=>b.mtime-a.mtime).slice(0, 15);
    list.innerHTML = recent.map(f => {
      const icon = f.type === 'dir' ? '📁' : f.name.endsWith('.md')?'📝':f.name.endsWith('.py')?'🐍':f.name.endsWith('.js')?'📜':f.name.endsWith('.json')?'📋':'📄';
      const size = f.size > 1024 ? (f.size/1024).toFixed(1)+'K' : f.size+'B';
      return `<div style="display:flex;align-items:center;gap:4px;padding:1px 0;">
        <span>${icon}</span><span style="color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;">${escapeHtml(f.name)}</span>
        <span style="color:var(--dim);flex-shrink:0;">${f.type==='dir'?'':size}</span>
      </div>`;
    }).join('') || '<div style="color:var(--dim);text-align:center;padding:4px;">空目录</div>';
  } catch(e) {}
}

// ── PWA ──
(function initPWA() {
  const link = document.createElement('link');
  link.rel = 'manifest';
  link.href = '/static/native/manifest.json';
  document.head.appendChild(link);
  // Service Worker 禁用 — 开发阶段拦截 API POST 请求导致失败
  // if ('serviceWorker' in navigator) {
  //   navigator.serviceWorker.register('/static/native/sw.js').catch(() => {});
  // }
})();

function initMemorySearch() {
  const input = document.getElementById('memory-search-input');
  const btn = document.getElementById('memory-search-btn');
  const results = document.getElementById('memory-search-results');
  if (!input || !btn || !results) return;

  async function doSearch() {
    const q = input.value.trim();
    if (!q) { results.innerHTML = ''; return; }
    results.innerHTML = '<div style="color:var(--dim);">搜索中…</div>';
    try {
      const data = await HermesAPI.searchMemory(q, 10);
      if (!data || !data.results || !data.results.length) {
        results.innerHTML = '<div style="color:var(--dim);">无结果</div>';
        return;
      }
      results.innerHTML = data.results.map(r => {
        const roleIcon = r.role === 'user' ? '👤' : r.role === 'assistant' ? '🤖' : '🔧';
        return `<div style="padding:3px 0;border-bottom:1px solid var(--line);cursor:pointer;"
          title="${escapeHtml(r.content)}">
          ${roleIcon} <span style="color:var(--ink);">${escapeHtml(r.content.slice(0, 80))}${r.content.length>80?'…':''}</span>
          <span style="color:var(--dim);">${escapeHtml(r.session_source)}</span>
        </div>`;
      }).join('');
    } catch (e) {
      results.innerHTML = '<div style="color:var(--danger);">搜索失败</div>';
    }
  }

  btn.addEventListener('click', doSearch);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });
}

function showNodeDetail(d) {
  const typeZH = {'focus_active':'🔥 活跃焦点','focus_inactive':'💤 休眠焦点','mem_fact':'📌 记忆事实','memory':'💾 记忆','knowledge':'📚 知识','config':'⚙ 配置','core':'🧠 核心'};
  const infoStatus = document.getElementById('info-status');
  if (infoStatus) {
    infoStatus.innerHTML = `<span style="color:var(--accent-warm);">${typeZH[d.type]||d.type}</span>`;
  }
  const infoModel = document.getElementById('info-model');
  if (infoModel) {
    const hits = d.hit_count ? ` · 命中 ${d.hit_count} 次` : '';
    const sal = d.salience ? ` · 重要性 ${'★'.repeat(Math.min(5, d.salience||1))}` : '';
    infoModel.textContent = (d.title||'') + hits + sal;
  }
}

function escapeHtml(text) {
  return String(text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ═══════════════════════════════════════════════════════════════
// 记忆数据接入
// ═══════════════════════════════════════════════════════════════
async function loadMemoryForGraph() {
  try {
    const data = await HermesAPI.getMemoryGraph();
    if (!data || !data.nodes || !data.nodes.length) {
      thoughtLine('msg', '记忆图谱: 暂无数据');
      return;
    }

    // 转换 Hermes 记忆节点为图谱格式
    const memories = data.nodes.map(n => ({
      id: n.id,
      title: n.title || 'untitled',
      type: n.type || 'memory',
      desc: n.conclusions || n.entities || n.tags || '',
      ts: (n.updated_at || n.started_at || 0) * 1000,  // 转毫秒
      salience: n.salience || 1,
      hit_count: n.hit_count || 0,
      is_active: n.is_active || false,
    }));

    // 清空旧 mock 节点，用真实数据重建
    if (window.__memoryGraph) {
      // 清空现有节点
      window.__memoryGraph.nodes.length = 0;
      // 加入新节点
      window.__memoryGraph.addMemoryNodes(memories);

      // 加真实连线
      if (data.links && data.links.length) {
        data.links.forEach(l => {
          const sid = typeof l.source === 'object' ? l.source.id || l.source : l.source;
          const tid = typeof l.target === 'object' ? l.target.id || l.target : l.target;
          const lid = `${sid}-${tid}`;
          // 避免重复连线
          const exists = window.__memoryGraph.links.some(el => el._lid === lid);
          if (!exists) {
            window.__memoryGraph.links.push({
              source: sid, target: tid, _lid: lid,
              _kind: l.kind === 'temporal' ? 'visual_random' : 'memory_link',
            });
          }
        });
        window.__memoryGraph.renderDynamicNodes?.();
      }
    }

    dom.statMemories.textContent = String(data.node_count || memories.length);
    const activeCount = memories.filter(m => m.is_active).length;
    const inactiveCount = memories.filter(m => !m.is_active && m.type?.startsWith('focus')).length;
    const factCount = memories.filter(m => m.type?.startsWith('mem_')).length;
    // ★ 更新圖例數字
    setText('legend-active-count', String(activeCount));
    setText('legend-inactive-count', String(inactiveCount));
    setText('legend-fact-count', String(factCount));
    thoughtLine('msg', `记忆图谱已加载: ${data.node_count || memories.length} 节点 · ${data.link_count || 0} 连线 · ${activeCount} 活跃焦点`);
  } catch (e) {
    console.warn('[memory]', e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// 初始化（Phase 2 升级版）
// ═══════════════════════════════════════════════════════════════
function init() {
  // ═══ Safari Debug — 写日志到页面 ═══
  var debugEl = document.createElement('div');
  debugEl.id = '__hermes_debug';
  debugEl.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:99999;background:#000;color:#0f0;font:11px monospace;padding:8px 12px;max-height:200px;overflow-y:auto;';
  document.body.prepend(debugEl);
  var steps = [];
  function step(msg, ok) {
    steps.push((ok?'✅':'❌')+' '+msg);
    debugEl.textContent = steps.join('\n');
  }
  function safe(fn, name) {
    try { fn(); step(name, true); } catch(e) { step(name+' — '+e.message, false); }
  }

  step('⚚ Hermes Glass', true);

  safe(function(){ initTheme(); }, 'initTheme');
  safe(function(){ initPanelCollapse(); }, 'initPanelCollapse');
  safe(function(){ initThoughtStreamCollapse(); }, 'initThoughtStreamCollapse');
  safe(function(){ initMemoryGraph(); }, 'initMemoryGraph');
  safe(function(){ initChat(); }, 'initChat');
  safe(function(){ initSlashMenu(); }, 'initSlashMenu');
  safe(function(){ initSettings(); }, 'initSettings');

  // 连接状态
  safe(function(){
    dom.infoStatus.innerHTML = '● 在线';
    dom.connDot.className = 'status-dot online';
    dom.connText.textContent = '已连接 Hermes';
  }, 'connectionStatus');

  // 語言切換
  function refreshAllI18n() {
    try {
      const inp = document.getElementById('msg-input');
      if (inp) inp.placeholder = t('msgPlaceholder');
      const sb = document.getElementById('send-btn');
      if (sb && !isSending) sb.textContent = t('send');
      const newBtn = document.getElementById('new-session-btn');
      if (newBtn) newBtn.textContent = t('newSession');
    } catch(_) {}
  }
  function initLangButtons() {
    const btns = document.querySelectorAll('.lang-btn');
    btns.forEach(btn => {
      const lang = btn.dataset.lang;
      btn.classList.toggle('active', lang === getLang());
      btn.onclick = (e) => {
        e.preventDefault(); e.stopPropagation();
        setLang(lang);
        document.querySelectorAll('.lang-btn').forEach(b => b.classList.toggle('active', b.dataset.lang === getLang()));
        refreshAllI18n();
      };
    });
  }
  setTimeout(initLangButtons, 300);

  // ACUI 卡片系統
  safe(function(){ initACUI(document.getElementById('acui-host')); }, 'initACUI');

  // 語音面板 + Push-to-Talk
  var voice = null;
  safe(function(){
    voice = initVoicePanel({
      canvasId: 'voice-canvas', voiceBtnId: 'voice-btn',
      getMsgInput: () => dom.msgInput,
      getSendFn: () => sendMessage,
    });
    if (voice && voice.onTranscript) {
      voice.onTranscript((text, isFinal) => {
        if (!text) return;
        dom.msgInput.focus();
        if (isFinal) {
          thoughtLine('msg', '🎤 ' + text.slice(0, 60));
        }
      });
    }
    window.__voice = voice;
  }, 'initVoice');

  // 快捷操作按鈕
  safe(function(){
    $('qa-new-session')?.addEventListener('click', ()=>{ dom.newSessionBtn?.click() });
    $('qa-clear-chat')?.addEventListener('click', ()=>{ dom.chatMessages.innerHTML=''; addChatMessage('system','聊天已清空') });
    $('qa-reset-graph')?.addEventListener('click', ()=>{ const btn=$('qa-reset-graph'); if(btn) window.__memoryGraph?.svg?.transition().duration(500).call(window.__memoryGraph.zoom?.transform, d3.zoomIdentity) });
    $('qa-graph-toggle')?.addEventListener('click', ()=>{ dom.graphToggleBtn?.click() });
  }, 'qaButtons');

  // 加載真實數據
  safe(function(){ loadSessions(); }, 'loadSessions');
  safe(function(){ setTimeout(loadMemoryForGraph, 1500); }, 'loadMemoryGraph');
  safe(function(){ setTimeout(loadFocusList, 2000); }, 'loadFocusList');
  safe(function(){ setTimeout(loadTokenUsage, 2500); }, 'loadTokenUsage');
  safe(function(){ setTimeout(loadCronCards, 3000); }, 'loadCronCards');
  safe(function(){ setTimeout(loadWorkspacePanel, 4000); }, 'loadWorkspace');
  safe(function(){ initMemorySearch(); }, 'initMemorySearch');

  safe(function(){
    addChatMessage('system', t('welcome'));
    thoughtLine('msg', t('startupLog'));
    thoughtLine('msg', t('connected') + ': Hermes WebUI');
  }, 'welcomeMessage');

  safe(function(){ refreshAllI18n(); setAiActivity('idle', '空闲'); }, 'finalUI');

  step('✅ Init complete!', true);
  setTimeout(function(){ debugEl.style.display='none'; }, 8000);
}

// 启动
document.addEventListener('DOMContentLoaded', init);
