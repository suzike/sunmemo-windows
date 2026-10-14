'use strict';
// theme switching: beacon.html's @media (prefers-color-scheme: dark) blocks
// restyle the pill/border/label automatically — no matchMedia listener needed.
const api = window.sun;
// time-of-day hue, set once per load: dawn 5-10 / day 10-17 / dusk 17-20 / night 5-5
const hr = new Date().getHours();
document.body.classList.add(
  hr >= 5 && hr < 10 ? 'dawn' : hr >= 10 && hr < 17 ? 'day' : hr >= 17 && hr < 20 ? 'dusk' : 'night'
);
let hoverTimer = null;

const pill = document.getElementById('beacon');
const label = pill.querySelector('.label');

function beaconPos() {
  const r = pill.getBoundingClientRect();
  return { fromX: Math.round(r.left + r.width / 2), fromY: Math.round(r.top + r.height / 2) };
}
pill.addEventListener('click', () => {
  try { api.send('beacon:click', beaconPos()); } catch { /* ignore */ }
});
// hover opens too (feels natural) — debounced so a passing cursor doesn't trigger
pill.addEventListener('mouseenter', () => {
  clearTimeout(hoverTimer);
  hoverTimer = setTimeout(() => { try { api.send('beacon:click', beaconPos()); } catch { /* ignore */ } }, 400);
  applyLabel();
});
pill.addEventListener('mouseleave', () => { clearTimeout(hoverTimer); applyLabel(); });

// ---- v1.8 信标状态：待办在收起状态下也要在场 --------------------------------
// 主进程随 broadcast 推 beacon:stats；本页加载完成时再主动拉一次（启动竞态兜底）。
// total=0 → 64px 窄胶囊；未收尾 → 「N 件未收尾」常显；全部打完 → 金色「今日清零 ✓」。
// 悬停时文字临时切回「展开晾衣绳」；拖文件悬停时显示「松手挂到绳上」。
let statText = '';   // '' = 无待办状态（回到默认窄胶囊）
let dropping = false;
function applyLabel() {
  label.textContent = dropping ? '松手挂到绳上' : (pill.matches(':hover') ? '展开晾衣绳' : (statText || '晾衣绳'));
}
function applyStats(s) {
  const total = Number(s && s.total) || 0;
  const done = Number(s && s.done) || 0;
  const pending = Math.max(0, total - done);
  if (total > 0 && pending === 0) {
    pill.dataset.state = 'done';
    pill.classList.add('status');
    statText = '今日清零 ✓';
    pill.style.setProperty('--bw', '118px');
  } else if (pending > 0) {
    pill.dataset.state = 'todo';
    pill.classList.add('status');
    statText = pending + ' 件未收尾';
    pill.style.setProperty('--bw', pending >= 10 ? '124px' : '112px');
  } else {
    delete pill.dataset.state;
    pill.classList.remove('status');
    statText = '';
    pill.style.setProperty('--bw', '64px');
  }
  pill.title = statText ? 'SunMemo · ' + statText + ' · 点击展开晾衣绳' : 'SunMemo · 点击展开晾衣绳';
  applyLabel();
}
api.on('beacon:stats', applyStats);
api.invoke('beacon:get-stats').then(applyStats).catch(() => { /* 主进程尚在启动 */ });

// ---- v1.6 文档/图片拖到信标太阳上 = 直接挂绳（绳收起时的投递口） ------------
// 必须 preventDefault，否则 Electron 默认行为是整窗导航到被拖文件（信标报废）。
document.addEventListener('dragover', ev => {
  ev.preventDefault();
  if (ev.dataTransfer) {
    ev.dataTransfer.dropEffect = 'copy';
    ev.dataTransfer.effectAllowed = 'copy';
  }
  if (!dropping) { dropping = true; pill.classList.add('dropping'); applyLabel(); }
});
document.addEventListener('dragleave', ev => {
  if (!ev.relatedTarget && dropping) { dropping = false; pill.classList.remove('dropping'); applyLabel(); }
});
document.addEventListener('drop', ev => {
  ev.preventDefault();
  dropping = false;
  pill.classList.remove('dropping');
  applyLabel();
  const files = [...(ev.dataTransfer ? ev.dataTransfer.files : [])];
  const paths = files.map(f => { try { return api.getPathForFile(f); } catch { return null; } }).filter(Boolean);
  if (paths.length) api.send('beacon:drop-files', paths);
});

// beacon visibility is managed by the main process (show/hide of this window)
