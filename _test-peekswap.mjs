'use strict';
// Deterministic: hover ppt → ppt peek; Esc; hover md → md peek.
import { execSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
const E = String.fromCharCode(92);
const APP = ['E:', 'Agentic_Engineering', 'ZCode', 'sunidea'].join(E);
const DOCS = APP + E + '_docs';
const t = async () => (await (await fetch('http://127.0.0.1:9222/json/list')).json()).filter(x => x.type === 'page');
const find = async (part, ms = 8000) => { const e = Date.now() + ms; while (Date.now() < e) { const x = (await t().catch(() => [])).filter(y => y.url.includes(part)).pop(); if (x) return x; await sleep(250); } return null; };
const conn = async t2 => {
  const ws = new WebSocket(t2.webSocketDebuggerUrl);
  await new Promise(r => { ws.onopen = r; });
  let i = 0; const pend = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const call = (m, p = {}) => new Promise(res => { const id = ++i; pend.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })); });
  const ev = async x => { const r = await call('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return 'EXC ' + String(r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 140); return r.result && r.result.result && r.result.result.value; };
  await call('Runtime.enable');
  return { call, ev };
};
const line = await conn(await find('line.html'));
let rev = await line.ev(`document.getElementById('stage').classList.contains('revealed')`);
if (!rev) { await line.ev(`window.sun.send('line:toggle-userpin')`); await sleep(800); }
for (const n of ['项目方案.md', '演示.ppt']) {
  await line.ev(`window.sun.send('line:drop-file', ${JSON.stringify(DOCS + E + n)})`);
  await sleep(600);
}
await sleep(1200);
const ov = await conn(await find('overlay.html'));

const hoverBy = async (needle) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    await line.ev(`(() => { const f = [...document.querySelectorAll('.slot')].find(x => { const n = x.querySelector('.doc-name'); return n && n.textContent.indexOf(${JSON.stringify(needle)}) >= 0; }); if (f) f.querySelector('.doc-face').dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); return !!f; })()`);
    await sleep(3200);
    const r = await ov.ev(`(() => { const p = document.querySelector('.doc-peek'); if (!p) return null; const b = p.querySelector('.docr-body'); return { name: (p.querySelector('.docr-name') || {}).textContent || '', pptPages: p.querySelectorAll('.docr-ppt-page').length, md: !!p.querySelector('.docr-md'), info: !!p.querySelector('.docr-info'), bodyKids: b ? b.children.length : -1 }; })()`);
    if (r) return r;
    await ov.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await sleep(700);
  }
  return null;
};
// 先 Esc 清场（若有残留面板）
await ov.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
await sleep(500);

const pptPeek = await hoverBy('.ppt');
console.log('ppt peek:', JSON.stringify(pptPeek));
await ov.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
await sleep(600);
const mdPeek = await hoverBy('.md');
console.log('md peek:', JSON.stringify(mdPeek));

const ok1 = !!pptPeek && (pptPeek.pptPages > 0 || pptPeek.info);
const ok2 = !!mdPeek && mdPeek.name === '项目方案.md' && mdPeek.md === true;
console.log('RESULT:', ok1 && ok2 ? 'PASS' : 'FAIL');
process.exit(ok1 && ok2 ? 0 : 1);
