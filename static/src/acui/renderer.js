/**
 * ACUI Renderer — Agent 推送交互式卡片到 UI
 * 三種 placement: notification (右上) / center (居中) / floating (浮動)
 */

const instances = new Map();
let notificationHost = null;
let cardIdCounter = 0;

export function initACUI(hostEl) {
  notificationHost = hostEl;
  if (!document.getElementById('acui-animations')) {
    const link = document.createElement('link');
    link.id = 'acui-animations';
    link.rel = 'stylesheet';
    link.href = 'src/acui/animations.css';
    document.head.appendChild(link);
  }
}

export function mountCard({ id, title, body, kind = 'info', duration = 8000, placement = 'notification', actions = [] }) {
  if (!notificationHost) return null;
  const cid = id || `card_${++cardIdCounter}_${Date.now()}`;

  // 如果已有同 id 卡片，更新而唔係新增
  if (instances.has(cid)) {
    updateCard(cid, { title, body, kind, actions });
    return cid;
  }

  const el = document.createElement('div');
  el.className = `acui-card acui-${kind}`;
  el.dataset.cid = cid;
  el.dataset.placement = placement;

  const kindIcon = { info: 'ℹ️', success: '✅', warn: '⚠️', error: '❌', cron: '⏰', session: '💬' };
  const icon = kindIcon[kind] || '📌';

  el.innerHTML = `
    <div class="acui-card-head">
      <span class="acui-card-icon">${icon}</span>
      <span class="acui-card-title">${escapeCard(title || '')}</span>
      <button class="acui-card-close" data-cid="${cid}">×</button>
    </div>
    ${body ? `<div class="acui-card-body">${escapeCard(body)}</div>` : ''}
    ${actions.length ? `<div class="acui-card-actions">${actions.map(a => `<button class="acui-card-btn" data-action="${a.action}">${a.label}</button>`).join('')}</div>` : ''}
  `;

  // 關閉按鈕
  el.querySelector('.acui-card-close')?.addEventListener('click', () => dismissCard(cid));

  // Action 按鈕
  el.querySelectorAll('.acui-card-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.dataset.action;
      window.dispatchEvent(new CustomEvent('acui:action', { detail: { cid, action } }));
    });
  });

  notificationHost.appendChild(el);
  instances.set(cid, { el, mountedAt: Date.now(), duration });

  // 入場動畫
  requestAnimationFrame(() => el.classList.add('acui-enter-active'));

  // 自動關閉
  if (duration > 0) {
    setTimeout(() => dismissCard(cid), duration);
  }

  return cid;
}

export function updateCard(cid, { title, body, kind, actions }) {
  const inst = instances.get(cid);
  if (!inst) return;
  const { el } = inst;
  if (title !== undefined) {
    const titleEl = el.querySelector('.acui-card-title');
    if (titleEl) titleEl.textContent = title;
  }
  if (body !== undefined) {
    let bodyEl = el.querySelector('.acui-card-body');
    if (body && !bodyEl) {
      bodyEl = document.createElement('div');
      bodyEl.className = 'acui-card-body';
      el.querySelector('.acui-card-head')?.after(bodyEl);
    }
    if (bodyEl) bodyEl.textContent = body;
  }
}

export function dismissCard(cid) {
  const inst = instances.get(cid);
  if (!inst) return;
  const { el } = inst;
  el.classList.add('acui-exit-active');
  el.classList.remove('acui-enter-active');
  setTimeout(() => {
    if (el.parentNode) el.remove();
    instances.delete(cid);
  }, 400);
}

export function clearAllCards() {
  instances.forEach((_, cid) => dismissCard(cid));
}

export function getActiveCards() {
  return [...instances.keys()];
}

function escapeCard(s) {
  return String(s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
