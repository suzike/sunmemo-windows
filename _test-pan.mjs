'use strict';
// 便签横向拖平移（CDP 带屏幕坐标） + 发现卡不重叠断言
import { setTimeout as sleep } from 'node:timers/promises';
const E = String.fromCharCode(92);
const DOCS = ['E:', 'Agentic_Engineering', 'ZCode', 'sunidea', '_docs'].join(E);
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
for (const n of ['设计说明.pdf', '会议纪要.docx']) {
  await ev(`window.sun.send('line:drop-file', ${JSON.stringify(DOCS + E + n)})`);
  await sleep(500);
}
await sleep(1000);
// 发现卡在添加卡左侧、无重叠
console.log('geometry:', await ev(`(() => { const d = document.querySelector('.discover-card'); if (!d) return 'no disc'; const dr = d.closest('.slot').getBoundingClientRect(); const add = [...document.querySelectorAll('.slot')].find(s => s.querySelector('.add-face')); const ar = add ? add.querySelector('.add-face').getBoundingClientRect() : null; return { discLeft: Math.round(dr.left), discRight: Math.round(dr.right), addLeft: ar ? Math.round(ar.left) : 'NO ADD', noOverlap: ar ? dr.right <= ar.left : '?', opaque: getComputedStyle(d).backgroundColor }; })()`));
// 横向拖便签（带屏幕坐标）→ 平移
const dr = await ev(`(() => { const f = [...document.querySelectorAll('.slot .memo-face')][0]; const r = f.getBoundingClientRect(); f.draggable = false; return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
const tf0 = await ev(`document.getElementById('cards').style.transform || 'none'`);
await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: dr.x, y: dr.y, button: 'left', clickCount: 1, buttons: 1 });
for (const dx of [6, 16, 28, 40, 52]) {
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: dr.x + dx, y: dr.y, button: 'left', buttons: 1, screenX: Math.round((dr.x + dx) * 1.5), screenY: Math.round(dr.y * 1.5) });
  await sleep(70);
}
await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: dr.x + 52, y: dr.y, button: 'left', clickCount: 1, buttons: 0 });
await sleep(400);
const tf1 = await ev(`document.getElementById('cards').style.transform || 'none'`);
await ev(`(() => { const f = document.querySelector('.memo-face'); if (f) f.draggable = true; return 1; })()`);
console.log('pan on memo:', JSON.stringify({ tf0, tf1, panned: tf0 !== tf1 }));
process.exit(0);
