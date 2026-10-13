'use strict';
import { execSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
const E = String.fromCharCode(92);
const APP = ['E:', 'Agentic_Engineering', 'ZCode', 'sunidea'].join(E);
const t = async () => (await (await fetch('http://127.0.0.1:9222/json/list')).json()).filter(x => x.type === 'page');
const lt = (await t()).find(x => x.url.includes('line.html'));
const ws = new WebSocket(lt.webSocketDebuggerUrl);
await new Promise(r => { ws.onopen = r; });
let i = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } if (m.method === 'Runtime.exceptionThrown') { const d = m.params.exceptionDetails; console.log('[EXC]', d.text, String(d.exception && d.exception.description || '').split('\n').slice(0, 2).join(' | ').slice(0, 220)); } };
const call = (m, p = {}) => new Promise(res => { const id = ++i; pend.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })); });
const ev = async x => { const r = await call('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return 'EXC ' + String(r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 180); return r.result && r.result.result && r.result.result.value; };
await call('Runtime.enable');
let rev = await ev(`document.getElementById('stage').classList.contains('revealed')`);
if (!rev) { await ev(`window.sun.send('line:toggle-userpin')`); await sleep(800); }
await ev(`(() => {
  window.__log = [];
  window.addEventListener('mousedown', e => window.__log.push('down@' + Math.round(e.screenX) + ',' + Math.round(e.screenY) + ' btn=' + e.button), true);
  window.addEventListener('mousemove', e => { if (window.__log.filter(s => s.startsWith('mm')).length < 3) window.__log.push('mm@' + Math.round(e.screenX) + ',' + Math.round(e.screenY) + ' btns=' + e.buttons); }, true);
  const obs = new MutationObserver(muts => muts.forEach(m => { if (String(m.target.className).includes('dragging')) window.__log.push('DRAGGING-CLASS'); if (String(m.target.className).includes('pressed')) window.__log.push('PRESSED'); }));
  obs.observe(document.getElementById('cards'), { subtree: true, attributeFilter: ['class'] });
  return true;
})()`);
// 物理坐标 = 窗口屏幕原点 + 逻辑位置 × dpr（绳可能在任意显示器上）
const photo = await ev(`(() => { const f = [...document.querySelectorAll('.slot .photo-clip')][0]; if (!f) return null; const r = f.getBoundingClientRect(); const d = devicePixelRatio || 1; return { x: Math.round(window.screenX + (r.left + r.width / 2) * d), y: Math.round(window.screenY + (r.top + r.height / 2) * d) }; })()`);
console.log('photo:', JSON.stringify(photo));
execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${APP + E}scripts-input-drag.ps1" -x ${photo.x} -y ${photo.y} -dx 140 -dy 160`, { stdio: 'ignore' });
await sleep(400);
console.log('log:', await ev(`JSON.stringify(window.__log.slice(0, 14))`));
process.exit(0);
