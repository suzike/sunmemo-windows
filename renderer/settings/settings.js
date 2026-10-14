'use strict';
/* Settings page logic — shortcut recording, toggles, update check. */

const api = window.sun;
const HOTKEYS = ['toggle', 'memo', 'paste'];
const labels = { toggle: 'btn-toggle', memo: 'btn-memo', paste: 'btn-paste' };
const btns = {};
for (const k of HOTKEYS) btns[k] = document.getElementById(labels[k]);

let data = null;
let recording = null;
let customDot = null; // R157: the 6th "custom" accent dot (disguised input[type=color])

api.invoke('settings:data').then(d => {
  data = d;
  document.getElementById('ver').textContent = 'v' + d.version;
  document.getElementById('chkAutoHang').checked = d.settings.autoHang;
  const THEMES = { sunrise: '#ff8f1f', mint: '#2fbf9f', sakura: '#f06292', sky: '#4a9ff5', grape: '#8b5cf6' };
  const themeRow = document.getElementById('themeRow');
  const curTheme = d.settings.accent || 'sunrise';
  Object.entries(THEMES).forEach(([name, color]) => {
    const b = document.createElement('button');
    b.style.cssText = `width:22px;height:22px;border-radius:50%;border:2px solid ${name === curTheme ? '#0a84ff' : 'rgba(0,0,0,0.15)'};background:${color};cursor:pointer`;
    b.title = name;
    b.addEventListener('click', () => {
      themeRow.querySelectorAll('button').forEach(x => x.style.borderColor = 'rgba(0,0,0,0.15)');
      if (customDot) customDot.style.borderColor = 'rgba(0,0,0,0.15)';
      b.style.borderColor = '#0a84ff';
      api.send('settings:set', { key: 'accent', value: name });
    });
    themeRow.appendChild(b);
  });
  // R157: 6th "custom" dot — a native color picker disguised as a swatch.
  // Shows the current custom color; change broadcasts settings:set accentCustom.
  const curCustom = d.settings.accentCustom;
  const st = document.createElement('style');
  st.textContent = '.accent-custom{appearance:none;-webkit-appearance:none;width:22px;height:22px;border-radius:50%;padding:0;background:transparent;cursor:pointer;outline:none}'
    + '.accent-custom::-webkit-color-swatch-wrapper{padding:0}.accent-custom::-webkit-color-swatch{border:none;border-radius:50%}';
  document.head.appendChild(st);
  const pick = document.createElement('input');
  pick.type = 'color';
  pick.className = 'accent-custom';
  pick.value = curCustom || '#ff8f1f';
  pick.title = '自定义';
  pick.style.border = `2px solid ${(curTheme === 'custom' || curCustom) ? '#0a84ff' : 'rgba(0,0,0,0.15)'}`;
  pick.addEventListener('change', () => {
    themeRow.querySelectorAll('button').forEach(x => x.style.borderColor = 'rgba(0,0,0,0.15)');
    pick.style.borderColor = '#0a84ff';
    api.send('settings:set', { key: 'accentCustom', value: pick.value });
  });
  customDot = pick;
  themeRow.appendChild(pick);
  document.getElementById('chkSound').checked = d.settings.soundOn;
  document.getElementById('chkImgZoom').checked = d.settings.imgZoom !== false;
  document.getElementById('chkSink').checked = d.settings.sink !== false;
  // 晾衣绳位置：跟随鼠标 / 固定某块显示器
  (async () => {
    try {
      const displays = await api.invoke('displays:list');
      const sel = document.getElementById('selDisplay');
      const cur = d.settings.displayMode || 'follow';
      for (const d2 of displays) {
        const opt = document.createElement('option');
        opt.value = d2.id;
        opt.textContent = '固定在 ' + d2.label;
        sel.appendChild(opt);
      }
      sel.value = cur === 'follow' || displays.some(x => x.id === cur) ? cur : 'follow';
    } catch { /* 列表失败时保留跟随选项 */ }
  })();
  document.getElementById('chkPower').checked = !!d.settings.powerSave;
  document.getElementById('chkWind').checked = !!d.settings.wind;
  document.getElementById('chkGpu').checked = d.settings.gpuSoftware !== true;
  document.getElementById('chkBeacon').checked = d.settings.beacon !== false;
  document.getElementById('chkNotify').checked = !!d.settings.hangNotify;
  document.getElementById('chkLogin').checked = !!d.login;
  const FONTS = { sm: '小', md: '中', lg: '大' };
  const fontRow = document.getElementById('fontRow');
  const curFont = d.settings.cardFont || 'md';
  Object.entries(FONTS).forEach(([k, label]) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = `font-family:inherit;font-size:11px;border:0;border-radius:6px;padding:4px 12px;cursor:pointer;background:${k === curFont ? '#0a84ff' : 'rgba(0,0,0,0.08)'};color:${k === curFont ? '#fff' : 'inherit'}`;
    b.addEventListener('click', () => {
      fontRow.querySelectorAll('button').forEach(x => { x.style.background = 'rgba(0,0,0,0.08)'; x.style.color = 'inherit'; });
      b.style.background = '#0a84ff'; b.style.color = '#fff';
      api.send('settings:set', { key: 'cardFont', value: k });
    });
    fontRow.appendChild(b);
  });
  initVolume(d.settings.volume ?? 0.6);
  document.getElementById('chkAutoUpdate').checked = d.settings.autoUpdate;
  document.getElementById('appIcon').src = d.iconPath;
  document.getElementById('updStatus').textContent = d.hotkeyStatus || '';
  for (const k of HOTKEYS) btns[k].textContent = pretty(d.settings.hotkeys[k]);
});

function pretty(acc) {
  return acc
    .replace(/\+/g, ' + ')
    .replace('Control', 'Ctrl')
    .replace('Or', '+')
    .replace('CmdOrCtrl', 'Ctrl');
}

btns.toggle.addEventListener('click', () => startRecord('toggle'));
btns.memo.addEventListener('click', () => startRecord('memo'));
btns.paste.addEventListener('click', () => startRecord('paste'));

function startRecord(k) {
  if (recording === k) { stopRecord(); return; }
  stopRecord();
  recording = k;
  btns[k].textContent = '请按下组合键...';
  btns[k].classList.add('recording');
}

function stopRecord() {
  if (!recording) return;
  btns[recording].classList.remove('recording');
  btns[recording].textContent = pretty(data.settings.hotkeys[recording]);
  recording = null;
}

window.addEventListener('keydown', ev => {
  if (ev.key === 'Escape' && recording) { ev.preventDefault(); stopRecord(); return; }
  if (!recording) {
    if (ev.key === 'Escape') window.close();
    return;
  }
  ev.preventDefault();
  const parts = [];
  if (ev.ctrlKey || ev.metaKey) parts.push('Control');
  if (ev.altKey) parts.push('Alt');
  if (ev.shiftKey) parts.push('Shift');
  let key = ev.key.length === 1 ? ev.key.toUpperCase() : ev.key;
  if (key === ' ') key = 'Space';
  if (key.startsWith('Arrow')) key = key.replace('Arrow', '');
  if (parts.length === 0) return; // must include a modifier
  parts.push(key);
  const acc = parts.join('+');
  data.settings.hotkeys[recording] = acc;
  btns[recording].textContent = pretty(acc);
  btns[recording].classList.remove('recording');
  api.send('settings:hotkeys', { [recording]: acc });
  setTimeout(async () => {
    const d2 = await api.invoke('settings:data');
    document.getElementById('updStatus').textContent = d2.hotkeyStatus || '';
  }, 150);
  recording = null;
});

document.getElementById('chkAutoHang').addEventListener('change', e => api.send('settings:set', { key: 'autoHang', value: e.target.checked }));
document.getElementById('selDisplay').addEventListener('change', e => api.send('settings:set', { key: 'displayMode', value: e.target.value }));
document.getElementById('chkSound').addEventListener('change', e => api.send('settings:set', { key: 'soundOn', value: e.target.checked }));
document.getElementById('chkImgZoom').addEventListener('change', e => api.send('settings:set', { key: 'imgZoom', value: e.target.checked }));
document.getElementById('chkSink').addEventListener('change', e => api.send('settings:set', { key: 'sink', value: e.target.checked }));
document.getElementById('chkPower').addEventListener('change', e => api.send('settings:set', { key: 'powerSave', value: e.target.checked }));
document.getElementById('chkWind').addEventListener('change', e => api.send('settings:set', { key: 'wind', value: e.target.checked }));
document.getElementById('resetAppearance').addEventListener('click', () => {
  api.send('settings:set', { key: 'accent', value: 'sunrise' });
  api.send('settings:set', { key: 'cardFont', value: 'md' });
  api.send('settings:set', { key: 'compact', value: false });
  api.send('settings:set', { key: 'beacon', value: true });
  api.invoke('settings:data').then(d2 => {
    document.getElementById('chkBeacon').checked = d2.settings.beacon !== false;
    const tr = document.getElementById('themeRow');
    tr.querySelectorAll('button').forEach((x, i) => { x.style.borderColor = i === 0 ? '#0a84ff' : 'rgba(0,0,0,0.15)'; });
    if (customDot) customDot.style.borderColor = 'rgba(0,0,0,0.15)'; // R157: reset also un-picks the custom dot
    const fr = document.getElementById('fontRow');
    fr.querySelectorAll('button').forEach((x, i) => { x.style.background = i === 1 ? '#0a84ff' : 'rgba(0,0,0,0.08)'; x.style.color = i === 1 ? '#fff' : 'inherit'; });
  });
});
document.getElementById('chkGpu').addEventListener('change', e => {
  api.send('settings:set', { key: 'gpuSoftware', value: !e.target.checked });
  // R93: don't yank the app away silently — say what's happening, then go.
  const st = document.getElementById('updStatus');
  st.textContent = '已切换渲染模式，正在重启应用…';
  st.classList.add('orange');
  setTimeout(() => api.send('settings:relaunch'), 1400);
});
document.getElementById('chkBeacon').addEventListener('change', e => api.send('settings:set', { key: 'beacon', value: e.target.checked }));
document.getElementById('chkNotify').addEventListener('change', e => api.send('settings:set', { key: 'hangNotify', value: e.target.checked }));
document.getElementById('chkLogin').addEventListener('change', e => api.send('settings:login', e.target.checked));
// Volume: dragging updates local display only; persisting happens on release (change).
// Settings window has no sound channel (play-sound goes to lineWin only) -> no tick preview.
const volSlider = document.getElementById('vol');
const volLabel = document.getElementById('volLabel');
const muteBtn = document.createElement('span');
muteBtn.setAttribute('role', 'button');
muteBtn.title = '静音/取消静音';
muteBtn.style.cssText = 'cursor:pointer;user-select:none;padding:0 2px;';
volLabel.insertAdjacentElement('afterend', muteBtn);
let curVol = 0.6;
let lastVol = null; // remembers last non-zero volume for mute toggle
function renderVolume() {
  const pct = Math.round(curVol * 100);
  volSlider.value = Math.max(Number(volSlider.min), pct);
  volLabel.textContent = pct + '%';
  muteBtn.textContent = curVol > 0 ? '🔊' : '🔇';
}
function initVolume(v) {
  curVol = v;
  if (v > 0) lastVol = v;
  renderVolume();
}
volSlider.addEventListener('input', e => {
  curVol = Number(e.target.value) / 100;
  if (curVol > 0) lastVol = curVol;
  volLabel.textContent = e.target.value + '%';
  muteBtn.textContent = curVol > 0 ? '🔊' : '🔇';
});
volSlider.addEventListener('change', () => api.send('settings:set', { key: 'volume', value: curVol }));
muteBtn.addEventListener('click', () => {
  curVol = curVol > 0 ? 0 : (lastVol ?? 0.6);
  if (curVol > 0) lastVol = curVol;
  api.send('settings:set', { key: 'volume', value: curVol });
  renderVolume();
});
document.getElementById('chkAutoUpdate').addEventListener('change', e => api.send('settings:set', { key: 'autoUpdate', value: e.target.checked }));
document.getElementById('resetBtn').addEventListener('click', () => {
  api.send('settings:reset-hotkeys');
  setTimeout(() => api.invoke('settings:data').then(d => {
    data = d;
    for (const k of HOTKEYS) btns[k].textContent = pretty(d.settings.hotkeys[k]);
  }), 120);
});
document.getElementById('doneBtn').addEventListener('click', () => window.close());

const checkBtn = document.getElementById('checkBtn');
const updStatus = document.getElementById('updStatus');
checkBtn.addEventListener('click', async () => {
  checkBtn.disabled = true;
  checkBtn.textContent = '检查中...';
  const r = await api.invoke('settings:check-update');
  checkBtn.disabled = false;
  checkBtn.textContent = '检查更新';
  updStatus.textContent = r.status;
  updStatus.classList.toggle('orange', !!r.update);
});

// R167: 窗口入场 —— ready-to-show 后补 .in 触发 settings.css 的 .wrap 展开过渡
requestAnimationFrame(() => document.body.classList.add('in'));
