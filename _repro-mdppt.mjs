'use strict';
// Repro "悬停 MD 却出现 PPT 面板": hang md + ppt, hover the MD card, inspect peek.
import { execSync } from 'node:child_process';
import fs from 'node:fs';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const E = String.fromCharCode(92);
const APP = ['E:', 'Agentic_Engineering', 'ZCode', 'sunidea'].join(E);
const DOCS = APP + E + '_docs';
fs.writeFileSync(DOCS + E + '演示.ppt', Buffer.from([0x50, 0x4b, 0x03, 0x04])); // 占位字节，仅扩展名参与判型
execSync('python _gen-docs.py', { cwd: APP, stdio: 'ignore' });

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
if (!rev) { await ev(`window.sun.send('line:toggle-userpin')`); await sleep(700); }
await ev(`window.sun.send('line:drop-file', ${JSON.stringify(DOCS + E + '项目方案.md')})`);
await sleep(700);
await ev(`window.sun.send('line:drop-file', ${JSON.stringify(DOCS + E + '演示.ppt')})`);
await sleep(1500);
console.log('cards:', await ev(`[...document.querySelectorAll('.card.doc .doc-name')].map(n => n.textContent).join(', ')`));
// 悬停 MD 卡
await ev(`(() => { const f = [...document.querySelectorAll('.slot')].find(x => { const n = x.querySelector('.doc-name'); return n && n.textContent.indexOf('.md') >= 0; }); if (f) f.querySelector('.doc-face').dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); return 1; })()`);
await sleep(2600);
const ov = (await t()).find(x => x.url.includes('overlay.html'));
const ws2 = new WebSocket(ov.webSocketDebuggerUrl);
await new Promise(r => { ws2.onopen = r; });
let j = 0; const pend2 = new Map();
ws2.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend2.has(m.id)) { pend2.get(m.id)(m); pend2.delete(m.id); } };
const call2 = (m, p = {}) => new Promise(res => { const id = ++j; pend2.set(id, res); ws2.send(JSON.stringify({ id, method: m, params: p })); });
const ev2 = async x => { const r = await call2('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return 'EXC ' + String(r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 160); return JSON.stringify(r.result && r.result.result && r.result.result.value); };
await call2('Runtime.enable');
console.log('panels:', await ev2(`document.querySelectorAll('.doc-peek').length`));
console.log('peek:', await ev2(`(() => { const p = document.querySelector('.doc-peek'); if (!p) return null; return { name: (p.querySelector('.docr-name') || {}).textContent || '', md: !!p.querySelector('.docr-md'), info: !!p.querySelector('.docr-info') }; })()`));
process.exit(0);
