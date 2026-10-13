'use strict';
// 收回修复验证：提交便签（hangMemoFlight → 展开）后真光标停在远处不动，
// 绳必须在 ~3.2s 内自动收回（2.5s peek + 0.5s RETRACT_DELAY + tick 采样）。
// 连测 3 轮 + 鼠标进入绳带保持的回归项。
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
const ev = async x => { const r = await call('Runtime.evaluate', { expression: x, returnByValue: true }); return r.result && r.result.result && r.result.result.value; };
await call('Runtime.enable');
const revealed = () => ev(`document.getElementById('stage').classList.contains('revealed')`);
const park = () => execSync(`powershell -NoProfile -Command "& '${APP + E}scripts-input-abs.ps1' -x 1280 -y 1300"`, { stdio: 'ignore' });

let pass = 0, fail = 0;
const chk = (n, c, x = '') => { (c ? pass++ : fail++); console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  <<< ' + x)); };

for (let round = 1; round <= 3; round++) {
  // 保证起始收起：若开着，等它收（或直接等 tick）
  for (let k = 0; k < 20 && (await revealed()); k++) await sleep(400);
  park();
  await sleep(400);
  const t0 = Date.now();
  await ev(`window.sun.send('memo:save', { text: '收回验证 ${round}', color: 'yellow', aspectRatio: 'wide' })`);
  let sawOpen = false, closedAt = -1;
  while (Date.now() - t0 < 8000) {
    const open = await revealed();
    if (open) sawOpen = true;
    if (sawOpen && !open) { closedAt = Date.now() - t0; break; }
    await sleep(250);
  }
  chk(`第${round}轮：提交后展开且鼠标远处不动时自动收回`, sawOpen && closedAt >= 0 && closedAt < 4200,
    `sawOpen=${sawOpen} closedAt=${closedAt}ms`);
  await sleep(600);
}

// 回归：鼠标进入绳带期间保持展开，移开后收回
park();
await sleep(500);
await ev(`window.sun.send('memo:save', { text: '保持回归', color: 'green', aspectRatio: 'wide' })`);
await sleep(1200);
execSync(`powershell -NoProfile -Command "& '${APP + E}scripts-input-abs.ps1' -x 1280 -y 120"`, { stdio: 'ignore' }); // 进绳带
await sleep(2500);
const stillOpen = await revealed();
execSync(`powershell -NoProfile -Command "& '${APP + E}scripts-input-abs.ps1' -x 1280 -y 1300"`, { stdio: 'ignore' }); // 移走
let retracted = false;
const t1 = Date.now();
while (Date.now() - t1 < 5000) { if (!(await revealed())) { retracted = true; break; } await sleep(250); }
chk('回归：光标在绳带内保持展开，移走后收回', stillOpen && retracted, `stillOpen=${stillOpen} retracted=${retracted}`);

console.log(`RETRACT RESULT: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
