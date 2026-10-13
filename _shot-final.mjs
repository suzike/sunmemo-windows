'use strict';
// Final rope shot for v1.7.1 acceptance.
import { execSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
const E = String.fromCharCode(92);
const APP = ['E:', 'Agentic_Engineering', 'ZCode', 'sunidea'].join(E);
const DOCS = APP + E + '_docs';
const SHOTS = APP + E + '_shots';
const t = async () => (await (await fetch('http://127.0.0.1:9222/json/list')).json()).filter(x => x.type === 'page');
const lt = (await t()).find(x => x.url.includes('line.html'));
const ws = new WebSocket(lt.webSocketDebuggerUrl);
await new Promise(r => { ws.onopen = r; });
let i = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const call = (m, p = {}) => new Promise(res => { const id = ++i; pend.set(id, res); ws.send(JSON.stringify({ id, method: m, params: p })); });
const ev = async x => { const r = await call('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true }); return r.result && r.result.result && r.result.result.value; };
await call('Runtime.enable');
let rev = await ev(`document.getElementById('stage').classList.contains('revealed')`);
if (!rev) { await ev(`window.sun.send('line:toggle-userpin')`); await sleep(800); }
for (const n of ['项目方案.md', '设计说明.pdf']) {
  await ev(`window.sun.send('line:drop-file', ${JSON.stringify(DOCS + E + n)})`);
  await sleep(500);
}
await sleep(1500);
execSync(`powershell -NoProfile -Command "Add-Type -AssemblyName System.Drawing; $b = New-Object System.Drawing.Bitmap(2560, 430); $g = [System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen(0, 0, 0, 0, $b.Size); $b.Save('${SHOTS + E}v171-final-rope.png'); $g.Dispose(); $b.Dispose()"`, { stdio: 'ignore' });
console.log('final rope shot saved');
process.exit(0);
