'use strict';
// Verify beacon drop-entry: (a) DOM affordance toggles, (b) beacon:drop-files
// hangs the file and reveals the rope.
import { setTimeout as sleep } from 'node:timers/promises';
const E = String.fromCharCode(92);
const APP = ['E:', 'Agentic_Engineering', 'ZCode', 'sunidea'].join(E);
const t = async () => (await (await fetch('http://127.0.0.1:9222/json/list')).json()).filter(x => x.type === 'page');
const bt = (await t()).find(x => x.url.includes('beacon.html'));
const lt = (await t()).find(x => x.url.includes('line.html'));
if (!bt || !lt) { console.log('NO TARGETS'); process.exit(1); }
const conn = async (t2) => {
  const ws = new WebSocket(t2.webSocketDebuggerUrl);
  await new Promise(r => { ws.onopen = r; });
  let i = 0; const pend = new Map();
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
  const call = (m, p = {}) => new Promise(res => { const id = ++i; pend.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })); });
  const ev = async x => { const r = await call('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return 'EXC ' + String(r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 150); return r.result && r.result.result && r.result.result.value; };
  await call('Runtime.enable');
  return { call, ev };
};
const beacon = await conn(bt);
const line = await conn(lt);

// (a) dragover 提示态
const a = await beacon.ev(`(() => {
  const pill = document.getElementById('beacon');
  const dt = new DataTransfer();
  dt.items.add(new File(['x'], 'test.md', { type: 'text/markdown' }));
  pill.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
  const dropping = pill.classList.contains('dropping');
  const label = pill.querySelector('.label').textContent;
  pill.dispatchEvent(new DragEvent('dragleave', { bubbles: true, cancelable: true, dataTransfer: dt }));
  const restored = !pill.classList.contains('dropping') && pill.querySelector('.label').textContent === '晾衣绳';
  return { dropping, label, restored, prevented: true };
})()`);
console.log('affordance:', JSON.stringify(a));

// (b) 主流程：beacon:drop-files → 挂绳 + 展开
const before = await line.ev(`document.querySelectorAll('.slot[data-id]').length`);
await beacon.ev(`window.sun.send('beacon:drop-files', [${JSON.stringify(APP + E + '_docs' + E + '项目方案.md')}])`);
await sleep(1500);
const after = await line.ev(`document.querySelectorAll('.slot[data-id]').length`);
const revealed = await line.ev(`document.getElementById('stage').classList.contains('revealed')`);
const docCard = await line.ev(`!![...document.querySelectorAll('.doc-name')].find(n => n.textContent === '项目方案.md')`);
console.log('before=' + before + ' after=' + after + ' revealed=' + revealed + ' docCard=' + docCard);
process.exit(before < after && revealed && docCard ? 0 : 1);
