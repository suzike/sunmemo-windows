'use strict';
// v1.7.1 收回终验：① 光标停在副屏（负 y）绳应收回；② 便签横向拖 = 平移（绕过 dnd 验证管线）
import { execSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
const E = String.fromCharCode(92);
const APP = ['E:', 'Agentic_Engineering', 'ZCode', 'sunidea'].join(E);
const PS = c => execSync(`powershell -NoProfile -Command "${c}"`, { stdio: 'ignore' });
let pass = 0, fail = 0;
const chk = (n, c, x = '') => { (c ? pass++ : fail++); console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  <<< ' + x)); };
const t = async () => (await (await fetch('http://127.0.0.1:9222/json/list')).json()).filter(x => x.type === 'page');
const lt = (await t()).find(x => x.url.includes('line.html'));
const ws = new WebSocket(lt.webSocketDebuggerUrl);
await new Promise(r => { ws.onopen = r; });
let i = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const call = (m, p = {}) => new Promise(res => { const id = ++i; pend.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })); });
const ev = async x => { const r = await call('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return 'EXC ' + String(r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 120); return r.result && r.result.result && r.result.result.value; };
await call('Runtime.enable');
const revealed = () => ev(`document.getElementById('stage').classList.contains('revealed')`);

// ① 副屏收回：提交便签展开（2.5s peek）→ 真光标停副屏 (1280, -700) → 应收回
PS(`& '${APP + E}scripts-input.ps1' -x 1280 -y -700 -moveonly`);
await sleep(500);
await ev(`window.sun.send('memo:save', { text: '副屏收回验证', color: 'yellow', aspectRatio: 'wide' })`);
let sawOpen = false, closedAt = -1;
const t0 = Date.now();
while (Date.now() - t0 < 9000) {
  const open = await revealed();
  if (open) sawOpen = true;
  if (sawOpen && !open) { closedAt = Date.now() - t0; break; }
  await sleep(250);
}
chk('鼠标停副屏（上方显示器）绳自动收回', sawOpen && closedAt >= 0 && closedAt < 5000, `sawOpen=${sawOpen} closedAt=${closedAt}ms`);

// ② 便签横向拖平移（face draggable 暂关以绕过 CDP 的 dnd 差异，验证平移管线本身）
await ev(`window.sun.send('line:toggle-userpin')`); // 钉住便于操作
await sleep(700);
const dr = await ev(`(() => { const f = [...document.querySelectorAll('.slot .memo-face')][0]; if (!f) return null; const r = f.getBoundingClientRect(); f.draggable = false; return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
const tf0 = await ev(`document.getElementById('cards').style.transform || 'none'`);
await call('Input.dispatchMouseEvent', { type: 'mousePressed', x: dr.x, y: dr.y, button: 'left', clickCount: 1 });
for (const dx of [6, 16, 28, 40]) {
  await call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: dr.x + dx, y: dr.y, button: 'left', buttons: 1 });
  await sleep(70);
}
await call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: dr.x + 40, y: dr.y, button: 'left', clickCount: 1 });
await sleep(400);
const tf1 = await ev(`document.getElementById('cards').style.transform || 'none'`);
await ev(`(() => { const f = document.querySelector('.memo-face'); if (f) f.draggable = true; return 1; })()`);
chk('便签横向拖 = 绳平移（管线验证）', tf0 !== tf1, `tf0=${tf0} tf1=${tf1}`);

console.log(`RETRACT-V2 RESULT: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
