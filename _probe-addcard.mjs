'use strict';
// v1.7.1 现场检查：添加卡是否在 DOM、发现卡几何、轨道模式、异常捕获
import { setTimeout as sleep } from 'node:timers/promises';
const E = String.fromCharCode(92);
const t = async () => (await (await fetch('http://127.0.0.1:9222/json/list')).json()).filter(x => x.type === 'page');
const lt = (await t()).find(x => x.url.includes('line.html'));
if (!lt) { console.log('NO LINE'); process.exit(1); }
const ws = new WebSocket(lt.webSocketDebuggerUrl);
await new Promise(r => { ws.onopen = r; });
let i = 0; const pend = new Map();
const log = [];
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    console.log('[EXC]', d.text, String(d.exception && d.exception.description || '').split('\n').slice(0, 3).join(' | ').slice(0, 240));
  }
};
const call = (m, p = {}) => new Promise(res => { const id = ++i; pend.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })); });
const ev = async x => { const r = await call('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return 'EXC ' + String(r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 160); return r.result && r.result.result && r.result.result.value; };
await call('Runtime.enable');
let rev = await ev(`document.getElementById('stage').classList.contains('revealed')`);
if (!rev) { await ev(`window.sun.send('line:toggle-userpin')`); await sleep(800); }
await sleep(800);
console.log(await ev(`JSON.stringify({
  addFace: !!document.querySelector('.add-face'),
  addSlot: (() => { const s = [...document.querySelectorAll('.slot')].find(x => x.querySelector('.add-face')); return s ? { left: s.style.left, top: s.style.top, w: s.style.width, display: getComputedStyle(s).display } : 'NO SLOT'; })(),
  disc: (() => { const s = document.querySelector('.discover-slot'); if (!s) return 'NO SLOT'; const r = s.getBoundingClientRect(); return { left: s.style.left, top: s.style.top, x: Math.round(r.x), w: Math.round(r.width), vis: r.width > 0 }; })(),
  itemCount: document.querySelectorAll('.slot[data-id]').length,
  lastMemoRight: (() => { const f = [...document.querySelectorAll('.slot[data-id]')].pop(); return f ? Math.round(f.getBoundingClientRect().right) : null; })(),
  innerWidth: innerWidth
})`));
process.exit(0);
