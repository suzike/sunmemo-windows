'use strict';
// Drag a photo card while listening for renderer exceptions.
import { setTimeout as sleep } from 'node:timers/promises';
const t = async () => (await (await fetch('http://127.0.0.1:9222/json/list')).json()).filter(x => x.type === 'page');
const lt = (await t()).find(x => x.url.includes('line.html'));
const ws = new WebSocket(lt.webSocketDebuggerUrl);
await new Promise(r => { ws.onopen = r; });
let i = 0; const pend = new Map();
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    console.log('[EXC]', d.text, String(d.exception && d.exception.description || '').split('\n').slice(0, 3).join(' | ').slice(0, 260));
  }
};
const call = (m, p = {}) => new Promise(res => { const id = ++i; pend.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })); });
const ev = async x => { const r = await call('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return 'EXC ' + String(r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 200); return r.result && r.result.result && r.result.result.value; };
await call('Runtime.enable');
let rev = await ev(`document.getElementById('stage').classList.contains('revealed')`);
if (!rev) { await ev(`window.sun.send('line:toggle-userpin')`); await sleep(700); }
const pt = await ev(`(() => { const f = [...document.querySelectorAll('.slot .photo-clip')][0]; const r = f.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
console.log('pt:', JSON.stringify(pt));
// 先看 mousedown 是否建了 dragState
await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
await sleep(150);
console.log('after press:', await ev(`(() => ({ pressed: !!document.querySelector('.slot.pressed'), pressedCount: document.querySelectorAll('.slot.pressed').length }))()`));
await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x + 10, y: pt.y + 4, button: 'left', buttons: 1 });
await sleep(200);
console.log('after move:', await ev(`({ dragging: !!document.querySelector('.slot.dragging'), pressed: !!document.querySelector('.slot.pressed') })`));
await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x + 60, y: pt.y + 90, button: 'left', clickCount: 1 });
await sleep(300);
process.exit(0);
