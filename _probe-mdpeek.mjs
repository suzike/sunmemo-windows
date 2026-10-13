'use strict';
// Real-cursor hover on the md card → peek panel correctness.
import { execSync } from 'node:child_process';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const E = String.fromCharCode(92);
const APP = ['E:', 'Agentic_Engineering', 'ZCode', 'sunidea'].join(E);
const t = async () => (await (await fetch('http://127.0.0.1:9222/json/list')).json()).filter(x => x.type === 'page');
const lt = (await t()).find(x => x.url.includes('line.html'));
const ws = new WebSocket(lt.webSocketDebuggerUrl);
await new Promise(r => { ws.onopen = r; });
let i = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const call = (m, p = {}) => new Promise(res => { const id = ++i; pend.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })); });
const ev = async x => { const r = await call('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return 'EXC'; return r.result && r.result.result && r.result.result.value; };
await call('Runtime.enable');
let rev = await ev(`document.getElementById('stage').classList.contains('revealed')`);
if (!rev) { await ev(`window.sun.send('line:toggle-userpin')`); await sleep(800); }
await ev(`window.sun.send('line:drop-file', ${JSON.stringify(APP + E + '_docs' + E + '项目方案.md')})`);
await sleep(1300);
const pt = await ev(`(() => { const f = [...document.querySelectorAll('.slot')].find(x => { const n = x.querySelector('.doc-name'); return n && n.textContent.indexOf('.md') >= 0; }); if (!f) return null; const r = f.querySelector('.doc-face').getBoundingClientRect(); return { x: Math.round((r.left + r.width / 2) * devicePixelRatio), y: Math.round((r.top + r.height / 2) * devicePixelRatio) }; })()`);
if (!pt || !pt.x) { console.log('NO MD CARD'); process.exit(1); }
execSync(`powershell -NoProfile -Command "& '${APP + E}scripts-input-abs.ps1' -x ${pt.x} -y ${pt.y}"`, { stdio: 'ignore' });
await sleep(2400);
const ov = (await t()).find(x => x.url.includes('overlay.html'));
const ws2 = new WebSocket(ov.webSocketDebuggerUrl);
await new Promise(r => { ws2.onopen = r; });
let j = 0; const pend2 = new Map();
ws2.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend2.has(m.id)) { pend2.get(m.id)(m); pend2.delete(m.id); } };
const call2 = (m, p = {}) => new Promise(res => { const id = ++j; pend2.set(id, res); ws2.send(JSON.stringify({ id, method: m, params: p })); });
const ev2 = async x => { const r = await call2('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return 'EXC ' + String(r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 140); return JSON.stringify(r.result && r.result.result && r.result.result.value); };
await call2('Runtime.enable');
console.log('peek md:', await ev2(`(() => { const p = document.querySelector('.doc-peek'); return p ? { name: (p.querySelector('.docr-name') || {}).textContent, md: !!p.querySelector('.docr-md') } : null; })()`));
await ev2(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
process.exit(0);
