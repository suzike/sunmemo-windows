'use strict';
// v1.6 三功能冒烟：文档卡上绳 → 悬停弹出阅读 → 滚动平移 → 速记窗拖文本
// 素材自愈：门禁产物可能被中途清理，先重建再跑
import { execSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
execSync('python tests/gen-docs.py && python tests/gen-docx.py', { cwd: process.cwd(), stdio: 'ignore' });
const E = String.fromCharCode(92);
const APP = ['E:', 'Agentic_Engineering', 'ZCode', 'sunidea'].join(E);
const DOCS = APP + E + '_docs';
let pass = 0, fail = 0;
const chk = (n, c, x = '') => { (c ? pass++ : fail++); console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  <<< ' + x)); };

const targets = async () => (await (await fetch('http://127.0.0.1:9222/json/list')).json()).filter(t => t.type === 'page');
const find = async (part, ms = 8000) => { const e = Date.now() + ms; while (Date.now() < e) { const t = (await targets().catch(() => [])).filter(x => x.url.includes(part)).pop(); if (t) return t; await sleep(250); } return null; };
const conn = async (t) => {
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise(r => { ws.onopen = r; });
  let mid = 0; const pend = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const call = (method, params = {}) => new Promise(res => { const id = ++mid; pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async expr => { const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 150)); return r.result && r.result.result && r.result.result.value; };
  return { ws, call, ev };
};

// 展开绳
const lineT = await find('line.html');
if (!lineT) { console.log('NO LINE'); process.exit(1); }
const line = await conn(lineT);
await line.call('Runtime.enable');
let revealed = await line.ev(`document.getElementById('stage').classList.contains('revealed')`);
if (!revealed) { await line.ev(`window.sun.send('line:toggle-userpin')`); await sleep(800); }

// ---- ① 文档卡上绳 ----
const before = await line.ev(`document.querySelectorAll('.slot[data-id]').length`);
await line.ev(`window.sun.send('line:drop-file', ${JSON.stringify(DOCS + E + '项目方案.md')})`);
await sleep(900);
const doc1 = await line.ev(`(() => { const n = [...document.querySelectorAll('.doc-name')].find(n => n.textContent === '项目方案.md'); if (!n) return null; const c = n.closest('.card'); return { name: n.textContent, chip: c.querySelector('.doc-chip') && c.querySelector('.doc-chip').textContent }; })()`);
chk('md 上绳成文档卡', !!doc1 && doc1.name === '项目方案.md' && doc1.chip === 'MD', JSON.stringify(doc1));
await line.ev(`window.sun.send('line:drop-file', ${JSON.stringify(DOCS + E + '设计说明.pdf')})`);
await line.ev(`window.sun.send('line:drop-file', ${JSON.stringify(DOCS + E + '会议纪要.docx')})`);
let pdfReady = false;
for (let i = 0; i < 20 && !pdfReady; i++) {
  pdfReady = await line.ev(`(() => { const cv = document.querySelector('.doc-page1'); return cv ? cv.classList.contains('ready') : false; })()`);
  if (!pdfReady) await sleep(450);
}
chk('pdf 卡第 1 页缩略渲染', !!pdfReady);

// ---- ② 悬停弹出阅读（合成 mouseover，320ms 驻留后 overlay 弹面板；按名字选卡）----
await line.ev(`(() => { const s = [...document.querySelectorAll('.slot')].find(x => { const n = x.querySelector('.doc-name'); return n && n.textContent === '项目方案.md'; }); if (!s) return false; s.querySelector('.doc-face').dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); return true; })()`);
await sleep(1400);
const peek = await find('overlay.html', 4000);
let peekOk = null;
if (peek) {
  const ov = await conn(peek);
  await ov.call('Runtime.enable');
  for (let i = 0; i < 20 && !peekOk; i++) {
    peekOk = await ov.ev(`(() => { const p = document.querySelector('.doc-peek'); if (!p) return null; const md = p.querySelector('.docr-md'); return { in: p.classList.contains('in'), name: (p.querySelector('.docr-name') || {}).textContent || '', rich: md ? (md.dataset.rich === '1') : false, kids: md ? md.children.length : 0 }; })()`).catch(e => 'ERR ' + e.message);
    if (!peekOk) await sleep(400);
  }
  chk('悬停文档卡 → overlay 弹出阅读面板', !!peekOk && typeof peekOk === 'object' && peekOk.in && peekOk.name === '项目方案.md' && peekOk.kids > 0, JSON.stringify(peekOk));
  const mdHtml = await ov.ev(`(() => { const b = document.querySelector('.doc-peek .docr-md'); return b ? { h1: !!b.querySelector('h1'), h2: !!b.querySelector('h2'), list: !!b.querySelector('ul,li'), quote: !!b.querySelector('blockquote'), strong: !!b.querySelector('strong') } : null; })()`);
  chk('marked 富排版渲染(标题/列表/引用/加粗)', !!mdHtml && mdHtml.h1 && mdHtml.h2 && mdHtml.list && mdHtml.quote && mdHtml.strong, JSON.stringify(mdHtml));
  // Esc 关闭
  await ov.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await sleep(500);
  const gone = await ov.ev(`!document.querySelector('.doc-peek')`);
  chk('Esc 关闭阅读面板', !!gone);
} else chk('悬停文档卡 → overlay 弹出阅读面板', false, 'no overlay target');

// ---- ③ 滚动：再挂几张文档触发溢出 → 滚轮平移 ----
for (let k = 0; k < 3; k++) {
  const p = DOCS + E + '项目方案.md';
  await line.ev(`window.sun.send('line:drop-file', ${JSON.stringify(p)})`).catch(() => {});
}
// 重复文件不会重复挂——改用多挂几个不同文档（复制几份）
for (const n of ['副本一.md', '副本二.md', '副本三.md', '副本四.md']) {
  fs.copyFileSync(DOCS + E + '项目方案.md', DOCS + E + n);
  await line.ev(`window.sun.send('line:drop-file', ${JSON.stringify(DOCS + E + n)})`);
  await sleep(220);
}
await sleep(1200);
const sc0 = await line.ev(`(() => { const c = document.getElementById('cards'); return { tf: c.style.transform, bar: !!document.getElementById('scrollBar') }; })()`);
await line.ev(`window.dispatchEvent(new WheelEvent('wheel', { deltaY: 480, bubbles: true, cancelable: true }))`);
await sleep(500);
const sc1 = await line.ev(`(() => { const c = document.getElementById('cards'); return { tf: c.style.transform, l: document.getElementById('scrollPrev') && document.getElementById('scrollPrev').classList.contains('show'), bar: document.getElementById('scrollBar') && document.getElementById('scrollBar').classList.contains('show') }; })()`);
chk('溢出后滚轮平移绳', sc0.tf !== sc1.tf && sc1.tf.includes('-'), JSON.stringify({ sc0, sc1 }));
chk('行程条与左端箭头出现（已滚至最右）', !!sc1.l && !!sc1.bar);
// 拖拽平移：先滚回最左（避免新卡自动滚入后取样点落在卡片上）
await line.call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 850, y: 60, deltaX: 0, deltaY: -9000 });
await sleep(600);
const drag = await line.ev(`(() => { const b = document.getElementById('scrollBar').getBoundingClientRect(); return { x: Math.round(b.left + b.width / 2), y: Math.round(40) }; })()`);
await line.ev(`(function(){ const cards = document.getElementById('cards'); const r = cards.getBoundingClientRect(); const ev0 = new MouseEvent('mousedown', { bubbles: true, clientX: ${drag.x}, clientY: r.top + 150, screenX: ${drag.x}, screenY: 100, button: 0 }); (document.elementFromPoint(${drag.x}, r.top + 150) || cards).dispatchEvent(ev0); return true; })()`);
await sleep(120);
for (const dx of [40, 80, 120]) {
  await line.ev(`window.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: ${drag.x + dx}, clientY: 200, screenX: ${drag.x + dx}, screenY: 100, buttons: 1 }))`);
  await sleep(60);
}
await line.ev(`window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: ${drag.x + 120}, clientY: 200, screenX: ${drag.x + 120}, screenY: 100 }))`);
await sleep(300);
const sc2 = await line.ev(`document.getElementById('cards').style.transform`);
chk('空绳区拖拽平移', sc1.tf !== sc2, sc1.tf + ' → ' + sc2);

// ---- ④ 速记窗拖文本直插 ----
await line.ev(`window.sun.send('line:open-editor', null)`);
const memoT = await find('memo.html', 6000);
if (memoT) {
  const memo = await conn(memoT);
  await memo.call('Runtime.enable');
  await sleep(700);
  const r = await memo.ev(`(async () => {
    const ed = document.getElementById('editor');
    const dt = new DataTransfer();
    dt.setData('text/plain', '拖进来的文本内容 ABC123');
    const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
    document.dispatchEvent(drop);
    await new Promise(r2 => setTimeout(r2, 300));
    return ed.value.includes('拖进来的文本内容 ABC123');
  })()`);
  chk('速记窗拖文本 → 直接粘内容', !!r);
  await memo.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
} else chk('速记窗拖文本 → 直接粘内容', false, 'no memo window');

console.log(`SMOKE RESULT: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
