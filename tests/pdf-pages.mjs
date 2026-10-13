'use strict';
// ① 30 页 PDF 大图阅读：滚动到底 → 末页已渲染（全量可读）
// ② 打开耗时：peek 首帧到 md 内容出现的粗测
// ③ 便签 draggable + dragstart 文本拖出布线
import { setTimeout as sleep } from 'node:timers/promises';
const E = String.fromCharCode(92);
const APP = ['E:', 'Agentic_Engineering', 'ZCode', 'sunidea'].join(E);
const DOCS = APP + E + '_docs';
let pass = 0, fail = 0;
const chk = (n, c, x = '') => { (c ? pass++ : fail++); console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  <<< ' + x)); };

const t = async () => (await (await fetch('http://127.0.0.1:9222/json/list')).json()).filter(x => x.type === 'page');
const find = async (part, ms = 8000) => { const e = Date.now() + ms; while (Date.now() < e) { const x = (await t().catch(() => [])).filter(y => y.url.includes(part)).pop(); if (x) return x; await sleep(250); } return null; };
const conn = async t2 => {
  const ws = new WebSocket(t2.webSocketDebuggerUrl);
  await new Promise(r => { ws.onopen = r; });
  let i = 0; const pend = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const call = (m, p = {}) => new Promise(res => { const id = ++i; pend.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })); });
  const ev = async x => { const r = await call('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return 'EXC ' + String(r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 150); return r.result && r.result.result && r.result.result.value; };
  await call('Runtime.enable');
  return { call, ev };
};

const line = await conn(await find('line.html'));
let rev = await line.ev(`document.getElementById('stage').classList.contains('revealed')`);
if (!rev) { await line.ev(`window.sun.send('line:toggle-userpin')`); await sleep(800); }
await line.ev(`window.sun.send('line:drop-file', ${JSON.stringify(DOCS + E + '30页长文.pdf')})`);
await line.ev(`window.sun.send('line:drop-file', ${JSON.stringify(DOCS + E + '项目方案.md')})`);
await sleep(1500);

// ③ 便签 draggable 布线
const dragWire = await line.ev(`(() => {
  const f = document.querySelector('.memo-face');
  if (!f) return null;
  return { draggable: f.draggable === true };
})()`);
chk('便签 face 默认 draggable', !!dragWire && dragWire.draggable === true);

// 悬停 PDF 卡 → peek（5 页速览）
await line.ev(`(() => { const f = [...document.querySelectorAll('.slot')].find(x => { const n = x.querySelector('.doc-name'); return n && n.textContent.indexOf('30页') >= 0; }); if (f) f.querySelector('.doc-face').dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); return !!f; })()`);
await sleep(2400);
const ov = await conn(await find('overlay.html'));
const peekInfo = await ov.ev(`(() => { const p = document.querySelector('.doc-peek'); if (!p) return null; return { pages: p.querySelectorAll('.docr-pdf-page').length, foot: (p.querySelector('.docr-pdf-foot') || {}).textContent || '' }; })()`);
chk('悬停速览 5 页 + 全部提示', !!peekInfo && peekInfo.pages === 5 && peekInfo.foot.indexOf('30') >= 0, JSON.stringify(peekInfo));

// 大图阅读 → 全部页
await ov.ev(`(() => { const b = document.querySelector('.doc-peek [data-pk="preview"]'); if (b) b.click(); return !!b; })()`);
await sleep(1800);
let hero = await ov.ev(`(() => { const h = document.getElementById('heroCard'); const total = h.querySelectorAll('.docr-pdf-page').length; const done = h.querySelectorAll('.docr-pdf-page canvas').length; return { total, done }; })()`);
chk('大图阅读创建全部 30 页占位', !!hero && hero.total === 30, JSON.stringify(hero));
chk('懒渲染：未滚动时只渲染首屏少数页', !!hero && hero.done < 8, JSON.stringify(hero && hero.done));

// 滚动到底 → 末页渲染
const scrollRes = await ov.ev(`(async () => {
  const body = document.querySelector('#heroCard .docr-body') || document.querySelector('#heroCard .hero-doc-host');
  if (!body) return 'no body';
  const scroller = body.scrollHeight > body.clientHeight ? body : (body.querySelector('.docr-body') || body);
  scroller.scrollTop = scroller.scrollHeight;
  await new Promise(r => setTimeout(r, 2500));
  scroller.scrollTop = scroller.scrollHeight;
  await new Promise(r => setTimeout(r, 2500));
  const h = document.getElementById('heroCard');
  const wraps = [...h.querySelectorAll('.docr-pdf-page')];
  return { canvases: h.querySelectorAll('.docr-pdf-page canvas').length, lastRendered: !!wraps[wraps.length - 1].querySelector('canvas'), scrollH: scroller.scrollHeight };
})()`);
console.log('scroll result:', JSON.stringify(scrollRes));
chk('滚动到底后末页已渲染（全量可读）', !!scrollRes && scrollRes.lastRendered === true && scrollRes.canvases >= 5, JSON.stringify(scrollRes));

await ov.ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);

console.log(`PDF-PAGES RESULT: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
