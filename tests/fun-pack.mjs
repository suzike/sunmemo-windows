'use strict';
// v1.7 验证：归档→回忆板有周有卡→点击恢复上绳；全完成→小鸟+太阳种子。
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
const E = String.fromCharCode(92);
const t = async () => (await (await fetch('http://127.0.0.1:9222/json/list')).json()).filter(x => x.type === 'page');
const lt = (await t()).find(x => x.url.includes('line.html'));
const ws = new WebSocket(lt.webSocketDebuggerUrl);
await new Promise(r => { ws.onopen = r; });
let i = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const call = (m, p = {}) => new Promise(res => { const id = ++i; pend.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })); });
const ev = async x => { const r = await call('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return 'EXC ' + String(r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 140); return r.result && r.result.result && r.result.result.value; };
await call('Runtime.enable');
let pass = 0, fail = 0;
const chk = (n, c, x = '') => { (c ? pass++ : fail++); console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  <<< ' + x)); };

// ① 建一张带待办的便签 → 撕下（进归档）
await ev(`window.sun.send('memo:save', { text: '回忆验证便签\\n- [ ] 归档测试项', color: 'pink', aspectRatio: 'wide' })`);
await sleep(1600);
const torn = await ev(`(() => { const f = [...document.querySelectorAll('.slot .memo-face')].find(f => f.textContent.includes('回忆验证便签')); if (!f) return null; const id = f.closest('.slot').dataset.id; window.sun.send('line:discard', id); return id; })()`);
await sleep(1200);
chk('撕下便签进归档', !!torn);

// ② 打开回忆板：应有 1 周 ≥1 卡
await ev(`window.sun.send('line:memory')`);
await sleep(2000);
const ov = (await t()).find(x => x.url.includes('overlay.html'));
const ws2 = new WebSocket(ov.webSocketDebuggerUrl);
await new Promise(r => { ws2.onopen = r; });
let j = 0; const pend2 = new Map();
ws2.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend2.has(m.id)) { pend2.get(m.id)(m); pend2.delete(m.id); } };
const call2 = (m, p = {}) => new Promise(res => { const id = ++j; pend2.set(id, res); ws2.send(JSON.stringify({ id, method: m, params: p })); });
const ev2 = async x => { const r = await call2('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) return 'EXC ' + String(r.exceptionDetails.exception && r.exceptionDetails.exception.description || '').slice(0, 140); return r.result && r.result.result && r.result.result.value; };
await call2('Runtime.enable');
const board = await ev2(`(() => { const m = document.querySelector('.memory-board'); return m ? { weeks: m.querySelectorAll('.mem-week').length, cards: m.querySelectorAll('.mem-card').length, firstText: (m.querySelector('.mem-text') || {}).textContent || '' } : null; })()`);
chk('回忆板有周有卡', !!board && board.weeks >= 1 && board.cards >= 1 && board.firstText.includes('回忆验证便签'), JSON.stringify(board));

// ③ 点击卡片 → 恢复上绳
await ev2(`(() => { const c = document.querySelector('.mem-card'); if (c) c.click(); return !!c; })()`);
await sleep(1500);
const restored = await ev(`(() => { const f = [...document.querySelectorAll('.slot .memo-face')].find(f => f.textContent.includes('回忆验证便签')); return !!f; })()`);
chk('点击回忆卡恢复上绳', !!restored);
await ev2(`(() => { const m = document.querySelector('.memory-board'); if (m) { m.remove(); } return 1; })()`);
await ev(`window.sun.send('memory:close')`);

// ④ 全完成 → 小鸟 + 太阳种子
await ev(`window.sun.send('memo:save', { text: '小鸟种子验证\\n- [ ] 唯一待办', color: 'blue', aspectRatio: 'wide' })`);
await sleep(1500);
await ev(`(() => { let n = 0; document.querySelectorAll('.slot .md-box:not(.checked)').forEach(b => { b.click(); n++; }); return n; })()`);
await sleep(3200);
const birdSeed = await ev(`({ bird: !!document.getElementById('ropeBird'), seed: !!document.getElementById('ropeSeed') })`);
const cfg = JSON.parse(fs.readFileSync(process.env.APPDATA + E + 'SunMemo' + E + 'config.json', 'utf8'));
chk('全完成 → 小鸟现身', birdSeed.bird === true, JSON.stringify(birdSeed));
chk('太阳种子挂绳尾并当日持久', birdSeed.seed === true && cfg.settings.sunSeedDate === new Date().toISOString().slice(0, 10), JSON.stringify({ birdSeed, seedDate: cfg.settings.sunSeedDate }));

console.log(`V17 RESULT: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
