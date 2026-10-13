'use strict';
/* SunMemo clothesline renderer - rebuilt R65 (all rounds merged). */
const api = window.sun;
const stage = document.getElementById('stage');
const ropeEl = document.getElementById('rope');
const cardsEl = document.getElementById('cards');
const hangClipBtn = document.getElementById('hangClip');
const hangClipIcon = document.getElementById('hangClipIcon');
const hangClipText = document.getElementById('hangClipText');
const gearBtn = document.getElementById('gear');
let state = { items: [], revealed: false, copiedID: null, userPinned: false };
const slots = new Map();
// 卡片角度持久化：重排微调的新角度先记在这里。主进程因 reorder 广播回推的
// state 早于 set-tilt 落库，回读的是旧角度——在 handleState 里用它覆盖，
// 直到主进程回推的角度与本值一致（已跟上）再清除。
const pendingTilts = new Map();
let hoveredId = null;
let width = 0;
let dragState = null;
// Bug fix: mouseup 里 clearPress() 会清空 dragState，浏览器随后补发的 click 到达
// 时 dragState.moved 守卫恒 false —— Alt 拖拽排序松手必弹预览。记录最近一次
// "已移动拖拽"释放的时间戳，click 处理器据此在 300ms 内拦截。
let lastDragMoved = 0;
window.__lastState = null;

const ICONS = {
  clip: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10.5 1.8 4.2 8.1a3 3 0 1 0 4.3 4.3l6.3-6.3a2 2 0 0 0-2.9-2.9L5.6 9.6a1 1 0 0 0 1.4 1.4l5.2-5.2"/></svg>',
  gear: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 4.75a3.25 3.25 0 1 0 0 6.5 3.25 3.25 0 0 0 0-6.5Zm0 5a1.75 1.75 0 1 1 0-3.5 1.75 1.75 0 0 1 0 3.5Z"/><path d="m14.3 9.44-.98-.57a5.5 5.5 0 0 0 0-1.74l.98-.57a.6.6 0 0 0 .24-.78l-.9-1.56a.6.6 0 0 0-.8-.24l-.97.57a5.42 5.42 0 0 0-1.51-.87V4.5a.6.6 0 0 0-.6-.6H7.24a.6.6 0 0 0-.6.6v1.18c-.55.21-1.06.5-1.5.87l-.98-.57a.6.6 0 0 0-.8.24l-.9 1.56a.6.6 0 0 0 .25.78l.98.57a5.5 5.5 0 0 0 0 1.74l-.98.57a.6.6 0 0 0-.24.78l.9 1.56c.16.29.52.38.8.24l.97-.57c.45.37.96.66 1.51.87v1.18c0 .33.27.6.6.6h3.52a.6.6 0 0 0 .6-.6v-1.18a5.42 5.42 0 0 0 1.5-.87l.98.57c.28.15.64.05.8-.24l.9-1.56a.6.6 0 0 0-.25-.78Z"/></svg>',
  check: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m3 8.6 3.2 3.2L13 5"/></svg>',
  done: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0Zm3.7 6.3-4.2 4.7a1 1 0 0 1-1.5 0L4.3 9.2a1 1 0 1 1 1.4-1.4l1 1 3.5-3.9a1 1 0 0 1 1.5 1.4Z"/></svg>',
  undone: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="8" cy="8" r="6.4"/></svg>',
  x: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/></svg>',
  list: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M5.5 4h8M5.5 8h8M5.5 12h8"/><rect x="2" y="3.2" width="1.8" height="1.8" rx="0.5" fill="currentColor" stroke="none"/><rect x="2" y="7.2" width="1.8" height="1.8" rx="0.5" fill="currentColor" stroke="none"/><rect x="2" y="11.2" width="1.8" height="1.8" rx="0.5" fill="currentColor" stroke="none"/></svg>',
};
hangClipIcon.innerHTML = ICONS.clip;
gearBtn.querySelector('.ic').innerHTML = ICONS.gear;

// R+ pin button
const pinViewBtn = document.createElement('button');
pinViewBtn.className = 'glass gear-btn';
pinViewBtn.title = '盯住（不再自动隐藏）';
pinViewBtn.setAttribute('aria-label', '盯住（不再自动隐藏）');
pinViewBtn.innerHTML = '<span class="ic" aria-hidden="true">📌</span>';
pinViewBtn.addEventListener('click', () => api.send('line:toggle-userpin'));
gearBtn.after(pinViewBtn);

// R148: ⌨ 升级为可搜索命令面板 — 复用 keysPop 容器：顶部搜索框（autofocus）+
// 命令列表。前 8 行沿用原快捷键速查（仅展示），末尾追加可执行命令（读 main.js
// 核对过的已有通道）：上传本地图片、钉住、搜索；统计窗没有 renderer 可达的
// IPC/深链通道（showStats 仅托盘菜单与启动参数可达），按规约跳过该项。
// 过滤为子串匹配（中文/快捷键文本，不区分大小写）；Enter 执行第一条可执行项，
// Esc / 点击面板外关闭。
const COMMANDS = [
  { key: 'Ctrl+Alt+Space', label: '呼出 / 收起晾衣绳' },
  { key: 'Ctrl+Alt+N', label: '新建速记便签' },
  { key: 'Ctrl+Alt+V', label: '挂上剪贴板' },
  { key: 'Ctrl+Alt+F', label: '搜索便签' },
  { key: '双击绳空白', label: '快速新建' },
  { key: 'Alt+拖卡片', label: '调整顺序' },
  { key: 'Shift+拖卡片', label: '撕下贴到桌面' },
  { key: 'Esc / 单击空白', label: '收起预览' },
  { key: '🖼', label: '上传本地图片', cmd: uploadImageCmd },
  { key: '📌', label: '钉住（不再自动隐藏）', cmd: () => api.send('line:toggle-userpin') },
  { key: '🔍', label: '搜索便签窗', cmd: () => api.send('search:open-tag', null) },
  { key: '🕰', label: '时光晾衣绳（回忆归档便签）', cmd: () => api.send('line:memory') },
];
// 本地图片上传：main 无托盘上传专用 IPC（uploadLocalImage 仅托盘可达），但
// line:drop-file 已存在（R94 拖拽落绳同通道）。隐藏 <input type=file> 是用户
// 手势触发，选中后经 getPathForFile 拿绝对路径逐个投递，主进程按扩展名挂卡。
function uploadImageCmd() {
  let inp = document.getElementById('cmdFileInput');
  if (!inp) {
    inp = document.createElement('input');
    inp.id = 'cmdFileInput';
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.multiple = true;
    inp.style.display = 'none';
    inp.addEventListener('change', () => {
      for (const f of [...(inp.files || [])].slice(0, 6)) {
        try { const p = api.getPathForFile(f); if (p) api.send('line:drop-file', p); } catch { /* unreadable entry */ }
      }
      inp.value = '';
    });
    document.body.appendChild(inp);
  }
  inp.click();
}
function closeKeysPop() {
  const p = document.getElementById('keysPop');
  if (p) p.remove();
  document.removeEventListener('mousedown', keysPopOutside, true);
}
function keysPopOutside(ev) {
  if (keysPill.contains(ev.target)) return; // ⌨ 本体留给 click 切换
  const p = document.getElementById('keysPop');
  if (p && !p.contains(ev.target)) closeKeysPop();
}
function renderCmdList(pop, q) {
  const list = pop.querySelector('.cmd-list');
  const needle = (q || '').trim().toLowerCase();
  const rows = COMMANDS.filter(c => !needle || (c.key + ' ' + c.label).toLowerCase().includes(needle));
  list.innerHTML = rows.length
    ? rows.map(c => '<div class="krow' + (c.cmd ? ' cmd-row click' : '') + '" data-i="' + COMMANDS.indexOf(c) + '"><b>' + c.key + '</b><span>' + c.label + '</span></div>').join('')
    : '<div class="krow empty"><span>没有匹配的命令</span></div>';
}
const keysPill = document.createElement('button');
keysPill.className = 'glass gear-btn';
keysPill.title = '命令面板';
keysPill.setAttribute('aria-label', '命令面板');
keysPill.innerHTML = '<span class="ic" aria-hidden="true">⌨</span>';
keysPill.addEventListener('click', () => {
  const old = document.getElementById('keysPop');
  if (old) { closeKeysPop(); return; }
  const pop = document.createElement('div');
  pop.id = 'keysPop';
  pop.className = 'glass cmd';
  pop.innerHTML = '<input class="cmd-input" type="text" placeholder="搜索命令…" aria-label="搜索命令" autofocus><div class="cmd-list"></div>';
  const inp = pop.querySelector('.cmd-input');
  inp.addEventListener('input', () => renderCmdList(pop, inp.value));
  inp.addEventListener('keydown', ev => {
    if (ev.key === 'Enter') {
      const first = pop.querySelector('.krow.click'); // 第一条可执行项（速查行仅展示）
      if (first) { const c = COMMANDS[+first.dataset.i]; closeKeysPop(); c.cmd(); }
    } else if (ev.key === 'Escape') {
      ev.stopPropagation();
      closeKeysPop();
    }
  });
  pop.querySelector('.cmd-list').addEventListener('click', ev => {
    const row = ev.target.closest('.krow.click');
    if (!row) return;
    const c = COMMANDS[+row.dataset.i];
    closeKeysPop();
    c.cmd();
  });
  stage.appendChild(pop);
  renderCmdList(pop, '');
  inp.focus();
  document.addEventListener('mousedown', keysPopOutside, true);
});
gearBtn.after(keysPill);

let ropeWidthDrawn = -1;
function drawRope() {
  const w = window.innerWidth;
  if (w === ropeWidthDrawn) return;
  ropeWidthDrawn = w;
  const sag = L.sag(w);
  ropeEl.setAttribute('viewBox', '0 0 ' + w + ' 44');
  const d = 'M -20 ' + L.ROPE_TOP + ' Q ' + w/2 + ' ' + (L.ROPE_TOP + 2*sag) + ' ' + (w+20) + ' ' + L.ROPE_TOP;
  ropeEl.innerHTML = '<g fill="none">'
    + '<path d="' + d + '" stroke="rgba(0,0,0,0.22)" stroke-width="1.4" transform="translate(0,1.2)"/>'
    + '<path d="' + d + '" stroke="rgb(140,140,140)" stroke-width="1.2"/>'
    + '<path d="' + d + '" stroke="rgba(255,255,255,0.45)" stroke-width="0.4" transform="translate(0,-0.35)"/>'
    + '</g><g>'
    + '<circle cx="6" cy="' + (L.ROPE_TOP+1) + '" r="4" fill="#b8b8c0" stroke="rgba(0,0,0,0.3)" stroke-width="0.8"/>'
    + '<circle cx="6" cy="' + (L.ROPE_TOP+1) + '" r="1.6" fill="#6a6a72"/>'
    + '<circle cx="' + (w-6) + '" cy="' + (L.ROPE_TOP+1) + '" r="4" fill="#b8b8c0" stroke="rgba(0,0,0,0.3)" stroke-width="0.8"/>'
    + '<circle cx="' + (w-6) + '" cy="' + (L.ROPE_TOP+1) + '" r="1.6" fill="#6a6a72"/></g>';
}

function photoSize(item) {
  const maxW = L.CARD_W - 14, maxH = 104;
  const iw = item.thumbW || maxW, ih = item.thumbH || maxH;
  const s = Math.min(maxW / iw, maxH / ih, 1);
  return { w: Math.max(24, iw * s), h: Math.max(18, ih * s) };
}

// 文档卡固定板式：138×116 面 + 边距 = 绳上 150 宽（与图片卡 CARD_W 一致）
function docCardSize() {
  const inset = L.CARD_INSET;
  return { w: L.CARD_W - inset * 2 - 0, h: 118 };
}

function buildSlot(item) {
  const slot = document.createElement('div');
  slot.className = 'slot flying';
  slot.dataset.id = item.id;
  slot.setAttribute('role', 'listitem');
  const arrive = document.createElement('div');
  arrive.className = 'arrive';
  const swing = document.createElement('div');
  swing.className = 'swing';
  arrive.appendChild(swing);
  slot.appendChild(arrive);
  const peg = document.createElement('div');
  peg.className = 'peg';
  swing.appendChild(peg);
  const fx = document.createElement('div');
  fx.className = 'cardfx glass';
  fx.style.borderRadius = 'var(--card-radius)';
  swing.appendChild(fx);
  const card = document.createElement('div');
  card.className = 'card';
  fx.appendChild(card);
  const el = { el: slot, arrive, swing, cardfx: fx, card, item, face: null, key: '', anim: null };
  renderCardContent(el);
  cardsEl.appendChild(slot);
  return el;
}

const thumbCache = new Map();
function renderCardContent(s) {
  const item = s.item;
  if (item.thumb) thumbCache.set(item.id, item.thumb);
  else if (thumbCache.has(item.id)) item.thumb = thumbCache.get(item.id);
  // thumb 自愈：广播的 thumb 是一次性发送，跨窗口序列化（搜索/预览）或
  // reload 竞态都可能让本窗错过唯一一次。缺了就向主进程拉一次。
  if (item.kind === 'image' && !item.thumb && !s._thumbReq) {
    s._thumbReq = true;
    api.invoke('line:thumb', item.id).then(t => {
      const cur = slots.get(item.id);
      if (t && cur) { thumbCache.set(item.id, t); cur.item.thumb = t; cur.key = null; renderCardContent(cur); }
    }).catch(() => { /* window closing etc. */ });
  }
  const card = s.card;
  const key = item.kind === 'memo' ? JSON.stringify(item.memo)
    : item.kind === 'doc' ? 'doc:' + item.docName + ':' + item.docSize
    : (item.thumb ? item.thumb.slice(-48) + item.thumbW + item.thumbH : '');
  if (s.key === key && card.firstChild) return;
  s.key = key;
  card.innerHTML = '';
  if (item.kind === 'memo') {
    const r = L.RATIOS[(item.memo && item.memo.aspectRatio) || 'wide'] || L.RATIOS.wide;
    card.classList.add('memo');
    const tags = window.extractTags(item.memo.text).slice(0, 3);
    const face = document.createElement('div');
    face.className = 'memo-face hit';
    face.style.width = r.content.w + 'px';
    face.style.height = r.content.h + 'px';
    face.style.background = window.cardGradient(item.memo.color);
    // v1.7 晒褪色：晾了几天没动的便签被太阳"晒旧"（saturate 渐降），交互即恢复
    {
      const touched = item.memo.touchedAt || item.memo.createdAt;
      const days = Math.max(0, Math.floor((Date.now() - new Date(touched).getTime()) / 86400000));
      if (days >= 4) face.classList.add('age-2');
      else if (days >= 1) face.classList.add('age-1');
      if (days >= 1) face.title = '晾了 ' + days + ' 天了 · 动一动它就恢复鲜艳';
    }
    face.innerHTML = (item.memo.pinned ? '<span class="pin-badge" title="已置顶">📌</span>' : '')
      + '<div class="memo-body">' + window.renderCardBody(item.memo.text, { done: item.memo.isDone }) + '</div>'
      + (tags.length ? '<div class="tag-row">' + tags.map(t => '<span class="tag-chip">#' + t + '</span>').join('') + '</div>' : '')
      + '<div class="memo-foot"><button class="done-btn ' + (item.memo.isDone ? 'done' : '') + '" title="' + (item.memo.isDone ? '标记为未完成' : '标记为已完成') + '" aria-label="' + (item.memo.isDone ? '标记为未完成' : '标记为已完成') + '">' + (item.memo.isDone ? ICONS.done : ICONS.undone) + '</button>'
      + statsBadge(item.memo)
      + '<span class="memo-time" title="' + window.fullDate(item.memo.createdAt) + '" data-source="' + (item.memo.source || 'manual') + '">' + window.timeAgo(item.memo.createdAt) + '</span></div>'
      + '<div class="hover-tools">'
      + '<button class="tool ' + (item.memo.pinned ? 'on' : '') + '" data-tool="pin" title="' + (item.memo.pinned ? '取消置顶' : '置顶') + '" aria-label="' + (item.memo.pinned ? '取消置顶' : '置顶') + '">📌</button>'
      + '<button class="tool" data-tool="edit" title="编辑" aria-label="编辑">✎</button>'
      + '<button class="tool danger" data-tool="discard" title="撕下" aria-label="撕下">✕</button>'
      + '</div>';
    card.appendChild(face);
    s.face = face;
    // v1.6.1 便签拖出 = 文本内容：拖进聊天框直接发文字，而不是 json 附件。
    // Alt/Shift 手势（重排/撕下）在 mousedown 时动态关掉 draggable 走旧管线。
    face.draggable = true;
    face.addEventListener('dragstart', ev => {
      if (!item.memo || !item.memo.text) { ev.preventDefault(); return; }
      ev.dataTransfer.setData('text/plain', item.memo.text);
      ev.dataTransfer.effectAllowed = 'copyMove';
    });
    face.addEventListener('dragend', () => clearPress());
  } else if (item.kind === 'image') {
    card.classList.add('photo');
    const ps = photoSize(item);
    const clip = document.createElement('div');
    clip.className = 'photo-clip hit';
    clip.style.width = ps.w + 'px';
    clip.style.height = ps.h + 'px';
    const img = document.createElement('img');
    // thumb 未到手时不能写 src=''——空 src 会被解析成页面自身 URL（死链破图）
    if (item.thumb) img.src = item.thumb;
    img.width = ps.w; img.height = ps.h;
    img.draggable = false;
    clip.appendChild(img);
    const badge = document.createElement('span');
    badge.className = 'img-badge';
    badge.textContent = (item.thumbW || '?') + '×' + (item.thumbH || '?');
    badge.title = (item.fileUrl || '').split('/').pop();
    clip.appendChild(badge);
    card.appendChild(clip);
    s.face = clip;
  } else if (item.kind === 'doc') {
    // v1.6 文档卡：类型板式缩略；悬停弹出阅读面板（由 overlay 承载，绳窗太矮）
    card.classList.add('doc');
    const ps = docCardSize(item);
    const face = document.createElement('div');
    face.className = 'doc-face hit';
    face.style.width = ps.w + 'px';
    face.style.height = ps.h + 'px';
    face.innerHTML = window.DOCR.cardHTML(item);
    face.addEventListener('click', () => api.send('line:open', item.id));
    card.appendChild(face);
    s.face = face;
    if (item.docType === 'pdf') {
      const cv = face.querySelector('.doc-page1');
      if (cv) window.DOCR.attachPdfThumb(cv, item);
    }
  }
  const xbtn = document.createElement('button');
  xbtn.className = 'discard-x glass';
  xbtn.title = '撕下';
  xbtn.setAttribute('aria-label', '撕下');
  xbtn.innerHTML = ICONS.x;
  xbtn.addEventListener('click', ev2 => { ev2.stopPropagation(); api.send('line:discard', item.id); });
  card.appendChild(xbtn);
  const badge = document.createElement('div');
  badge.className = 'copied-badge glass';
  badge.innerHTML = ICONS.check + '<span>已复制</span>';
  card.appendChild(badge);
}

function statsBadge(memo) {
  const st = window.todoStats ? window.todoStats(memo.text) : null;
  if (!st || st.total === 0) return '';
  const all = st.completed === st.total;
  return '<span class="todo-stats ' + (all ? 'all' : '') + '">' + st.completed + '/' + st.total + ' 完成</span>';
}

function applyPeek() {
  const items = state.items;
  const hIdx = items.findIndex(i => i.id === hoveredId);
  items.forEach((item, index) => {
    const s = slots.get(item.id);
    if (!s) return;
    const peek = L.peekTransform(index, hIdx, items.length);
    s.el.style.zIndex = peek.z;
    s.el.style.transform = 'translate(' + peek.xOff + 'px, ' + peek.yOff + 'px) rotate(' + peek.tilt + 'deg)';
  });
  const off = L.addCardPeekOffset(hIdx, items.length);
  if (addSlotEl) addSlotEl.style.transform = 'translateX(' + off + 'px)';
}

let layoutQueued = false;
function scheduleLayout() {
  if (layoutQueued) return;
  layoutQueued = true;
  const run = () => { layoutQueued = false; layout(); };
  // R102 CRITICAL: rAF never fires while the window is hidden/occluded (the
  // tucked state hides the window) and the queued callback is dropped — then
  // layoutQueued sticks true and the renderer freezes forever: card updates,
  // checkbox syncs, reorder ghosts all dead while CSS effects kept working,
  // which disguised the freeze for 100 rounds. The timeout fallback kicks in
  // whenever rAF was starved.
  requestAnimationFrame(run);
  setTimeout(() => { if (layoutQueued) { layoutQueued = false; layout(); } }, 120);
}

// ---- v1.6 横向滚动：绳不动、卡片沿绳滑 -------------------------------------
// 挂满时不再把间距压到 45px 挤成一团，而是保持自然间距向外溢出，卡片层整体
// 平移（translateX）。滚轮 / 横向拖拽 / 两端箭头皆可平移；绳的垂曲线固定，
// 卡片 top 跟随其屏幕 x 重新落位——滑动时有"沿着绳浪走"的物理感。
const TRACK_MARGIN = 110;   // 两端留白（约半张卡）
const TRACK_GAP = 46;       // 相邻卡片净距
let track = null;           // { map:id→trackX中心, addX, contentW, maxScroll }
let scrollX = 0;
// v1.7 趣味件状态（必须先于 placeRopeTops 定义——早期广播会触发 layout）
let birdEl = null, birdLeaveTimer = null;
let discoverSlotEl = null;
let discoverIdx = Math.floor(Date.now() / 300000);
let prevIds = new Set();
let scrollPaintQueued = false;

function ropeWidthOf(item) {
  return item.kind === 'memo'
    ? (L.RATIOS[(item.memo && item.memo.aspectRatio) || 'wide'] || L.RATIOS.wide).rope.w
    : L.CARD_W;
}
function computeTrack(items, width) {
  const natural = L.dynamicSpacing(1, width);
  const widths = items.map(ropeWidthOf);
  const addW = L.RATIOS.wide.rope.w;
  const discW = 184; // 每日发现卡实际宽度（与 .disc-holder 一致）
  const need = TRACK_MARGIN + widths.reduce((a, b) => a + b, 0)
    + TRACK_GAP * Math.max(0, items.length - 1) + TRACK_GAP + addW + TRACK_MARGIN;
  if (need <= width - 8) return null; // 装得下 → 保持现行居中布局（scrollX=0）
  const map = new Map();
  let acc = TRACK_MARGIN;
  items.forEach((it, i) => { map.set(it.id, acc + widths[i] / 2); acc += widths[i] + TRACK_GAP; });
  // 每日发现卡：添加卡左侧（计入轨道几何——可达、不重叠、不消失）
  const discX = acc + discW / 2;
  const addX = acc + discW + TRACK_GAP + addW / 2;
  const contentW = acc + discW + TRACK_GAP + addW + TRACK_MARGIN;
  return { map, addX, discX, contentW, maxScroll: Math.max(0, contentW - width) };
}
function clampScroll(x) { return Math.max(0, Math.min(track ? track.maxScroll : 0, x)); }
function slotScreenX(item, index, total, width) {
  const x = track ? track.map.get(item.id) : L.xAt(index, total, width);
  return { x, sx: x - scrollX };
}
function placeRopeTops(items) {
  const total = items.length + 2; // 与 layout() 同一序列
  items.forEach((item, index) => {
    const s2 = slots.get(item.id);
    if (!s2) return;
    const x = track ? track.map.get(item.id) : L.xAt(index, total, width);
    const ry = L.ropeY(x - scrollX, width);
    s2.el.style.top = (ry - L.PIN_ABOVE) + 'px';
  });
  if (addSlotEl) {
    const x = track ? track.addX : L.xAt(items.length + 1, total, width);
    const ry = L.ropeY(x - scrollX, width);
    addSlotEl.style.top = (ry - L.PIN_ABOVE) + 'px';
  }
  if (typeof updateDiscover === 'function') updateDiscover(); // 创建 + 定位（开机首帧必须调用）
  if (discoverSlotEl) {
    const x = track ? track.discX : L.xAt(items.length, items.length + 2, width);
    const ry = L.ropeY(x - scrollX, width);
    discoverSlotEl.style.top = (ry - L.PIN_ABOVE) + 'px';
  }
  if (typeof attachSeed === 'function') {
    const seed = document.getElementById('ropeSeed');
    if (seed) { seed.style.left = Math.round(width - 58) + 'px'; seed.style.top = Math.round(L.ropeY(width - 58, width) - 14) + 'px'; }
  }
}
function paintScroll() {
  cardsEl.style.transform = 'translateX(' + (-Math.round(scrollX)) + 'px)';
  placeRopeTops(state.items);
  updateScrollUI();
  reportHitRects();
  scrollSendThrottled();
  docPeekDisarm(true);
}
function applyScroll(x) {
  if (!track || track.maxScroll <= 0) return;
  scrollX = clampScroll(x);
  if (scrollPaintQueued) return;
  scrollPaintQueued = true;
  requestAnimationFrame(() => { scrollPaintQueued = false; paintScroll(); });
  setTimeout(() => { if (scrollPaintQueued) { scrollPaintQueued = false; paintScroll(); } }, 120);
}
let scrollSentAt = 0;
function scrollSendThrottled() {
  const now = Date.now();
  if (now - scrollSentAt < 80) return;
  scrollSentAt = now;
  api.send('line:scroll', scrollX);
}
// 平滑滚动（箭头点击 / 新卡滚入视野）
let tween = null;
function tweenScroll(target) {
  target = clampScroll(target);
  if (tween) cancelAnimationFrame(tween.raf);
  const from = scrollX, d = target - from, t0 = performance.now();
  if (Math.abs(d) < 1) return;
  const dur = Math.min(420, 160 + Math.abs(d) * 0.25);
  const step = now => {
    const k = Math.min(1, (now - t0) / dur);
    const e = 1 - Math.pow(1 - k, 3);
    applyScroll(from + d * e);
    if (k < 1) tween.raf = requestAnimationFrame(step); else tween = null;
  };
  tween = { raf: requestAnimationFrame(step) };
}
// 两端箭头 + 底部行程条
let scL = null, scR = null, scBar = null, scThumb = null;
function ensureScrollUI() {
  if (scL) return;
  scL = document.createElement('button');
  scL.id = 'scrollPrev'; scL.className = 'scroll-edge'; scL.setAttribute('aria-label', '向左滚动');
  scL.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M10 3L5.5 8l4.5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  scL.addEventListener('click', () => tweenScroll(scrollX - width * 0.55));
  scR = document.createElement('button');
  scR.id = 'scrollNext'; scR.className = 'scroll-edge'; scR.setAttribute('aria-label', '向右滚动');
  scR.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M6 3l4.5 5L6 13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  scR.addEventListener('click', () => tweenScroll(scrollX + width * 0.55));
  scBar = document.createElement('div');
  scBar.id = 'scrollBar';
  scThumb = document.createElement('div');
  scThumb.className = 'scroll-thumb';
  scBar.appendChild(scThumb);
  stage.appendChild(scL); stage.appendChild(scR); stage.appendChild(scBar);
}
function updateScrollUI() {
  ensureScrollUI();
  const on = !!track && track.maxScroll > 4;
  scL.classList.toggle('show', on && scrollX > 4);
  scR.classList.toggle('show', on && scrollX < track.maxScroll - 4);
  scBar.classList.toggle('show', on);
  if (on) {
    const trackW = Math.min(width - 240, 420);
    const tw = Math.max(48, trackW * width / track.contentW);
    scBar.style.width = trackW + 'px';
    scBar.style.left = Math.round((width - trackW) / 2) + 'px';
    scThumb.style.width = Math.round(tw) + 'px';
    scThumb.style.transform = 'translateX(' + Math.round((trackW - tw) * (scrollX / track.maxScroll)) + 'px)';
  }
}

// R154: 增量布局缓存——广播频繁（勾选待办也会广播），多数广播只改内容不改顺序。
let lastOrder = '';
let lastWidth = 0;
function layout() {
  if (document.body.classList.contains('sw') && L.setSoftwareMode) L.setSoftwareMode(true);
  width = window.innerWidth;
  const items = state.items;
  const total = items.length + 2; // 统一序列：items + 每日发现卡 + 添加卡
  const hIdx = items.findIndex(i => i.id === hoveredId);
  drawRope();
  // R154: id 序列未变、宽度未变、无 hover peek 且无 flying/falling 在途时跳过
  // 位置重排（left/top/width/zIndex/transform 及到达动画），只刷新徽标与卡片内容。
  const order = items.map(i => i.id).join('|');
  const animating = hIdx >= 0
    || items.some(i => i.flying || i.falling)
    || Array.from(slots.values()).some(sl => sl.el.classList.contains('flying') || sl.el.classList.contains('falling'));
  const reposition = order !== lastOrder || width !== lastWidth || animating;
  lastOrder = order;
  lastWidth = width;
  track = computeTrack(items, width);
  scrollX = clampScroll(scrollX);
  items.forEach((item, index) => {
    let s = slots.get(item.id);
    if (!s) { s = buildSlot(item); slots.set(item.id, s); }
    s.item = item;
    if (reposition) {
      const xpos = slotScreenX(item, index, total, width);
      const w = item.kind === 'memo' ? (L.RATIOS[(item.memo.aspectRatio) || 'wide'] || L.RATIOS.wide).rope.w : L.CARD_W;
      const peek = L.peekTransform(index, hIdx, items.length);
      s.el.style.left = (xpos.x - w / 2) + 'px';
      s.el.style.top = (L.ropeY(xpos.sx, width) - L.PIN_ABOVE) + 'px';
      s.el.style.width = w + 'px';
      s.el.style.height = (L.PANEL_H - L.ropeY(xpos.sx, width)) + 'px';
      s.el.style.zIndex = peek.z;
      s.el.style.transform = 'translate(' + peek.xOff + 'px, ' + peek.yOff + 'px) rotate(' + peek.tilt + 'deg)';
      const wasFalling = s.el.classList.contains('falling');
      s.el.classList.toggle('falling', !!item.falling);
      // R160: crumple-then-drop on the line card itself — squeeze into a paper
      // ball (scale 0.5 + 720° twist, 340ms) then drop/fade (260ms), all inside
      // state.drop()'s existing 600ms removal timer (total unchanged). Needs
      // .slot.fall-anim (line.css) to beat .slot.falling's opacity fade.
      if (item.falling && !wasFalling && s.cardfx && s.cardfx.animate
        && !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
        const d2 = Math.random() < 0.5 ? -1 : 1;
        s.el.classList.add('fall-anim');
        s.cardfx.animate([
          { transform: 'rotate(0deg) scale(1)', opacity: 1, easing: 'cubic-bezier(0.55, 0, 0.45, 1)' },
          { transform: 'rotate(' + d2 * 720 + 'deg) scale(0.5)', opacity: 1, offset: 0.57 },
          { transform: 'rotate(' + d2 * 720 + 'deg) translateY(46px) scale(0.5)', opacity: 0 },
        ], { duration: 600, easing: 'cubic-bezier(0.4, 0, 0.7, 0.35)' });
      }
      const flying = !!item.flying;
      if (flying !== s.el.classList.contains('flying')) {
        s.el.classList.toggle('flying', flying);
        if (!flying && s.el.classList.contains('arrived')) nudge(s, 2.2);
      }
      if (!flying && !s.el.classList.contains('arrived')) {
        s.el.classList.add('arrived');
        s.el.style.opacity = '';
        s.arrive.style.opacity = '';
        const pendingArrivals = items.filter(x2 => !x2.falling && !(slots.get(x2.id) && slots.get(x2.id).el.classList.contains('arrived'))).length;
        const stagger = pendingArrivals >= 3 ? (index % 5) * 90 : 0;
        // R153: 入摆幅度 10~20deg、方向随机正负，落回原 tilt。
        setTimeout(() => swingTo(s, (Math.random() < 0.5 ? -1 : 1) * (10 + Math.random() * 10), true), stagger);
      }
    }
    const badge = s.card.querySelector('.copied-badge');
    if (badge) {
      const on = state.copiedID === item.id;
      badge.classList.toggle('show', on);
      if (on && !badge._hideTimer) badge._hideTimer = setTimeout(() => { badge.classList.remove('show'); badge._hideTimer = null; }, 1200);
      if (!on && badge._hideTimer) { clearTimeout(badge._hideTimer); badge._hideTimer = null; }
    }
    renderCardContent(s);
  });
  if (reposition) for (const entry of Array.from(slots.entries())) {
    if (!items.find(i => i.id === entry[0])) { entry[1].el.remove(); thumbCache.delete(entry[0]); slots.delete(entry[0]); }
  }
  // v1.6 新上绳的卡片自动滚入视野（拖入/挂绳时往往已滚到别处）
  for (const item of items) {
    if (prevIds.has(item.id) || item.falling || item.flying || !track) continue;
    const x = track.map.get(item.id);
    if (x == null) continue;
    const sx = x - scrollX;
    if (sx < 60 || sx > width - 60) tweenScroll(x - width * 0.4);
  }
  prevIds = new Set(items.map(i => i.id));
  placeRopeTops(items);
  cardsEl.style.transform = 'translateX(' + (-Math.round(scrollX)) + 'px)';
  updateAddCard(total, hIdx, items.length + 1);
  updateWelcomeCard(items.length);
  updateScrollUI();
  reportHitRects();
}

let addSlotEl = null;
function updateAddCard(total, hIdx, itemCount) {
  if (!addSlotEl) {
    addSlotEl = document.createElement('div');
    addSlotEl.className = 'slot arrived';
    addSlotEl.innerHTML = '<div class="arrive" style="transform:none;opacity:1"><div class="swing"><div class="peg"></div><div class="cardfx glass add-card"><div class="add-face hit"><span class="plus">⊕</span><span class="t1">记想法 / 待办</span><span class="t2">点击打开大窗口写便签<br>(快捷键 Ctrl+Alt+N)</span></div></div></div></div>';
    addSlotEl.addEventListener('click', () => api.send('line:open-editor', null));
    cardsEl.appendChild(addSlotEl);
  }
  const x = track ? track.addX : L.xAt(itemCount, total, width);
  const ry = L.ropeY(x - scrollX, width);
  const off = L.addCardPeekOffset(hIdx, itemCount);
  addSlotEl.style.left = (x - L.RATIOS.wide.rope.w / 2) + 'px';
  addSlotEl.style.top = (ry - L.PIN_ABOVE) + 'px';
  addSlotEl.style.width = L.RATIOS.wide.rope.w + 'px';
  addSlotEl.style.height = (L.PANEL_H - ry) + 'px';
  addSlotEl.style.zIndex = total + 1;
  addSlotEl.style.transform = 'translateX(' + off + 'px)';
}

// 空态欢迎卡：绳上一张便签都没有时，出现在添加卡左侧的引导纸片。
// welcomeShown 布尔防抖：只在 空 ⇄ 非空 翻转时动 DOM；可见期间 layout 仅重算
// 位置（resize 后仍贴合绳弧），重挂前用 isConnected 判断避免动画重启。
let welcomeSlotEl = null;
let welcomeShown = false;
function updateWelcomeCard(itemCount) {
  if (itemCount !== 0) {
    if (welcomeShown && welcomeSlotEl) { welcomeSlotEl.remove(); welcomeShown = false; }
    return;
  }
  if (!welcomeSlotEl) {
    welcomeSlotEl = document.createElement('div');
    welcomeSlotEl.className = 'slot arrived';
    welcomeSlotEl.innerHTML = '<div class="arrive" style="transform:none;opacity:1"><div class="swing"><div class="peg"></div>'
      + '<div class="cardfx wc-fx"><div class="welcome-card">'
      + '<div class="wc-title">把想法晾上来 ☀️</div>'
      + '<div class="wc-sub">拖图片到这里 · 双击空白新建 · Ctrl+Alt+N 速记</div>'
      + '<button class="wc-entry" data-act="memo"><span>📝</span>写便签</button>'
      + '<button class="wc-entry" data-act="image"><span>🖼</span>挂图片</button>'
      + '<button class="wc-entry" data-act="search"><span>🔍</span>搜索</button>'
      + '</div></div></div></div>';
    welcomeSlotEl.addEventListener('click', ev => {
      const btn = ev.target.closest('.wc-entry');
      if (!btn) return;
      if (btn.dataset.act === 'memo') api.send('line:open-editor', null);       // 与添加卡同通道
      else if (btn.dataset.act === 'image') api.send('line:hang-clipboard');    // 复用挂剪贴板/图片
      else if (btn.dataset.act === 'search') api.send('search:open-tag', null); // 复用搜索深链（null 标签被忽略）
    });
  }
  const W = 180;
  const center = L.xAt(0, 1, width) - L.RATIOS.wide.rope.w / 2 - 14 - W / 2;
  const ry = L.ropeY(center, width);
  welcomeSlotEl.style.left = (center - W / 2) + 'px';
  welcomeSlotEl.style.top = (ry - L.PIN_ABOVE) + 'px';
  welcomeSlotEl.style.width = W + 'px';
  welcomeSlotEl.style.height = (L.PANEL_H - ry) + 'px';
  welcomeSlotEl.style.zIndex = 1;
  if (!welcomeSlotEl.isConnected) { cardsEl.appendChild(welcomeSlotEl); welcomeShown = true; }
}

function tiltOf(s) { return s.item.tilt || 0; }
function swingAnim(s, keyframes, options) {
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { try { s.swing && s.swing.animate && s.swing.animate([{ transform: 'rotate(' + tiltOf(s) + 'deg)' }], { duration: 1 }); } catch {} return; }
  const ps = document.body.classList.contains('power-save');
  if (ps) { /* 节电：直接落到最终角度 */ try { s.swing && s.swing.animate && s.swing.animate([{ transform: 'rotate(' + tiltOf(s) + 'deg)' }], { duration: 1 }); } catch {} return; }
  if (s.anim) s.anim.cancel();
  s.swing.style.transform = 'rotate(' + tiltOf(s) + 'deg)';
  s.anim = s.swing.animate(keyframes, options);
  s.anim.finished.then(() => { try { if (s.anim) { s.anim.cancel(); s.anim = null; } } catch (e) {} }).catch(() => {});
}
function swingTo(s, deg, arrive) {
  const t = tiltOf(s);
  const k = arrive
    ? [{ transform: 'rotate(' + (t + deg) + 'deg)', offset: 0 }, { transform: 'rotate(' + (t - 3.6) + 'deg)', offset: 0.52 }, { transform: 'rotate(' + (t + 1.7) + 'deg)', offset: 0.75 }, { transform: 'rotate(' + (t - 0.5) + 'deg)', offset: 0.9 }, { transform: 'rotate(' + t + 'deg)', offset: 1 }]
    : [{ transform: 'rotate(' + (t + deg) + 'deg)', offset: 0 }, { transform: 'rotate(' + t + 'deg)', offset: 1 }];
  swingAnim(s, k, { duration: arrive ? 1250 : 300, easing: 'cubic-bezier(0.34, 0.9, 0.42, 1)' });
}
function nudge(s, deg) {
  if (!s || s.item.falling) return;
  const t = tiltOf(s);
  swingAnim(s, [
    { transform: 'rotate(' + t + 'deg)', offset: 0 },
    { transform: 'rotate(' + (t + deg) + 'deg)', offset: 0.27, easing: 'ease-out' },
    { transform: 'rotate(' + (t - deg * 0.42) + 'deg)', offset: 0.58 },
    { transform: 'rotate(' + (t + deg * 0.14) + 'deg)', offset: 0.8 },
    { transform: 'rotate(' + t + 'deg)', offset: 1 },
  ], { duration: 1150, easing: 'cubic-bezier(0.34, 0.9, 0.42, 1)' });
}

function swMode() { return document.body.classList.contains('sw'); }
function powerSave() { return document.body.classList.contains('power-save') || document.body.classList.contains('sw'); }
function scheduleGust() {
  setTimeout(() => {
    if (!powerSave() && state.items.length && !dragState && document.visibilityState === 'visible') {
      const ordered = Array.from(slots.values()).sort((a, b) => (parseFloat(a.el.style.left) || 0) - (parseFloat(b.el.style.left) || 0));
      const dir = Math.random() < 0.5 ? 1 : -1;
      if (dir < 0) ordered.reverse();
      const deg = 1.6 + Math.random() * 1.8;
      ordered.forEach((s, i) => setTimeout(() => nudge(s, deg * dir), i * 90 + Math.random() * 60));
    }
    scheduleGust();
  }, 7000 + Math.random() * 9000);
}
scheduleGust();

let hitTimer = null;
function reportHitRects() {
  clearTimeout(hitTimer);
  hitTimer = setTimeout(() => {
    const rects = [];
    for (const s of slots.values()) {
      if (s.item.falling) continue;
      const r = s.face.getBoundingClientRect();
      rects.push({ x: r.left, y: r.top, w: r.width, h: r.height });
    }
    const add = addSlotEl && addSlotEl.querySelector('.add-face');
    if (add) { const r = add.getBoundingClientRect(); rects.push({ x: r.left, y: r.top, w: r.width, h: r.height }); }
    const hb = hangClipBtn.getBoundingClientRect(); rects.push({ x: hb.left, y: hb.top, w: hb.width, h: hb.height });
    const gb = gearBtn.getBoundingClientRect(); rects.push({ x: gb.left, y: gb.top, w: gb.width, h: gb.height });
    api.send('line:hit', rects);
  }, 30);
}

function setHoveredSlot(id) {
  if (id === hoveredId) return;
  // R206b: 把 .hover 类真正落到槽位元素上——此前 hoveredId 只进 JS 状态，
  // CSS 里 15 条 .slot.hover 规则（工具条/阴影/图片放大）从未命中过。
  const prev = hoveredId && slots.get(hoveredId);
  if (prev && prev.el) prev.el.classList.remove('hover');
  hoveredId = id || null;
  const next = id && slots.get(id);
  if (next && next.el) next.el.classList.add('hover');
  // v1.6 文档卡：悬停 320ms 后弹出阅读面板（overlay 承载，绳窗只有 275 高）
  if (next && next.item && next.item.kind === 'doc' && !next.item.falling) docPeekArm(id);
  else docPeekDisarm();
  applyPeek();
}
// ---- v1.6 文档悬停阅读弹出（防扫过误触：320ms 驻留） ------------------------
// 面板是粘性的：hover 变化不再发关闭，关闭走 Esc/点面板外/✕/大图（overlay 侧）。
let docPeekTimer = null, docPeekId = null;
function docPeekArm(id) {
  if (docPeekId === id) return;
  docPeekDisarm();
  docPeekId = id;
  docPeekTimer = setTimeout(() => {
    docPeekTimer = null;
    if (docPeekId && hoveredId === docPeekId) api.send('line:doc-peek', { id: docPeekId });
  }, 320);
}
function docPeekDisarm() {
  docPeekId = null;
  if (docPeekTimer) { clearTimeout(docPeekTimer); docPeekTimer = null; }
}
cardsEl.addEventListener('mouseover', ev => {
  const hit = ev.target.closest && ev.target.closest('.hit');
  const slotEl = hit && hit.closest('.slot');
  setHoveredSlot((slotEl && slotEl.dataset && slotEl.dataset.id) || null);
});
cardsEl.addEventListener('mouseleave', () => setHoveredSlot(null));
api.on('line:cool', () => setHoveredSlot(null));
const hotZones = [cardsEl, topButtons];
hotZones.forEach(zone => {
  zone.addEventListener('mouseenter', () => api.send('line:hot', true), true);
  zone.addEventListener('mouseleave', () => api.send('line:hot', false), true);
});
cardsEl.addEventListener('mousedown', ev => {
  const slotEl = ev.target.closest('.slot');
  if (!slotEl || !slotEl.dataset.id) {
    // v1.6 空绳区直接抓取平移（所见即所得地"拖绳子"）
    if (ev.button === 0 && track && track.maxScroll > 0 && !(ev.target.closest && ev.target.closest('button'))) {
      dragState = { id: null, empty: true, x0: ev.screenX, y0: ev.screenY, moved: true, slotEl: null, panFrom: scrollX, panX0: ev.screenX, panning: true };
      document.body.classList.add('panning');
    }
    return;
  }
  const id = slotEl.dataset.id;
  const s = slots.get(id);
  if (!s || s.item.falling) return;
  if (ev.button !== 0) return;
  const mf = slotEl.querySelector('.memo-face');
  if (mf) mf.draggable = !(ev.altKey || ev.shiftKey); // Alt/Shift 走重排/撕下管线，其余交给 HTML5 文本拖出
  slotEl.classList.add('pressed');
  dragState = { id, x0: ev.screenX, y0: ev.screenY, moved: false, slotEl, reorder: ev.altKey, tear: ev.shiftKey };
  dragState.longTimer = setTimeout(() => {
    if (dragState && !dragState.moved) { api.send('line:open', dragState.id); clearPress(); }
  }, 450);
});
function clearPress() {
  const ind = document.getElementById('reorderIndicator');
  if (ind) ind.remove();
  document.body.classList.remove('reordering');
  document.body.classList.remove('panning');
  document.querySelectorAll('.memo-face').forEach(f => { f.draggable = true; });
  document.querySelectorAll('.slot.reordering').forEach(e => e.classList.remove('reordering'));
  if (dragState) { clearTimeout(dragState.longTimer); dragState = null; }
}
// R2: mousemove work is coalesced into animation frames (mice report at
// 125-1000Hz; the handler only needs one run per frame).
let mmQueued = null;
window.addEventListener('mousemove', ev => {
  if (mmQueued) return;
  mmQueued = ev;
  const run = () => {
    const e = mmQueued;
    mmQueued = null;
    if (!e) return;
    mousemoveWork(e);
  };
  // R102: same rAF-starvation guard as scheduleLayout — without it the first
  // tuck (hidden window drops the rAF) permanently froze hover handling.
  requestAnimationFrame(run);
  setTimeout(() => { if (mmQueued) run(); }, 120);
});
function mousemoveWork(ev) {
  const overSlot = !!(ev.target && ev.target.closest && ev.target.closest('.slot'));
  if (!overSlot && hoveredId) setHoveredSlot(null);
  if (dragState && dragState.panning) {
    if (!(ev.buttons & 1)) { clearPress(); return; } // 按键在窗外松开：下次移动自愈
    // v1.6 绳上平移：轴锁判定为横向主导后，横向移动即滚动绳
    applyScroll(dragState.panFrom - (ev.screenX - dragState.panX0));
    return;
  }
  if (dragState) {
    const dx = ev.screenX - dragState.x0, dy = ev.screenY - dragState.y0;
    if (Math.hypot(dx, dy) > 4) {
      dragState.moved = true;
      clearTimeout(dragState.longTimer);
      if (dragState.reorder) { dragState.reordering = true; dragState.slotEl.classList.add('reordering'); document.body.classList.add('reordering'); }
      else if (dragState.tear) { // R99: Shift+drag = tear candidate — decide on release
        dragState.tearing = true;
        dragState.slotEl.classList.add('reordering');
        document.body.classList.add('reordering');
      }
      else if ((() => { const ds = dragState.id && slots.get(dragState.id); return ds && ds.item && ds.item.kind === 'memo'; })()) {
        // 便签：HTML5 文本拖出（dragstart 已带 text/plain）——拖进聊天框直接发文字
      }
      else startDrag(dragState.id); // 图片/文档：原生文件拖出（拖进聊天框发文件）
      if (!dragState.reordering && !dragState.tearing && !dragState.panning) clearPress();
    }
    if (dragState && dragState.reordering && !dragState.reorderDone) {
      const steps = Math.round((ev.screenX - dragState.x0) / 205);
      if (steps !== (dragState.steps || 0)) {
        dragState.steps = steps;
        const idx = state.items.findIndex(i => i.id === dragState.id);
        const to = Math.max(0, Math.min(state.items.length - 1, idx + steps));
        if (to !== idx) {
          api.send('line:reorder', { id: dragState.id, toIndex: to });
          // 卡片像真纸片：每次换位都被“摆弄”出 ±0.6° 内的新角度，摆一下
          // 落定（swingTo→新 tilt），同时发 line:set-tilt 让主进程持久化。
          const s = slots.get(dragState.id);
          if (s && s.item && !s.item.falling) {
            const base = s.item.tilt || 0;
            const t = Math.max(-3.5, Math.min(3.5, base + (Math.random() * 1.2 - 0.6)));
            s.item.tilt = t;
            pendingTilts.set(dragState.id, t);
            swingTo(s, 2.4, false);
            api.send('line:set-tilt', { id: dragState.id, tilt: t });
          }
          dragState.x0 = ev.screenX;
        }
      }
      let ind = document.getElementById('reorderIndicator');
      if (!ind) { ind = document.createElement('div'); ind.id = 'reorderIndicator'; stage.appendChild(ind); }
      const self = slots.get(dragState.id);
      if (self && self.el) {
        const sl = self.el.getBoundingClientRect();
        ind.style.left = sl.left + 'px'; ind.style.top = sl.top + 'px'; ind.style.height = sl.height + 'px';
      }
    }
  }
}
// R99: releasing a torn card below the strip sticks it to the desktop at the
// drop point; releasing inside the strip snaps it back onto the line.
document.addEventListener('mouseout', ev => {
  if (!ev.relatedTarget) { const s = hoveredId && slots.get(hoveredId); if (s) setHoveredSlot(null); }
});
window.addEventListener('mouseup', ev => {
  lastDragMoved = dragState && dragState.moved ? Date.now() : 0;
  if (dragState && dragState.tearing && dragState.moved) {
    const id = dragState.id;
    const below = ev.clientY > innerHeight - 44 || ev.screenY > (window.screenY + innerHeight - 20);
    clearPress();
    if (below) api.send('line:tear-to-desktop', { id, x: ev.screenX, y: ev.screenY });
    return;
  }
  clearPress();
});
function startDrag(id) {
  const s = slots.get(id);
  if (!s) return;
  let icon = null;
  try { icon = makeDragIcon(s.item); } catch (e) { icon = null; }
  s.el.classList.add('dragging');
  api.send('line:drag', { id, icon });
  setTimeout(() => s.el.classList.remove('dragging'), 700);
}
function makeDragIcon(item) {
  const cv = document.createElement('canvas');
  cv.width = 300; cv.height = 240;
  const ctx = cv.getContext('2d');
  if (item.kind === 'image') return item.thumb;
  const g = ctx.createLinearGradient(0, 0, 0, 240);
  const pair = window.CARD_BG_EDITOR[item.memo.color] || window.CARD_BG_EDITOR.yellow;
  g.addColorStop(0, pair[0]); g.addColorStop(1, pair[1]);
  ctx.fillStyle = g;
  roundRect(ctx, 4, 4, 292, 232, 16); ctx.fill();
  ctx.fillStyle = 'rgba(30,28,24,0.85)';
  ctx.font = '500 20px "Segoe UI", "Microsoft YaHei UI"';
  const dLines = item.memo.text.split('\n').slice(0, 6);
  dLines.forEach((l, i) => {
    const t = l.replace(/^#+\s*/, '').replace(/^(-|\*)\s*\[x?\]\s*/i, '\u2611 ').slice(0, 16);
    ctx.fillText(t, 22, 44 + i * 32);
  });
  return cv.toDataURL();
}
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
cardsEl.addEventListener('click', ev => {
  if (Date.now() - lastDragMoved < 300) return; // 拖拽松手后浏览器补发的 click 不算点击
  const slotEl = ev.target.closest('.slot');
  if (!slotEl || !slotEl.dataset.id) return;
  const id = slotEl.dataset.id;
  const s = slots.get(id);
  if (!s || s.item.falling) return;
  if (dragState && dragState.moved) return;
  if (!ev.target.closest('.hit') && !ev.target.closest('.hover-tools')) return;
  if (ev.target.closest('.md-todo')) {
    const lineIdx = parseInt(ev.target.closest('.md-todo').dataset.line, 10);
    api.send('line:toggle-todo', { id, lineIndex: lineIdx });
    return;
  }
  if (ev.target.closest('.done-btn')) { api.send('line:toggle-done', id); return; }
  const toolBtn = ev.target.closest('.tool');
  if (toolBtn) {
    ev.stopPropagation();
    const t = toolBtn.dataset.tool;
    if (t === 'done') api.send('line:toggle-done', id);
    else if (t === 'pin') api.send('line:toggle-pinned', id);
    else if (t === 'edit') api.send('line:open-editor', id);
    else if (t === 'discard') api.send('line:discard', id);
    return;
  }
  if (ev.target.closest('.discard-x')) return;
  api.send('line:open-preview', id);
});
cardsEl.addEventListener('dblclick', ev => {
  const slotEl = ev.target.closest('.slot');
  if (!slotEl || !slotEl.dataset.id) return;
  const s = slots.get(slotEl.dataset.id);
  if (!s || s.item.falling) return;
  if (!ev.target.closest('.hit')) return;
  if (document.body.classList.contains('compact') && s.item.kind === 'memo') {
    slotEl.classList.add('peek-full');
    setTimeout(() => slotEl.classList.remove('peek-full'), 5000);
    return;
  }
  if (s.item.kind === 'memo') api.send('line:open-editor', s.item.id);
  else api.send('line:copy', s.item.id);
});
cardsEl.addEventListener('contextmenu', ev => {
  const slotEl = ev.target.closest('.slot');
  if (!slotEl || !slotEl.dataset.id) return;
  ev.preventDefault();
  api.send('line:menu', slotEl.dataset.id);
});
hangClipBtn.addEventListener('click', () => {
  api.send('line:hang-clipboard');
  hangClipBtn.classList.add('ok');
  hangClipIcon.innerHTML = ICONS.done;
  hangClipText.textContent = '已挂上';
  setTimeout(() => {
    hangClipBtn.classList.remove('ok');
    hangClipIcon.innerHTML = ICONS.clip;
    hangClipText.textContent = '挂上剪贴板';
  }, 1200);
});
gearBtn.addEventListener('click', () => api.send('line:settings'));
let audioCtx = null;
function ctxA() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
function playTink(volume = 0.35, pitch = 1) {
  const c = ctxA(), t = c.currentTime;
  const out = c.createGain(); out.gain.value = volume * 0.5; out.connect(c.destination);
  [[2093 * pitch, 0.10, 0.9], [3136 * pitch, 0.05, 0.4]].forEach(fd => {
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.value = fd[0];
    g.gain.setValueAtTime(fd[2], t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + fd[1] + 0.08);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + fd[1] + 0.1);
  });
}
function playPop(volume = 0.25) {
  const c = ctxA(), t = c.currentTime;
  const out = c.createGain(); out.gain.value = volume * 0.7; out.connect(c.destination);
  const o = c.createOscillator(), g = c.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(340, t);
  o.frequency.exponentialRampToValueAtTime(130, t + 0.09);
  g.gain.setValueAtTime(0.9, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);
  o.connect(g); g.connect(out);
  o.start(t); o.stop(t + 0.12);
}
function playTrash(volume = 0.5) {
  const c = ctxA(), t = c.currentTime;
  const out = c.createGain(); out.gain.value = volume * 0.35; out.connect(c.destination);
  const len = 0.28 * c.sampleRate;
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
  const src = c.createBufferSource(); src.buffer = buf;
  const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2400; f.Q.value = 0.7;
  src.connect(f); f.connect(out);
  src.start(t);
}
function playBeep(volume = 0.4) {
  const c = ctxA(), t = c.currentTime;
  const out = c.createGain(); out.gain.value = volume * 0.25; out.connect(c.destination);
  [0, 0.12].forEach(dt => {
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'triangle'; o.frequency.value = 880;
    g.gain.setValueAtTime(0.8, t + dt);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.09);
    o.connect(g); g.connect(out);
    o.start(t + dt); o.stop(t + dt + 0.1);
  });
}
function playBlip(volume = 0.2) {
  const c = ctxA(), t = c.currentTime;
  const out = c.createGain(); out.gain.value = volume * 0.4; out.connect(c.destination);
  const o = c.createOscillator(), g = c.createGain();
  o.type = 'triangle'; o.frequency.setValueAtTime(880, t);
  o.frequency.exponentialRampToValueAtTime(1320, t + 0.07);
  g.gain.setValueAtTime(0.7, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
  o.connect(g); g.connect(out);
  o.start(t); o.stop(t + 0.13);
}
function playFanfare() {
  const c = ctxA(), t = c.currentTime;
  const out = c.createGain(); out.gain.value = 0.22; out.connect(c.destination);
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'triangle'; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t + i * 0.11);
    g.gain.exponentialRampToValueAtTime(0.5, t + i * 0.11 + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.11 + 0.5);
    o.connect(g); g.connect(out);
    o.start(t + i * 0.11); o.stop(t + i * 0.11 + 0.55);
  });
}
function playChirp(volume = 0.22) {
  const c = ctxA(), t = c.currentTime;
  const out = c.createGain(); out.gain.value = volume * 0.5; out.connect(c.destination);
  [[3400, 0, 0.05], [2900, 0.08, 0.06], [3600, 0.17, 0.05]].forEach(fd => {
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'sine'; o.frequency.setValueAtTime(fd[0], t + fd[1]);
    g.gain.setValueAtTime(0.55, t + fd[1]);
    g.gain.exponentialRampToValueAtTime(0.0001, t + fd[1] + fd[2] + 0.05);
    o.connect(g); g.connect(out);
    o.start(t + fd[1]); o.stop(t + fd[1] + fd[2] + 0.06);
  });
}
const SOUNDS = { tink: playTink, pop: playPop, trash: playTrash, beep: playBeep, blip: playBlip, fanfare: playFanfare, chirp: playChirp };
api.on('play-sound', d => { (SOUNDS[d.name] || playTink)(d.volume, d.pitch); });
// R110: ambient wind — a very soft filtered-noise loop with slow gusts.
// R139: gain scales with the settings volume (curVol arrives via 'settings-volume';
// 0.6 is the volume default, so wind sounds unchanged at stock volume).
let windNodes = null;
let curVol = 0.6;
function setWind(on, vol) {
  if (typeof vol === 'number' && isFinite(vol) && vol >= 0) curVol = vol;
  const c = ctxA();
  if (on && !windNodes) {
    const len = c.sampleRate * 2;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 0.6;
    const g = c.createGain(); g.gain.value = 0.0;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.07;
    const lfoG = c.createGain(); lfoG.gain.value = 0.012;
    lfo.connect(lfoG); lfoG.connect(g.gain);
    src.connect(lp); lp.connect(g); g.connect(c.destination);
    src.start(); lfo.start();
    g.gain.linearRampToValueAtTime(0.02 * curVol / 0.6, c.currentTime + 1.5);
    windNodes = { src, lfo, g, lfoG, id: ++windGen };
    gustLoop(windNodes.id);
  } else if (!on && windNodes) {
    const n = windNodes; windNodes = null;
    n.id = -1; // R149: kill the gust timer chain so an old timer can't revive after off
    try { n.lfoG.gain.cancelScheduledValues(c.currentTime); } catch {}
    try { n.g.gain.linearRampToValueAtTime(0.0001, c.currentTime + 0.8); } catch {}
    setTimeout(() => { try { n.src.stop(); n.lfo.stop(); n.g.disconnect(); } catch {} }, 900);
  }
}
// R149: random strong gusts — every 6-14s swing the gust LFO depth from 0.012 up to
// 0.02~0.035 and back, each leg a 2-4s linearRamp. Recursive setTimeout chain; each
// tick re-checks the id on windNodes so a chain from a closed wind stops itself.
let windGen = 0;
function gustLoop(id) {
  const n = windNodes;
  if (!n || n.id !== id) return;
  const t = ctxA().currentTime;
  const up = 2 + Math.random() * 2; // 2-4s
  try {
    n.lfoG.gain.cancelScheduledValues(t);
    n.lfoG.gain.setValueAtTime(Math.max(0.012, n.lfoG.gain.value), t);
    n.lfoG.gain.linearRampToValueAtTime(0.02 + Math.random() * 0.015, t + up);
    n.lfoG.gain.linearRampToValueAtTime(0.012, t + up * 2);
  } catch {}
  setTimeout(() => gustLoop(id), up * 2000 + 6000 + Math.random() * 8000);
}
api.on('wind', on => setWind(on));
api.on('settings-volume', v => {
  const vol = Number(v);
  if (isFinite(vol) && vol >= 0) curVol = vol;
  if (windNodes) windNodes.g.gain.linearRampToValueAtTime(0.02 * curVol / 0.6, ctxA().currentTime + 0.5);
});
api.on('beacon-fly', d => {
  // R167: reduced-motion 时跳过——小太阳飞行纯属视觉连续性（main 侧
  // revealLinePinned 已先行完成展开，这里没有等价的 store 收尾可做）
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const fly = document.createElement('div');
  fly.textContent = '\u2600\ufe0f';
  fly.style.cssText = 'position:fixed;z-index:300000;font-size:22px;pointer-events:none;transition:transform 520ms cubic-bezier(0.3,0.9,0.4,1),opacity 520ms ease;';
  fly.style.left = d.fromX + 'px';
  fly.style.top = d.fromY + 'px';
  document.body.appendChild(fly);
  const ropeX = innerWidth / 2, ropeY = L.ROPE_TOP + L.sag(innerWidth) * 0.9;
  requestAnimationFrame(() => {
    fly.style.transform = 'translate(' + (ropeX - d.fromX) + 'px, ' + (ropeY - d.fromY) + 'px) scale(0.4)';
    fly.style.opacity = '0.15';
  });
  setTimeout(() => fly.remove(), 560);
});
api.on('torn-toast', d => {
  let toast = document.getElementById('tornToast');
  if (toast) toast.remove();
  toast = document.createElement('div');
  toast.id = 'tornToast';
  toast.className = 'glass';
  toast.style.cssText = 'position:absolute;left:50%;bottom:14px;transform:translateX(-50%);display:flex;align-items:center;gap:10px;padding:9px 14px;border-radius:10px;background:rgba(36,36,42,0.95);color:#eee;font-size:12px;z-index:200000;animation:toast-in 300ms ease;';
  toast.innerHTML = '<span>已撕下「' + d.text + '…」</span><button style="border:0;background:#ff8f1f;color:#fff;border-radius:6px;padding:4px 10px;font-size:11.5px;cursor:pointer;font-family:inherit">撤销</button>';
  toast.querySelector('button').addEventListener('click', () => { api.send('line:undo-torn'); toast.remove(); });
  stage.appendChild(toast);
  setTimeout(() => { const t = document.getElementById('tornToast'); if (t) { t.style.opacity = '0'; t.style.transition = 'opacity 300ms'; setTimeout(() => t.remove(), 320); } }, 5000);
});
function showHintToast(text) {
  let toast = document.getElementById('hintToast');
  if (toast) toast.remove();
  toast = document.createElement('div');
  toast.id = 'hintToast';
  toast.className = 'glass';
  toast.style.cssText = 'position:absolute;left:50%;bottom:14px;transform:translateX(-50%);padding:9px 16px;border-radius:10px;background:rgba(36,36,42,0.95);color:#eee;font-size:12px;z-index:200000;animation:toast-in 300ms ease;';
  toast.textContent = text;
  stage.appendChild(toast);
  setTimeout(() => { const t = document.getElementById('hintToast'); if (t) { t.style.opacity = '0'; t.style.transition = 'opacity 300ms'; setTimeout(() => t.remove(), 320); } }, 2600);
}

api.on('hint-toast', showHintToast);
// R?: main.js 在新建/复制/截图生成便签后发送 'card-flash'（带 id）——
// 此前无监听，line.css 里的高亮光圈 .card-flash-ring 从未渲染过。
api.on('card-flash', id => {
  // R167: reduced-motion 时高亮光圈直接不做（纯视觉强调，无状态跟随）
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const sl = slots.get(id);
  if (!sl || !sl.el) return;
  const ring = document.createElement('div');
  ring.className = 'card-flash-ring';
  sl.el.appendChild(ring);
  setTimeout(() => ring.remove(), 1700);
});
window.__lastState = null;
function handleState(s) {
  window.__lastState = s;
  const prevCopied = state.copiedID;
  // R99: cards torn to the desktop keep living in the store but not on the rope
  s.items = (s.items || []).filter(i => !i.desktop);
  // 重排微调角度：覆盖掉比本地 set-tilt 更旧的广播角度；主进程跟上后清除，
  // 卡片离线（掉落/删除）时一并清掉，map 不无限增长。
  pendingTilts.forEach((t, id) => {
    const it = s.items.find(i => i.id === id);
    if (!it) { pendingTilts.delete(id); return; }
    if (it.tilt === t) pendingTilts.delete(id);
    else it.tilt = t;
  });
  state = s;
  // R98: 📌 must SHOW whether the stay-open toggle is on — users clicked it
  // twice (on then off) because nothing on the button ever changed.
  pinViewBtn.classList.toggle('pinned', !!s.userPinned);
  pinViewBtn.title = s.userPinned ? '已盯住（点击取消常驻）' : '盯住（不再自动隐藏）';
  // R165: 语义反转——深色(常规)=钉住，浅色高亮=未钉住（提醒绳会自动收起）
  pinViewBtn.classList.toggle('unpinned', !s.userPinned);
  if (s.copiedID && s.copiedID !== prevCopied) {
    const sl = slots.get(s.copiedID);
    if (sl) nudge(sl, 3);
  }
  stage.classList.toggle('revealed', !!s.revealed);
  if (s.revealed && !stage.classList.contains('was-revealed')) {
    slots.forEach(sl => { if (!sl.el.classList.contains('arrived')) swingTo(sl, (Math.random() < 0.5 ? -1 : 1) * (10 + Math.random() * 10), true); });
  }
  stage.classList.toggle('was-revealed', !!s.revealed);
  checkAllDone(s.items);
  scheduleLayout();
}
api.on('state', handleState);
api.invoke('line:get-state').then(s => { if (s) handleState(s); }).catch(() => {});

// R94: drop files from Explorer onto the rope — images hang as photo cards,
// .txt/.md become text memos. The rope glows while files hover over it.
let fileDragDepth = 0;
window.addEventListener('dragenter', ev => {
  if (ev.dataTransfer && [...ev.dataTransfer.types].includes('Files')) {
    fileDragDepth++;
    stage.classList.add('file-hover');
  }
});
window.addEventListener('dragleave', () => {
  fileDragDepth = Math.max(0, fileDragDepth - 1);
  if (!fileDragDepth) stage.classList.remove('file-hover');
});
window.addEventListener('dragover', ev => ev.preventDefault());
window.addEventListener('drop', ev => {
  ev.preventDefault();
  fileDragDepth = 0;
  stage.classList.remove('file-hover');
  const files = [...(ev.dataTransfer ? ev.dataTransfer.files : [])];
  for (const f of files.slice(0, 6)) {
    try {
      const p = api.getPathForFile(f);
      if (p) api.send('line:drop-file', p);
    } catch { /* unreadable entry */ }
  }
});
let prevAllDone = null;
function checkAllDone(items) {
  const todos = [];
  items.forEach(i => { if (i.kind === 'memo' && i.memo) { const st = window.todoStats(i.memo.text); todos.push(st); } });
  const withTodos = todos.filter(t => t.total > 0);
  if (withTodos.length === 0) { prevAllDone = null; return; }
  const all = withTodos.every(t => t.completed === t.total);
  if (prevAllDone === false && all) celebrate();
  prevAllDone = all;
}
function celebrate() {
  birdBringsSeed(); // 全天待办完成：小鸟叼来太阳种子（当日有效，跨重启保留）
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (document.body.classList.contains('power-save')) return;
  playFanfare();
  const cv = document.createElement('canvas');
  cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:200000;';
  cv.width = innerWidth * devicePixelRatio; cv.height = innerHeight * devicePixelRatio;
  document.body.appendChild(cv);
  const ctx = cv.getContext('2d');
  const parts = [];
  for (let i = 0; i < 90; i++) parts.push({ x: Math.random() * cv.width, y: -20 - Math.random() * cv.height * 0.3, vx: (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 3, r: 3 + Math.random() * 4, a: Math.random() * Math.PI, va: (Math.random() - 0.5) * 0.3, c: ['#ff8f1f', '#f06292', '#2fbf9f', '#4a9ff5', '#ffd54a'][Math.floor(Math.random() * 5)] });
  let frames = 0;
  (function tickAnim() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    parts.forEach(p => { p.x += p.vx; p.y += p.vy; p.a += p.va; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.a); ctx.fillStyle = p.c; ctx.fillRect(-p.r, -p.r / 2, p.r * 2, p.r); ctx.restore(); });
    if (++frames < 220) requestAnimationFrame(tickAnim); else cv.remove();
  })();
}
setInterval(() => {
  slots.forEach(s => {
    const t = s.card.querySelector('.memo-time');
    if (t && s.item.memo) t.textContent = window.timeAgo(s.item.memo.createdAt);
  });
}, 30000);
// R146: Ctrl+滚轮循环设置里的卡片字号档（上=更大 / 下=更小，sm→md→lg 循环），
// 与设置窗口字体行走同一 settings:set 通道，主进程回推 dataset.font 落库。
const FONT_STEPS = ['sm', 'md', 'lg'];
const FONT_NAMES = { sm: '小字号', md: '中字号', lg: '大字号' };
window.addEventListener('wheel', ev => {
  if (ev.ctrlKey) {
    ev.preventDefault(); // 防 Ctrl+滚轮页面缩放
    const i = FONT_STEPS.indexOf(document.body.dataset.font || 'md');
    const next = FONT_STEPS[(i + (ev.deltaY < 0 ? 1 : -1) + FONT_STEPS.length) % FONT_STEPS.length];
    document.body.dataset.font = next;
    api.send('settings:set', { key: 'cardFont', value: next });
    showHintToast('卡片字号：' + FONT_NAMES[next]);
    return;
  }
  // v1.6 滚轮横滚绳（阅读面板内的滚动不劫持）
  if (ev.target && ev.target.closest && ev.target.closest('.docr')) return;
  if (!track || track.maxScroll <= 0) return;
  ev.preventDefault();
  const d = Math.abs(ev.deltaX) > Math.abs(ev.deltaY) ? ev.deltaX : ev.deltaY;
  applyScroll(scrollX + d);
}, { passive: false });
// R145: Windows 显示缩放（125%/150%切换）触发的 resize 由 layout()/drawRope() 按
// innerWidth 重建；ropeWidthDrawn 挡住连发 resize 的重复重绘，天然 debounce，无需额外定时器。
window.addEventListener('resize', layout);
// R150: 空格临时预览 —— 无输入焦点时按空格让线条垂降 4 秒（peek），再输入框不受影响。
document.addEventListener('keydown', ev => {
  // R164: Esc 收起晾衣绳（与预览的 Esc 语义一致）
  if (ev.key === 'Escape') {
    if (ev.target && ev.target.closest && ev.target.closest('input,textarea,[contenteditable]')) return;
    ev.preventDefault();
    api.send('line:toggle');
    return;
  }
  if (ev.code !== 'Space') return;
  if (ev.target && ev.target.closest && ev.target.closest('input,textarea,[contenteditable]')) return;
  ev.preventDefault();
  api.send('line:peek');
});
layout();
api.send('line:ready');

// ---- v1.7 绳上趣味三件套：小鸟 / 太阳种子 / 每日发现卡 ----------------------

// —— 小鸟：随机来访，点击飞走；全天待办完成时叼来一颗太阳种子 ——
const BIRD_SVG = '<svg viewBox="0 0 40 30" width="36" height="27">'
  + '<path d="M28 21 L38 15 L33 24 Z" fill="#c98a3a"/>'
  + '<ellipse cx="17" cy="17" rx="13" ry="9.5" fill="#ffcf5e"/>'
  + '<path d="M6 16 Q14 8 24 14 Q18 20 6 16Z" fill="#e8a23e"/>'
  + '<circle cx="27" cy="11" r="5.5" fill="#ffd97a"/>'
  + '<path d="M32 10 l6 2 -6 2 Z" fill="#ff9c3f"/>'
  + '<circle cx="28.5" cy="10" r="1.3" fill="#3a2c14"/>'
  + '</svg>';
function reducedMotion() { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
function spawnBird(withSeed) {
  if (birdEl) return;
  const x = Math.round(width * (0.18 + Math.random() * 0.58));
  const y = Math.round(L.ropeY(x, width) - 24);
  birdEl = document.createElement('div');
  birdEl.id = 'ropeBird';
  birdEl.style.cssText = 'position:absolute;z-index:6000;cursor:pointer;';
  birdEl.innerHTML = BIRD_SVG + (withSeed ? '<div class="bird-seed"></div>' : '');
  birdEl.title = withSeed ? '今天的待办全部完成啦！' : '叽叽——点我一下';
  stage.appendChild(birdEl);
  birdEl.style.left = x + 'px'; birdEl.style.top = y + 'px';
  if (!reducedMotion() && !document.body.classList.contains('power-save')) {
    birdEl.animate([
      { transform: 'translate(-90px, -70px) rotate(-16deg)', opacity: 0 },
      { transform: 'translate(0, 0) rotate(0deg)', opacity: 1 },
    ], { duration: 900, easing: 'cubic-bezier(0.3, 0.7, 0.3, 1)' });
  }
  playChirp(0.2);
  birdEl.addEventListener('click', () => birdFliesAway());
  birdLeaveTimer = setTimeout(() => birdFliesAway(), withSeed ? 60000 : 26000 + Math.random() * 14000);
}
function birdFliesAway() {
  if (birdLeaveTimer) { clearTimeout(birdLeaveTimer); birdLeaveTimer = null; }
  if (!birdEl) return;
  const el = birdEl; birdEl = null;
  if (reducedMotion() || document.body.classList.contains('power-save')) { el.remove(); return; }
  try { playChirp(0.16); } catch { /* ignore */ }
  el.animate([
    { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
    { transform: 'translate(140px, -90px) rotate(12deg)', opacity: 0 },
  ], { duration: 800, easing: 'cubic-bezier(0.5, 0, 0.8, 0.6)' }).finished.then(() => el.remove()).catch(() => el.remove());
}
function birdBringsSeed() {
  const today = new Date().toISOString().slice(0, 10);
  api.send('settings:set', { key: 'sunSeedDate', value: today });
  attachSeed();
  spawnBird(true);
}
function attachSeed() {
  let seed = document.getElementById('ropeSeed');
  if (!seed) {
    seed = document.createElement('div');
    seed.id = 'ropeSeed';
    seed.title = '太阳种子 · 今天所有待办都完成了';
    stage.appendChild(seed);
  }
  seed.style.left = Math.round(width - 58) + 'px';
  seed.style.top = Math.round(L.ropeY(width - 58, width) - 14) + 'px';
}
function showSeedIfToday() {
  if (document.body.dataset.sunSeed === new Date().toISOString().slice(0, 10)) attachSeed();
}
// 随机来访：绳展开状态下每 3.5-8 分钟一次机会
(function scheduleBirdVisit() {
  setTimeout(() => {
    if (document.getElementById('stage').classList.contains('revealed') && !birdEl && !document.hidden) spawnBird(false);
    scheduleBirdVisit();
  }, 210000 + Math.random() * 260000);
})();

// —— 每日发现卡：好书/电影/音乐/格言/知识点，5 分钟自动轮换，点击换一条 ——
function ensureDiscoverSlot() {
  if (discoverSlotEl) return;
  discoverSlotEl = document.createElement('div');
  discoverSlotEl.className = 'slot arrived discover-slot';
  discoverSlotEl.innerHTML = '<div class="arrive" style="transform:none;opacity:1"><div class="swing"><div class="peg"></div><div class="cardfx glass discover-fx"><div class="disc-holder"></div></div></div></div>';
  discoverSlotEl.addEventListener('click', () => { discoverIdx++; renderDiscover(); try { playBlip(0.15); } catch { /* ignore */ } });
  cardsEl.appendChild(discoverSlotEl);
  renderDiscover();
}
function renderDiscover() {
  if (!discoverSlotEl) return;
  const entry = window.DISCOVER.current(discoverIdx);
  const holder = discoverSlotEl.querySelector('.disc-holder');
  holder.innerHTML = window.DISCOVER.cardHTML(entry);
  if (!reducedMotion() && !document.body.classList.contains('power-save') && holder.animate) {
    holder.animate([{ transform: 'rotateY(70deg)', opacity: 0.4 }, { transform: 'rotateY(0deg)', opacity: 1 }], { duration: 360, easing: 'ease-out' });
  }
}
function updateDiscover() {
  ensureDiscoverSlot();
  // 发现卡挂在添加卡之后（绳尾），随绳滚动——与任何卡片都不重叠。
  // fits 扇面放不下时让位隐藏（少量卡片才有扇面，属可接受的取舍）。
  // 与普通卡完全同规：fits=序列倒数第二位（添加卡左侧），track=轨道里添加卡左侧
  if (state.items.length === 0) { discoverSlotEl.style.display = 'none'; return; } // 空绳时让位欢迎卡
  let x;
  if (track) x = track.discX;
  else x = L.xAt(state.items.length, state.items.length + 2, width);
  if (!track && x + 90 > width - 6) { discoverSlotEl.style.display = 'none'; return; }
  discoverSlotEl.style.display = '';
  discoverSlotEl.style.left = (x - 92) + 'px';
  discoverSlotEl.style.top = (L.ropeY(x - scrollX, width) - L.PIN_ABOVE) + 'px';
}
setInterval(() => { discoverIdx++; renderDiscover(); }, 300000);
showSeedIfToday();
