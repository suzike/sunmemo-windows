'use strict';
// Dual-mode acceptance: fits ordering & no-overlap; track (12 photos) scrolling works.
import { execSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
const E = String.fromCharCode(92);
const APP = ['E:', 'Agentic_Engineering', 'ZCode', 'sunidea'].join(E);
const SHOTS = APP + E + '_shots';
const PS = c => execSync(`powershell -NoProfile -Command "${c}"`, { stdio: 'ignore' });
let pass = 0, fail = 0;
const chk = (n, c, x = '') => { (c ? pass++ : fail++); console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  <<< ' + x)); };
const t = async () => (await (await fetch('http://127.0.0.1:9222/json/list')).json()).filter(x => x.type === 'page');
const lt = (await t()).find(x => x.url.includes('line.html'));
const ws = new WebSocket(lt.webSocketDebuggerUrl);
await new Promise(r => { ws.onopen = r; });
let i = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const call = (m, p = {}) => new Promise(res => { const id = ++i; pend.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })); });
const ev = async x => { const r = await call('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return 'EXC ' + String(r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 140); return r.result && r.result.result && r.result.result.value; };
await call('Runtime.enable');
let rev = await ev(`document.getElementById('stage').classList.contains('revealed')`);
if (!rev) { await ev(`window.sun.send('line:toggle-userpin')`); await sleep(800); }

// ---- fits 模式（demo 4 卡）----
const fits = await ev(`(() => {
  const slots = [...document.querySelectorAll('.slot')];
  const rs = slots.map(s => ({ cls: (s.querySelector('.add-face') ? 'ADD' : (s.querySelector('.discover-card') ? 'DISC' : (s.querySelector('.card') ? s.querySelector('.card').className.split(' ')[1] : '?'))), l: s.getBoundingClientRect().left, r: s.getBoundingClientRect().right })).filter(x => x.r > 0);
  const pairs = [];
  for (let a = 0; a < rs.length; a++) for (let b = a + 1; b < rs.length; b++) { const l = Math.max(rs[a].l, rs[b].l), rr = Math.min(rs[a].r, rs[b].r); if (rr - l > 24) pairs.push(rs[a].cls + 'x' + rs[b].cls + '=' + Math.round(rr - l)); }
  const disc = rs.find(x => x.cls === 'DISC'); const add = rs.find(x => x.cls === 'ADD');
  const items = rs.filter(x => x.cls !== 'DISC' && x.cls !== 'ADD');
  return { order: rs.map(x => x.cls).join('<'), overlaps: pairs, discLeftOfAdd: disc && add ? disc.r <= add.l + 4 : null, discAfterItems: disc && items.length ? disc.l >= Math.max(...items.map(x => x.r)) - 30 : null, neon: !!document.querySelector('.disc-holder') };
})()`);
console.log('fits:', JSON.stringify(fits));
chk('fits：顺序正确（发现卡在添加卡左侧、内容之后）', Array.isArray(fits) || (fits.discLeftOfAdd === true && fits.discAfterItems === true), JSON.stringify(fits));
chk('fits：无重叠（扇面微叠 ≤24px 属设计）', fits.overlaps.length === 0, JSON.stringify(fits.overlaps));

// ---- track 模式：挂 12 张图 ----
execSync('python -c "from PIL import Image; [Image.new(\'RGB\', (900, 620), (200, 160, 120)).save(r\'E:\\\\Agentic_Engineering\\\\ZCode\\\\sunidea\\\\_docs\\\\wall%d.png\' % k) for k in range(12)]"', { stdio: 'ignore' });
for (let k = 0; k < 12; k++) {
  await ev(`window.sun.send('line:drop-file', ${JSON.stringify(APP + E + '_docs' + E + 'wall' + k + '.png')})`);
  await sleep(260);
}
await sleep(1800);
const trackInfo = await ev(`(() => {
  const track = window.__trackProbe ? null : null;
  const bar = document.getElementById('scrollBar');
  const next = document.getElementById('scrollNext');
  const tf0 = document.getElementById('cards').style.transform || 'none';
  return { barShow: bar && bar.classList.contains('show'), nextShow: next && next.classList.contains('show'), tf0, slots: document.querySelectorAll('.slot[data-id]').length, discVis: (() => { const d = document.querySelector('.discover-slot'); if (!d) return false; const r = d.getBoundingClientRect(); return r.right > 0 && r.left < innerWidth; })() };
})()`);
console.log('track:', JSON.stringify(trackInfo));
chk('track：行程条与右箭头出现', trackInfo.barShow === true && trackInfo.nextShow === true, JSON.stringify(trackInfo));
// 滚轮平移
await call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 850, y: 80, deltaX: 0, deltaY: 800 });
await sleep(600);
const tf1 = await ev(`document.getElementById('cards').style.transform`);
chk('track：滚轮平移生效', tf1 !== trackInfo.tf0 && tf1.includes('-'), tf1);
// 滚到最右 → 发现卡可见
await call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 850, y: 80, deltaX: 0, deltaY: 8000 });
await sleep(800);
const discVis = await ev(`(() => { const d = document.querySelector('.discover-slot'); const r = d.getBoundingClientRect(); return { vis: r.right > 0 && r.left < innerWidth - 4, l: Math.round(r.left) }; })()`);
chk('track：滚到最右后每日发现卡可见', discVis.vis === true, JSON.stringify(discVis));
// 重叠检测（track 模式，仅屏幕内）
const ov2 = await ev(`(() => { const rs = [...document.querySelectorAll('.slot')].map(s => s.getBoundingClientRect()).filter(r => r.width > 0 && r.right > 0 && r.left < innerWidth); let n = 0; for (let a = 0; a < rs.length; a++) for (let b = a + 1; b < rs.length; b++) { const l = Math.max(rs[a].left, rs[b].left), rr = Math.min(rs[a].right, rs[b].right); if (rr - l > 30) n++; } return n; })()`);
chk('track：屏幕内无重叠', ov2 === 0, 'overlaps=' + ov2);
PS(`Add-Type -AssemblyName System.Drawing; $b = New-Object System.Drawing.Bitmap(2560, 430); $g = [System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen(0, 0, 0, 0, $b.Size); $b.Save('${SHOTS + E}v171-track.png'); $g.Dispose(); $b.Dispose()`);

console.log(`DUAL-MODE RESULT: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
