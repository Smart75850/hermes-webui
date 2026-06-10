/**
 * Hermes Glass — i18n 中英雙語
 */
const LANG_KEY = 'hermes-glass-lang';
const translations = {
  zh: {
    sessions: '会话', newSession: '+ 新会话', send: '发送',
    settings: '设置', theme: '主题', voice: '语音',
    tokenUsage: 'Token 用量', input: '输入', output: '输出', cacheHit: '缓存命中', totalCost: '累计成本',
    activeFocus: '活跃焦点', graphLegend: '图谱图例',
    activeFocusNode: '活跃焦点', inactiveFocus: '休眠焦点', memoryFact: '记忆事实',
    memorySearch: '记忆搜索', search: '搜', searchPlaceholder: '搜索 5239 条消息…',
    quickActions: '快捷操作', clearChat: '清空聊天', resetView: '重置视图', toggleGraph: '切换图谱',
    cronJobs: '定时任务', workspace: '工作区',
    aiActivity: '空闲', thinking: '思考中…', holdSpace: '按住 Space 讲嘢',
    thoughtStream: '思考流', connected: '已连接', msgPlaceholder: '向 Hermes 发消息…',
    online: '在线', noSessions: '暂无会话', noActiveFocus: '无活跃焦点',
    streamReady: '系统就绪 · 等待 Hermes 连接…',
    welcome: '⚚ **Hermes Glass** v1.0\n\n✅ 已连接 Hermes Agent\n✅ 记忆图谱: 56 nodes\n✅ 7 套主题 · 语音输入\n\n发送消息开始对话',
    startupLog: '⚚ Hermes Glass v1.0 已启动',
  },
  en: {
    sessions: 'Sessions', newSession: '+ New Session', send: 'Send',
    settings: 'Settings', theme: 'Theme', voice: 'Voice',
    tokenUsage: 'Token Usage', input: 'Input', output: 'Output', cacheHit: 'Cache Hit', totalCost: 'Total Cost',
    activeFocus: 'Active Focus', graphLegend: 'Legend',
    activeFocusNode: 'Active Focus', inactiveFocus: 'Inactive', memoryFact: 'Memory Fact',
    memorySearch: 'Memory Search', search: 'Search', searchPlaceholder: 'Search 5239 messages…',
    quickActions: 'Quick Actions', clearChat: 'Clear Chat', resetView: 'Reset View', toggleGraph: 'Toggle Graph',
    cronJobs: 'Cron Jobs', workspace: 'Workspace',
    aiActivity: 'Idle', thinking: 'Thinking…', holdSpace: 'Hold Space to talk',
    thoughtStream: 'Thought Stream', connected: 'Connected', msgPlaceholder: 'Message Hermes…',
    online: 'Online', noSessions: 'No sessions', noActiveFocus: 'No active focus',
    streamReady: 'System ready · Waiting for Hermes…',
    welcome: '⚚ **Hermes Glass** v1.0\n\n✅ Connected to Hermes Agent\n✅ Memory Graph: 56 nodes\n✅ 7 Themes · Voice Input\n\nStart chatting!',
    startupLog: '⚚ Hermes Glass v1.0 started',
  },
};

let currentLang = localStorage.getItem(LANG_KEY) || 'zh';

export function t(key) {
  return translations[currentLang]?.[key] || translations.zh[key] || key;
}

export function getLang() { return currentLang; }

export function setLang(lang) {
  currentLang = lang;
  localStorage.setItem(LANG_KEY, lang);
  // 刷新 UI 文字
  document.dispatchEvent(new CustomEvent('lang:change', { detail: { lang } }));
}
