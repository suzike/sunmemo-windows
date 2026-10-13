'use strict';
// R209 live gate on a fresh --demo instance:
//  A) real-OS-cursor hover → photo zooms 3x (CDP assert) + true-composite shots
//  B) image → 移到回收站 end-to-end (DOM + disk + Recycle Bin)
import { execSync } from 'node:child_process';
import fs from 'node:fs';
const E = String.fromCharCode(92);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const APP = ['E:', 'Agentic_Engineering', 'ZCode', 'sunidea'].join(E);
const SHOTS = APP + E + '_shots';
const PS = (c) => execSync(`powershell -NoProfile -Command "${c}"`, { stdio: 'ignore' });
const PSOUT = (c) => execSync(`powershell -NoProfile -Command "${c}"`, { encoding: 'utf8' });

let pass = 0, fail = 0;
const chk = (n, c, x = '') => { c ? pass++ : fail++; console.log((c ? 'PASS ' : 'FAIL ') + n + (c ? '' : '  <<< ' + x)); };

const targets = async () => (await (await fetch('http://127.0.0.1:9222/json/list')).json()).filter(t => t.type === 'page');
const lineT = (await targets()).find(t => t.url.includes('line.html'));
if (!lineT) { console.log('NO LINE'); process.exit(1); }
const ws = new WebSocket(lineT.webSocketDebuggerUrl);
await new Promise(r => { ws.onopen = r; });
let mid = 0; const pend = new Map();
ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const call = (method, params = {}) => new Promise(res => { const id = ++mid; pend.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const ev = async expr => { const r = await call('Runtime.evaluate', { expression: expr, returnByValue: true }); return r.result && r.result.result && r.result.result.value; };
await call('Runtime.enable');

// 冷启动 demo 有 ~20s 展示宽限期，revealed 可能为 true——不能按 revealed
// 条件钉住（宽限期过后绳会收回、窗口 ignoreMouse，真光标全部失效）。
// 学 E2E：全新实例必然未钉，盲钉一次 + 光标先落进绳带。
await ev(`window.sun.send('line:toggle-userpin')`);
let revealed = false;
for (let i = 0; i < 10 && !revealed; i++) { revealed = await ev(`document.getElementById('stage').classList.contains('revealed')`); if (!revealed) await sleep(300); }
chk('钉住展开', !!revealed);
PS(`& '${APP + E + 'scripts-input.ps1'}' -x 1290 -y 210 -moveonly`);
await sleep(500);
let photos = 0;
for (let i = 0; i < 20; i++) { photos = await ev(`document.querySelectorAll('.slot .photo-clip').length`); if (photos >= 1) break; await sleep(400); }
chk('种子含图片卡', photos >= 1, 'photos=' + photos);

// ---- A. 真光标悬停放大 ----
// 移入卡心必须走输入队列（mouse_event ABSOLUTE 滑动）——SetCursorPos 瞬移在
// @150% 屏上会让 Chromium 收到未缩放坐标，命中 stage 而非卡片（测试伪影）。
const pt = await ev(`(() => { const s = [...document.querySelectorAll('.slot')].find(x => x.querySelector('.photo-clip')); const r = s.querySelector('.photo-clip').getBoundingClientRect(); return { x: Math.round((r.left + r.width / 2) * devicePixelRatio), y: Math.round((r.top + r.height / 2) * devicePixelRatio) }; })()`);
const thumbOk = await ev(`(() => { const im = document.querySelector('.photo-clip img'); return im ? im.naturalWidth > 0 : false; })()`);
chk('种子图片 thumb 正常渲染', !!thumbOk);
PS(`& '${APP + E + 'scripts-input-abs.ps1'}' -x ${pt.x} -y ${pt.y}`);
await sleep(750);
const hov = await ev(`(() => { const s = [...document.querySelectorAll('.slot')].find(x => x.querySelector('.photo-clip')); const m = getComputedStyle(s.querySelector('.photo-clip')).transform.match(/matrix\\(([-\\d.]+)/); return { hover: s.classList.contains('hover'), v: m ? parseFloat(m[1]) : null }; })()`);
chk('真光标悬停→图片放大3x', !!hov && hov.hover && hov.v !== null && hov.v >= 2.9, JSON.stringify(hov));

// 截图（物理坐标，卡周围 1000x680 区域）
const W = 1000, H = 680;
const X0 = Math.max(0, Math.min(pt.x - 500, 2560 - W));
const Y0 = Math.max(0, Math.min(pt.y - 300, 1600 - H));
const shot = (file) => PS(`Add-Type -AssemblyName System.Drawing; $b = New-Object System.Drawing.Bitmap(${W}, ${H}); $g = [System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen(${X0}, ${Y0}, 0, 0, $b.Size); $b.Save('${SHOTS + E + file}'); $g.Dispose(); $b.Dispose()`);
fs.mkdirSync(SHOTS, { recursive: true });
shot('r209-hover.png');
PS(`& '${APP + E + 'scripts-input-abs.ps1'}' -x 200 -y 1500`);
await sleep(850);
shot('r209-normal.png');
chk('悬停/常态截图已存', fs.existsSync(SHOTS + E + 'r209-hover.png') && fs.existsSync(SHOTS + E + 'r209-normal.png'));

// ---- B. 图片 → 回收站 端到端 ----
const tmp = process.env.TEMP + E + `sunmemo-r209-trash-${Date.now()}.png`;
PS(`Add-Type -AssemblyName System.Drawing; $b = New-Object System.Drawing.Bitmap(640, 420); $g = [System.Drawing.Graphics]::FromImage($b); $g.Clear([System.Drawing.Color]::SteelBlue); $g.FillEllipse([System.Drawing.Brushes]::Orange, 180, 110, 280, 200); $g.Dispose(); $b.Save('${tmp}'); $b.Dispose()`);
if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true }); // 确保测试从磁盘干净文件开始
PS(`Add-Type -AssemblyName System.Drawing; $b = New-Object System.Drawing.Bitmap(640, 420); $g = [System.Drawing.Graphics]::FromImage($b); $g.Clear([System.Drawing.Color]::SteelBlue); $g.FillEllipse([System.Drawing.Brushes]::Orange, 180, 110, 280, 200); $g.Dispose(); $b.Save('${tmp}'); $b.Dispose()`);
chk('测试图片已生成', fs.existsSync(tmp), tmp);

const beforeIds = await ev(`[...document.querySelectorAll('.slot[data-id]')].map(s => s.dataset.id)`);
await ev(`window.sun.send('line:drop-file', ${JSON.stringify(tmp)})`);
let newId = null;
for (let i = 0; i < 15 && !newId; i++) {
  const nowIds = await ev(`[...document.querySelectorAll('.slot[data-id]')].map(s => s.dataset.id)`);
  newId = (nowIds || []).find(id => !(beforeIds || []).includes(id)) || null;
  if (!newId) await sleep(400);
}
chk('拖入文件→新图片卡上线', !!newId, 'before=' + (beforeIds || []).length);

await ev(`window.sun.send('line:trash', ${JSON.stringify(newId)})`);
let domGone = false;
for (let i = 0; i < 12 && !domGone; i++) {
  domGone = await ev(`![...document.querySelectorAll('.slot[data-id]')].some(s => s.dataset.id === ${JSON.stringify(newId)})`);
  if (!domGone) await sleep(450);
}
chk('卡片从绳上消失', !!domGone);
let fileGone = false;
for (let i = 0; i < 10 && !fileGone; i++) { fileGone = !fs.existsSync(tmp); if (!fileGone) await sleep(450); }
chk('文件已离开原位置', fileGone);
let inBin = false;
for (let i = 0; i < 8 && !inBin; i++) {
  const names = PSOUT(`(New-Object -ComObject Shell.Application).NameSpace(10).Items() | ForEach-Object { $_.Name }`);
  inBin = String(names).split(/\r?\n/).some(n => n.includes('sunmemo-r209-trash'));
  if (!inBin) await sleep(500);
}
chk('文件已进入回收站', inBin);

// ---- C. 跨窗口烧录 + 重载后的 thumb 自愈 ----
// search:data 用 forceThumb 序列化全部图片（烧掉 line 频道一次性额度），
// 随后 reload line 页：get-state 拿到 null thumb → renderCardContent 触发
// line:thumb 自愈拉取 → src 应回到 dataURL。
const { spawn } = await import('node:child_process');
spawn(process.execPath, ['.', '--search'], { cwd: APP, detached: true, stdio: 'ignore' }).unref();
await sleep(1600);
await call('Page.reload');
let healed = false;
for (let i = 0; i < 16 && !healed; i++) {
  await sleep(350);
  healed = await ev(`(() => { const im = document.querySelector('.photo-clip img'); return !!(im && im.getAttribute('src') && im.getAttribute('src').startsWith('data:') && im.naturalWidth > 0); })()`).catch(() => false);
}
chk('搜索烧录+重载后 thumb 自愈', healed);

console.log(`R209-LIVE RESULT: ${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
