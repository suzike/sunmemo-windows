'use strict';
// SunMemo for Windows — main process.
// A faithful port of the macOS app's AppDelegate + window controllers.

const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, screen, shell, nativeImage, clipboard, session, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const { LineStore } = require('./src/state');
const { Sync, calculateTodoStats } = require('./src/sync');
const { docTypeOf } = require('./src/state');
const { Watchers } = require('./src/watchers');
const { ensureAssets } = require('./src/icon');
const { renderMemoPng } = require('./src/memo-png');
const L = require('./src/layout');

// R130: system light/dark switch. Every renderer's CSS uses
// `@media (prefers-color-scheme: dark)`, and Electron's default
// nativeTheme.themeSource is 'system', so all windows follow the OS theme
// automatically — no JS intervention, no reloads needed. Beacon's time-of-day
// hue is machine-clock based and theme-independent; sticky notes are a fixed
// paper design. themeSource is never set elsewhere, so following is never
// locked. Single process-wide listener: log only.
nativeTheme.on('updated', () => {
  console.log('[nativeTheme] system theme switched to', nativeTheme.shouldUseDarkColors ? 'dark' : 'light', '— CSS media queries auto-follow, no JS action');
});

const PANEL_H = L.PANEL_H;
const REVEAL_DELAY = 250;   // cursor rests against the top edge before the line comes down
const RETRACT_DELAY = 500;  // cursor away before the line tucks back up

const isDemo = app.commandLine.hasSwitch('demo');
const isShots = app.commandLine.hasSwitch('shots');
const shotsDir = path.join(__dirname, '_shots');

let lineWin = null, overlayWin = null, memoWin = null, settingsWin = null, welcomeWin = null, searchWin = null, statsWin = null, beaconWin = null, tray = null;
let assets = null;

let store = null, sync = null, watchers = null;

// --- present / reveal state (port of AppDelegate) ---
let isPresent = false;
let isRevealed = false;
let pinned = false;
let peekUntil = 0;
let hotZoneSince = 0;
let awaySince = 0;
let wanted = false;
let keepOpen = false;
let lastLive = 0;
let mouseTimer = null;
let hitRects = [];          // card frames in line-window coords, reported by the renderer
let previewOpen = false;
let previewCurrentId = null;
let overlayFit = null;
let previewPeg = null;
let previewOrigin = null;
let draggingID = null;
let pressedID = null;
let copiedID = null;
let pendingDisplay = null;  // display a new capture should land on
let lineBounds = null;      // cached bounds for layout math
let lastLineDisplay = null; // R96: display the rope last hung on (beacon follows it)
let userPinned = false;
let quitting = false;
let updateState = null;     // { update, latest, status } — shown in the tray
let hkFailures = [];        // hotkeys that failed to register (taken by other apps)
let reloadTimes = [];       // render-process-gone timestamps — 3 in 60s suspends auto-reload

// Anything that is not plainly hardware-composited counts as software: the
// status string varies ('disabled_software' / 'disabled_off_ok' / …) with the
// GPU switches and driver state.
// Persisted: once this machine falls into software compositing, remember it
// (re-probing each boot flip-flopped the material system mid-flight).
function isSoftwareRendering() {
  return store ? store.settings.gpuSoftware === true : true;
}

// CRITICAL: keep the Chromium profile (GPU shader cache etc.) OUT of our
// data directory. %APPDATA%\SunMemo doubles as Electron's default userData,
// and wiping it for demo runs used to delete the GPU cache — which made the
// GPU process fail and dropped the whole app into software rendering (the
// original "太卡了"). The profile now lives in the AppProfile subfolder.
// --profile=<dir> redirects everything (Chromium profile + Memos/Screenshots
// data) to a scratch directory so the selftest can run against a clean slate;
// app.getPath('appData') ignores the APPDATA env var on Windows, so an env
// override is NOT enough.
const profileOverride = app.commandLine.getSwitchValue('profile');
app.setPath('userData', profileOverride
  ? path.join(profileOverride, 'AppProfile')
  : path.join(app.getPath('appData'), 'SunMemo', 'AppProfile'));

// Local-only DevTools endpoint: lets the E2E suite attach to whatever
// instance the user is running (no spawning/killing of their session).
app.commandLine.appendSwitch('remote-debugging-port', '9222');

// R103: real logError — the R101 handlers below called a name that never
// existed (their inner catch swallowed the ReferenceError = dead handlers).
function logError(tag, e) {
  try {
    fs.appendFileSync(path.join(app.getPath('appData'), 'SunMemo', 'error.log'),
      `[${new Date().toISOString()}] ${tag}: ${e && e.stack || e}\n`);
  } catch { /* ignore */ }
}
process.on('uncaughtException', e => { logError('uncaught', e); });
process.on('unhandledRejection', e => { logError('unhandled', e); });

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    // Deep links: a second `electron . --search|--memo|--settings|--toggle`
    // pokes the running instance (the Windows stand-in for the macOS
    // distributed notifications).
    const a = (argv || []).find(x => x.startsWith('--') && ['--search', '--memo', '--settings', '--toggle'].includes(x));
    if (a === '--search') showSearch();
    else if (a === '--memo') showQuickMemo(null);
    else if (a === '--settings') showSettings();
    else if (a === '--toggle') toggle();
    else revealLinePinned();
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  // Local file:// assets get cached by the renderer; stale cached HTML/CSS
  // haunted this whole session ("我改了怎么没生效"). Clear on every boot —
  // the assets are local, so the cost is zero.
  try { await session.defaultSession.clearCache(); } catch { /* ignore */ }

  const userData = app.getPath('userData');
  // --profile=<dir> scratch mode: data lives inside the scratch dir too.
  const base = profileOverride || path.join(app.getPath('appData'), 'SunMemo');
  const memosFolder = path.join(base, 'Memos');
  const shotsFolder = path.join(base, 'Screenshots');

  // Demo/shot runs start from a clean slate: wipe OUR data files only.
  // Never touch the Chromium profile (AppProfile) — deleting the GPU shader
  // cache used to drop the app into software rendering.
  if (isDemo || isShots) {
    // R103: config.json.bak resurrected the whole old inventory (store falls
    // back to it when config.json is missing) — demo wipes must take both.
    for (const target of [memosFolder, shotsFolder, path.join(base, 'config.json'), path.join(base, 'config.json.bak')]) {
      try { fs.rmSync(target, { recursive: true, force: true }); } catch { /* locked */ }
    }
    try { fs.rmSync(path.join(app.getPath('documents'), 'SunMemo.md'), { force: true }); } catch { /* ignore */ }
    console.log('[wipe] done, memos dir exists:', fs.existsSync(memosFolder), 'config exists:', fs.existsSync(path.join(base, 'config.json')));
  }

  assets = await ensureAssets(userData);

  sync = new Sync(memosFolder, app.getPath('documents'));

  store = new LineStore({ memosFolder, configPath: path.join(base, 'config.json') });
  store.onSound = (name, volume, pitch) => lineWin && !lineWin.isDestroyed() && lineWin.webContents.send('play-sound', { name, volume: volume * (store.settings.volume ?? 0.6), pitch });
  store.onChange = () => broadcast();
  store.onSync = items => sync.sync(items);
  store.onFall = item => fallAnimation(item);
  store.onArchive = item => sync.archiveTornDown(item);
  // R44: optional balloon when something new hangs on the line
  store.onHangNotify = title => {
    if (tray && store.settings.hangNotify && tray.displayBalloon) {
      tray.displayBalloon({ title: '已挂上晾衣绳', content: title, icon: assets.icon32 });
    }
  };
  store.onTorn = torn => {
    lineWin && !lineWin.isDestroyed() && lineWin.webContents.send('torn-toast', { text: torn.text.slice(0, 24) });
  };
  store.onCopied = id => {
    copiedID = id;
    broadcast();
    setTimeout(() => { if (copiedID === id) { copiedID = null; broadcast(); } }, 1200);
  };

  store.syncRef = sync; // recycle-bin restore access

  // v1.8 退场钩子：一张便签"刚好全部打完"的瞬间 → 绳上弹「收进回忆板？」确认。
  // 绳不在场（收起）时跳过——那一刻必须是用户正在打勾的当场。
  store.onAllDone = item => {
    if (!lineWin || lineWin.isDestroyed() || !isRevealed) return;
    const first = String((item.memo && item.memo.text) || '').split(String.fromCharCode(10))[0].replace(/^#+\s*/, '').trim();
    lineWin.webContents.send('exit-offer', { id: item.id, text: first.slice(0, 24) });
  };


  watchers = new Watchers({
    shotsFolder,
    // [perf] makeThumb decodes synchronously inside store.hang — defer it one
    // macrotask so a due 4Hz tracking tick (or any other timer) finishes its
    // frame first; the decode is background work, never urgent input.
    onHangImage: (file, opts) => setImmediate(() => hangCapture(file, opts)),
    onPrune: () => store.prune(),
  });

  // R39: rotate the archive backup on every boot (keep 7).
  try {
    const archSrc = path.join(base, 'Memos', 'archived_memos.json');
    if (fs.existsSync(archSrc)) {
      const bdir = path.join(base, 'backups');
      fs.mkdirSync(bdir, { recursive: true });
      const stamp = new Date().toISOString().slice(0, 10);
      fs.copyFileSync(archSrc, path.join(bdir, `archived-${stamp}.json`));
      const olds = fs.readdirSync(bdir).filter(f => f.startsWith('archived-')).sort();
      while (olds.length > 7) fs.rmSync(path.join(bdir, olds.shift()), { force: true });
    }
  } catch { /* best effort */ }

  store.restore();

  // Each stage is isolated: one failing subsystem must never take down the
  // rest of the boot (a broken tray used to kill hotkeys + IPC entirely).
  const stage = (name, fn) => {
    try { fn(); } catch (e) {
      console.error(`[boot] ${name} failed:`, e && e.message);
      try {
        fs.appendFileSync(path.join(app.getPath('appData'), 'SunMemo', 'error.log'),
          `[${new Date().toISOString()}] boot stage ${name}: ${e && e.stack || e}\n`);
      } catch { /* ignore */ }
    }
  };
  stage('lineWindow', () => createLineWindow());
  stage('overlayWindow', () => createOverlayWindow());
  stage('beaconWindow', () => createBeaconWindow());
  // R58 响应压缩: warm the transparent surfaces at boot so the FIRST
  // preview/editor open is instant (surface allocation is the slow part).
  stage('warmup', () => {
    setTimeout(() => {
      try {
        overlayWin.showInactive();
        overlayWin.hide();
        showQuickMemo(null, { prewarm: true });
      } catch { /* ignore */ }
    }, 1500);
  });
  stage('tray', () => setupTray());
  stage('hotkeys', () => registerHotkeys());
  stage('ipc', () => setupIPC());

  stage('watchers', () => {
    watchers.autoHang = store.settings.autoHang;
    // R110: tell the renderer the persisted ambient-wind state once audio can start
    // R139: send the initial volume alongside, so wind starts at the saved loudness.
    setTimeout(() => {
      try { lineWin && !lineWin.isDestroyed() && lineWin.webContents.send('wind', !!store.settings.wind); } catch { /* ignore */ }
      try { lineWin && !lineWin.isDestroyed() && lineWin.webContents.send('settings-volume', store.settings.volume ?? 0.6); } catch { /* ignore */ }
    }, 4000);
    watchers.startClipboard();
    // R31: folder watchers aren't needed in the first seconds.
    setTimeout(() => { try { watchers.startFolders(); } catch { /* ignore */ } }, 2500);
  });

  // Follow display changes (resolution, taskbar, monitor plug/unplug).
  screen.on('display-metrics-changed', () => {
    if (isPresent) placeOnDisplay(displayUnderCursor());
    else lineBounds = null;
  });


  // Software-rendering machines (no usable GPU for Chromium): swap the frosted
  // backdrop-filter materials for cheap opaque equivalents via a body class,
  // and open up card spacing so opaque cards never cover neighbour text.
  console.log('[gpu] status:', (() => { try { return JSON.stringify(app.getGPUFeatureStatus()); } catch { return 'n/a'; } })(), 'software:', isSoftwareRendering());
  const softGPU = isSoftwareRendering();
  if (softGPU) L.setSoftwareMode(true);
  const ACCENTS = { sunrise: '#ff8f1f', mint: '#2fbf9f', sakura: '#f06292', sky: '#4a9ff5', grape: '#8b5cf6' };
  const applyAccent = win => {
    let a = ACCENTS[store.settings.accent] || ACCENTS.sunrise;
    if (store.settings.accentCustom) a = store.settings.accentCustom; // R157: custom color wins while set (picking a preset clears it)
    win.webContents.executeJavaScript(`document.documentElement.style.setProperty('--accent', '${a}')`).catch(() => {});
  };
  const markSoftwareRendering = win => {
    applyAccent(win);
    if (!softGPU) return;
    win.webContents.executeJavaScript("document.body.classList.add('sw')").catch(() => {});
  };
  // .on 而非 .once：render-process-gone 自动重载后 renderer 的 thumbCache 是
  // 空的，主进程 thumbSent 必须一并清零重发，否则图片卡永久变空盒；sw 类同理。
  [lineWin, overlayWin].forEach(w => w.webContents.on('did-finish-load', () => markSoftwareRendering(w)));

  lineWin.webContents.on('did-finish-load', () => {
    thumbSent.clear(); // renderer cache is fresh — resend all thumbs
    broadcast();
    // R146: 重启后回推持久化字号档，否则 line 端 Ctrl+滚轮只会读到默认 md。
    try { lineWin.webContents.executeJavaScript(`document.body.dataset.font = '${store.settings.cardFont || 'md'}'`).catch(() => {}); } catch { /* ignore */ }
    try { lineWin.webContents.executeJavaScript(`document.body.classList.toggle('imgzoom', ${store.settings.imgZoom !== false})`).catch(() => {}); } catch { /* ignore */ }
    try { lineWin.webContents.executeJavaScript(`document.body.dataset.sunSeed = '${store.settings.sunSeedDate || ''}'`).catch(() => {}); } catch { /* ignore */ }
    if (!store.settings.welcomed && !isShots) {
      setTimeout(() => showWelcome(), 1200);
    }
  });

  if (isDemo) setTimeout(seedDemo, 700);
  if (isShots) setTimeout(runShots, 1200);
  const open = app.commandLine.getSwitchValue('open');
  if (open === 'settings') setTimeout(showSettings, 800);
  if (open === 'welcome') setTimeout(showWelcome, 800);
  if (open === 'memo') setTimeout(() => showQuickMemo(null), 800);
  if (open === 'stats') setTimeout(showStats, 800);
  if (app.commandLine.hasSwitch('probe')) {
    setTimeout(async () => {
      const info = await lineWin.webContents.executeJavaScript(`(() => {
        const glass = document.querySelector('.cardfx.glass');
        const out = { slots: [], items: (window.__lastState ? window.__lastState.items.length : -1), cardsHtml: document.getElementById('cards').childElementCount,
          bodyClass: document.body.className,
          glassBDF: glass ? getComputedStyle(glass).backdropFilter : 'n/a' };
        document.querySelectorAll('.slot').forEach((s, i) => {
          const q = sel => { const e = s.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { y: +r.y.toFixed(1), h: +r.height.toFixed(1), x: +r.x.toFixed(1) }; };
          out.slots.push({ i, cls: s.className.replace('slot arrived', '').trim(), id: s.dataset.id || '', left: s.style.left, top: s.style.top, peg: q('.peg'), face: q('.memo-face'), body: q('.memo-body'), head: q('.md-h'), foot: q('.memo-foot') });
        });
        out.disc = (() => { const w = document.querySelector('.discover-slot'); return w ? { display: getComputedStyle(w).display } : null; })();
        out.scrollUI = !!document.getElementById('scrollBar');
        return JSON.stringify(out);
      })()`);
      console.log('[probe]', info);
      app.exit(0);
    }, 6000);
  }
  if (app.commandLine.hasSwitch('test')) {
    setTimeout(async () => {
      const selftest = require('./src/selftest');
      const ok = await selftest({ store, sync, watchers, assets });
      app.exit(ok ? 0 : 1);
    }, 1200);
  }
});

app.on('window-all-closed', () => { /* tray app: keep running */ });

app.on('before-quit', () => {
  quitting = true;
  try { store && store.flushSync(); } catch { /* ignore */ }
  try { globalShortcut.unregisterAll(); } catch { /* ignore */ }
  try { watchers && watchers.stopClipboard(); watchers && watchers.stopFolders(); } catch { /* ignore */ }
});

// R103: uncaught handlers now live at the top of the file (logError) — the
// duplicated pair that used to be here double-logged every error.

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

const PRELOAD = path.join(__dirname, 'preload.js');

function createLineWindow() {
  const d = screen.getPrimaryDisplay();
  const wa = d.workArea;
  lineWin = new BrowserWindow({
    x: wa.x, y: wa.y, width: wa.width, height: PANEL_H,
    show: false, frame: false, transparent: true, resizable: false,
    movable: false, minimizable: false, maximizable: false,
    skipTaskbar: true, focusable: false, hasShadow: false,
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false },
  });
  lineWin.setAlwaysOnTop(true, 'floating');
  lineWin.loadFile(path.join(__dirname, 'renderer', 'line', 'line.html'));
  lineWin.setIgnoreMouseEvents(true, { forward: true });
  // R34: a crashed renderer reloads itself and gets a fresh broadcast.
  lineWin.webContents.on('render-process-gone', () => {
    const now = Date.now();
    reloadTimes.push(now);
    reloadTimes = reloadTimes.filter((t) => now - t < 60000);
    if (reloadTimes.length >= 3) {
      console.error('line renderer crash-loop: ' + reloadTimes.length + ' reloads within 60s — auto-reload suspended');
      return;
    }
    try { lineWin.webContents.reload(); } catch { /* ignore */ }
    setTimeout(() => { try { broadcast(); } catch { /* ignore */ } }, 2500);
  });
}

function createOverlayWindow() {
  const d = screen.getPrimaryDisplay();
  overlayWin = new BrowserWindow({
    x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height,
    show: false, frame: false, transparent: true, resizable: false,
    movable: false, minimizable: false, maximizable: false,
    skipTaskbar: true, hasShadow: false,
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false },
  });
  overlayWin.setAlwaysOnTop(true, 'floating');
  overlayWin.loadFile(path.join(__dirname, 'renderer', 'overlay', 'overlay.html'));
}

// Mixed-DPI vertical dual-monitor (150% primary over a 100% secondary) is a
// performance cliff for transparent always-on-top windows: crossing the DPI
// boundary forces full software re-rasterization of a 2560px-wide strip and
// breaks hit-testing. Every window is pinned to the primary display.
// 待机信标: breathing sun at top-centre; click/hover expands the line.
function createBeaconWindow() {
  const d = screen.getPrimaryDisplay();
  const wa = d.workArea;
  beaconWin = new BrowserWindow({
    // 168x42 = 26px pill + hover 展开到 118px 也要完整落在窗口内（此前 80 宽
    // 会把展开的胶囊裁成黑条——用户截图的"怪形状"根因），8px 透明命中环同理。
    x: Math.round(wa.x + wa.width / 2 - 84), y: wa.y,
    width: 168, height: 42,
    frame: false, transparent: true, resizable: false,
    skipTaskbar: true, hasShadow: false,
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false },
  });
  beaconWin.setAlwaysOnTop(true, 'floating');
  beaconWin.loadFile(path.join(__dirname, 'renderer', 'beacon', 'beacon.html'));
  beaconWin.on('closed', () => { beaconWin = null; });
}

function updateBeacon() {
  if (!beaconWin || beaconWin.isDestroyed()) return;
  const show = !isRevealed && !!store.settings.beacon && !userPinned;
  if (show) {
    try {
      // R96: guard the screen the rope last hung on — after using the line on
      // the secondary, the beacon waits THERE, not back on the primary.
      const dd = lastLineDisplay || screen.getPrimaryDisplay();
      const wa = dd.workArea;
      beaconWin.setBounds({ x: Math.round(wa.x + wa.width / 2 - 84), y: wa.y, width: 168, height: 42 });
    } catch { /* keep */ }
    // show() (not showInactive): hidden transparent windows re-shown with
    // showInactive sometimes never reach the screen on Windows — the OS hit
    // test kept reporting the desktop underneath. show() forces composition.
    beaconWin.show();
    beaconWin.setAlwaysOnTop(true, 'floating');
    beaconWin.moveTop();
  } else if (beaconWin.isVisible()) {
    beaconWin.hide();
  }
}

// v1.8 信标状态：绳收着的 90% 时间里待办也要在场——胶囊常显「N 件未收尾」，
// 全部打完显示「今日清零 ✓」。随 broadcast（含每次打勾）推送；beacon 加载完成
// 时还会经 beacon:get-stats 主动拉一次，避免启动竞态漏掉首帧。
function beaconStatsNow() {
  const memos = store.items.filter(i => i.kind === 'memo' && !i.falling && !i.desktop);
  let total = 0, done = 0;
  memos.forEach(m => { const st = calculateTodoStats(m.memo.text); total += st.total; done += st.completed; });
  return { total, done, live: store.liveCount() };
}
function pushBeaconStats() {
  if (!beaconWin || beaconWin.isDestroyed()) return;
  try { beaconWin.webContents.send('beacon:stats', beaconStatsNow()); } catch { /* ignore */ }
}

// R96: per-display placement — the argument used to be silently ignored
// (the function took no parameters and pinned everything to the primary),
// so the R95 hot-zone fix revealed the flag without moving the window.
// R97: the no-arg default is DETERMINISTIC (last display the rope hung on,
// then primary) — following the live cursor made cold-boot placement depend
// on wherever the pointer happened to sit, which E2E and the beacon
// continuity both guessed wrong.
// v1.7.1 晾衣绳位置模式：follow = 光标所在显示器；fixed:<sig> = 固定某块屏
function displaySig(d) {
  return 'fixed:' + [d.bounds.x, d.bounds.y, d.bounds.width, d.bounds.height, d.primary ? 1 : 0].join('_');
}
function targetDisplay() {
  const mode = store.settings.displayMode || 'follow';
  if (mode !== 'follow') {
    const hit = screen.getAllDisplays().find(d => displaySig(d) === mode);
    if (hit) return hit;
  }
  return displayUnderCursor();
}
function placeOnDisplay(target) {
  const d = target || lastLineDisplay || screen.getPrimaryDisplay();
  lastLineDisplay = d;
  const wa = d.workArea;
  lineBounds = { x: wa.x, y: wa.y, width: wa.width, height: PANEL_H };
  ropeDisplayBounds = (screen.getDisplayNearestPoint({ x: lineBounds.x + 10, y: lineBounds.y + 10 }) || {}).bounds || null;
  lineWin.setBounds({ x: wa.x, y: wa.y, width: wa.width, height: PANEL_H });
  overlayWin.setBounds({ x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height });
}

function displayUnderCursor() {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

// ---------------------------------------------------------------------------
// Showing and hiding (the AppDelegate state machine)
// ---------------------------------------------------------------------------

// Heuristic: with a fullscreen app (video, presentation, F11) Windows hides
// the taskbar, so the work area equals the display bounds. Like the original
// (which hides in fullscreen Spaces), a passive reveal is suppressed then —
// explicit open (hotkey/tray) still works.
function isFullscreenLike(d) {
  const wa = d.workArea, b = d.bounds;
  return wa.x === b.x && wa.y === b.y && wa.width === b.width && wa.height === b.height;
}

function refresh() {
  const passive = !keepOpen;
  const blocked = passive && isFullscreenLike(screen.getPrimaryDisplay());
  if (wanted && !blocked) present();
  else dismiss();
  // The tracking tick drives the auto-retract (cursor away -> tuck up).
  if (wanted) startMouseTracking();
  else stopMouseTracking();
}

function present() {
  if (isPresent) return;
  isPresent = true;
  lineWin.showInactive();
  lineWin.setAlwaysOnTop(true, 'floating');
}

function dismiss() {
  if (!isPresent) return;
  isPresent = false;
  setRevealed(false);
  setTimeout(() => { if (!isPresent) lineWin.hide(); }, 400);
}

function reveal({ pinned: pin = false, peekFor = 0 } = {}) {
  if (!isPresent) return;
  if (pin) pinned = true;
  if (peekFor > 0) peekUntil = Date.now() + peekFor * 1000;
  awaySince = 0;
  // The tuck-away timer may have hidden the window; bring it back before sliding down.
  if (!lineWin.isVisible()) {
    lineWin.showInactive();
    lineWin.setAlwaysOnTop(true, 'floating');
  }
  setRevealed(true);
}

function setRevealed(on) {
  if (on === isRevealed) return;
  isRevealed = on;
  updateBeacon();
  // While shown the strip accepts the mouse (no per-card click-through — the
  // forward: true mouse forwarding is unreliable on mixed-DPI multi-monitor);
  // tucked away it is fully click-through and hidden.
  setIgnoreMouse(!on);
  if (!on) {
    pinned = false;
    peekUntil = 0;
    // Once tucked away the window is pure clipped emptiness — hide it so the
    // compositor has nothing to do until the next reveal.
    setTimeout(() => {
      if (!isRevealed && isPresent && lineWin && !lineWin.isDestroyed() && lineWin.isVisible()) lineWin.hide();
    }, 320);
  }
  broadcast();
}

function revealLinePinned() {
  keepOpen = true;
  wanted = true;
  placeOnDisplay(targetDisplay());
  refresh();
  // 2.5s grace, then normal auto-retract. Staying open is the 📌 button's job.
  reveal({ peekFor: 2.5 });
}

function toggle() {
  if (isRevealed) {
    setRevealed(false);
    if (store.liveCount() === 0) {
      keepOpen = false;
      wanted = false;
      refresh();
    }
  } else {
    revealLinePinned();
  }
}

function itemsChanged() {
  const live = store.liveCount();
  if (live > lastLive) {
    placeOnDisplay(pendingDisplay);
    pendingDisplay = null;
    wanted = true;
    refresh();
    reveal({ peekFor: 2.5 });
  } else if (live === 0 && !keepOpen) {
    setTimeout(() => {
      if (store.liveCount() === 0 && !keepOpen && lineWin && !lineWin.isDestroyed()) {
        wanted = false;
        refresh();
      }
    }, 700);
  }
  lastLive = live;
}

// --- mouse polling: top-edge reveal + auto retract + click-through ---------

function startMouseTracking() {
  if (mouseTimer) return;
  mouseTimer = setInterval(tick, 1000 / 4); // 4Hz: getCursorScreenPoint is expensive on mixed-DPI rigs
}

function stopMouseTracking() {
  if (mouseTimer) { clearInterval(mouseTimer); mouseTimer = null; }
}

let cursorWasInside = false;
let ropeDisplayBounds = null; // 绳所在显示器的 bounds（收回判定的信任范围）
let lineScrollX = 0; // 晾衣绳横向滚动偏移（renderer 上报，飞行/预览落点用）
let rendererHot = false; // R92: renderer-reported rope-zone hover
let slowTicks = 0;       // [perf] consecutive away-and-tucked ticks before halving the poll rate
let __tickMs = 0, __tickN = 0, __tickPart = '';
function tick() {
  const t0 = process.hrtime.bigint();
  try { tickInner(); } catch { /* skip bad frame */ }
  __tickMs += Number(process.hrtime.bigint() - t0) / 1e6;
  __tickN++;
}
// [perf] logging is diagnostic-only (demo/shots/probe runs); daily runs stay silent.
if (app.commandLine.hasSwitch('demo') || app.commandLine.hasSwitch('shots') || app.commandLine.hasSwitch('probe')) {
  setInterval(() => {
    if (__tickN) console.log('[perf] tick avg', (__tickMs / __tickN).toFixed(2) + 'ms x' + __tickN, '/ 5s');
    __tickMs = 0; __tickN = 0;
  }, 5000);
}
function tickInner() {
  const p = screen.getCursorScreenPoint();
  // R95: the display under the cursor, not always the primary — the top-edge
  // hot zone only ever fired on the primary, so resting the cursor on the
  // secondary's top edge (this rig: a 2560×1440 above the laptop panel) did
  // nothing. placeOnDisplay(d) was already written per-display.
  const d = screen.getDisplayNearestPoint(p);
  const now = Date.now();

  // When the real cursor leaves the strip, tell the renderer to drop any
  // stuck hover state (badges / toolbars) — mouseleave is not reliable here.
  // v1.8.1: renderer 报告 line:hot（光标确实在绳上组件）期间不发 cool——
  // 混合 DPI 副屏上 getCursorScreenPoint 与窗口边界有偏差，主进程会误判
  // "已离开"并发 cool 清掉 renderer 悬停态：文档 320ms 驻留预览和窗口堆
  // 300ms 展开都被这发子弹打死（"偶发不展开"的根因）。renderer 的
  // mouseleave 是真实源，主进程几何只在 renderer 沉默时兜底。
  if (lineBounds) {
    const inside = p.x >= lineBounds.x && p.x <= lineBounds.x + lineBounds.width &&
                   p.y >= lineBounds.y && p.y <= lineBounds.y + lineBounds.height;
    if (cursorWasInside && !inside && !rendererHot && lineWin && !lineWin.isDestroyed()) {
      lineWin.webContents.send('line:cool');
    }
    cursorWasInside = inside;
    // [perf] adaptive tick: the interval stays 250ms, but after ~2s (8 ticks)
    // of cursor-away + line-tucked, every other tick becomes a no-op —
    // effective 2Hz while nothing can happen (power saving). Trade-off: the
    // top-edge hot zone then also samples at 2Hz (reveal latency +≤250ms),
    // acceptable — resting near the top edge is "inside" (the strip spans the
    // whole top), so approaching it restores 4Hz immediately.
    if (!inside && !isRevealed) {
      if (++slowTicks > 8 && (slowTicks % 2)) return;
    } else {
      slowTicks = 0;
    }
  }

  if (!isRevealed) {
    // Resting against the top edge brings the line down on that screen.
    let hotOk = true;
    if ((store.settings.displayMode || 'follow') !== 'follow') {
      const td = targetDisplay();
      hotOk = !!(td && d && d.bounds === td.bounds);
    }
    if (wanted && hotOk && d && (p.y - d.bounds.y) <= 2 && p.y >= d.bounds.y
        && !isFullscreenLike(d)) {
      const since = hotZoneSince || now;
      hotZoneSince = since;
      if (now - since >= REVEAL_DELAY) {
        hotZoneSince = 0;
        placeOnDisplay(d);
        refresh();
        reveal();
      }
    } else {
      hotZoneSince = 0;
    }
    return;
  }

  // The line's zone runs from its lowest point up to the top of the screen.
  const lb = lineBounds || lineWin.getBounds();
  // v1.7.1 修复"移到副屏下半区绳不收回"：几何判定必须用绳带自己的矩形——
  // 旧写法拿"光标所在显示器的顶部"当上界，副屏在主屏上方时该带高达整块
  // 副屏，鼠标停在副屏下半区会被误判为仍在绳上。
  const geomInside = p.x >= lb.x - 60 && p.x <= lb.x + lb.width + 60 &&
                     p.y >= lb.y - 40 && p.y <= lb.y + lb.height + 60;
  // rendererHot 只在光标位于绳所在显示器时采信（R92 混合 DPI 偏差场景），
  // 光标去了别的屏立即作废——防止 mouseleave 丢失导致的永久卡 true。
  if (rendererHot && ropeDisplayBounds && d && d.bounds !== ropeDisplayBounds) rendererHot = false;
  const inside = geomInside || rendererHot;
  // docPeek 状态与 overlay 可见性一致性兜底
  if (docPeekOpen && overlayWin && !overlayWin.isDestroyed() && !overlayWin.isVisible()) docPeekOpen = false;
  if (inside && pinned && !previewOpen) pinned = false;

  // v1.6 修复"移走鼠标绳不收回"：pinned 不再计入 busy——移开 500ms 即收回
  // 并清除临时钉住；鼠标在绳带内则不受影响。
  const busy = userPinned || draggingID != null || pressedID != null || previewOpen || docPeekOpen || now < peekUntil;
  if (inside || busy) {
    awaySince = 0;
  } else {
    const since = awaySince || now;
    awaySince = since;
    if (now - since >= RETRACT_DELAY) {
      awaySince = 0;
      pinned = false;
      setRevealed(false);
    }
  }
}

// Click-through model: revealed → the strip takes the mouse; tucked/hidden →
// fully click-through. (Per-card forwarding proved unreliable on this
// machine's mixed-DPI multi-monitor setup.)
let ignoreMouse = true;
function setIgnoreMouse(shouldIgnore) {
  if (shouldIgnore === ignoreMouse) return;
  ignoreMouse = shouldIgnore;
  if (!lineWin.isDestroyed()) lineWin.setIgnoreMouseEvents(shouldIgnore);
}

// ---------------------------------------------------------------------------
// Capture flights & falls (port of CaptureFlight, rendered by the overlay)
// ---------------------------------------------------------------------------

function cardFrameFor(id) {
  const idx = store.items.findIndex(i => i.id === id);
  if (idx < 0 || !lineBounds) return null;
  const item = store.items[idx];
  const count = store.items.length + 1; // the add-card sits at the end
  const f = L.cardFrame(item, idx, count, lineBounds.x, lineBounds.y, lineBounds.width);
  if (lineScrollX) { f.x += lineScrollX; f.cx += lineScrollX; } // 绳上平移后的落点修正
  return f;
}

function hangCapture(file, { flying = false } = {}) {
  const id = store.hang(file, { flying });
  if (id == null) return;
  if (flying) {
    // Drop-in arrival: the card springs onto the line by itself.
    setTimeout(() => store.land(id), 500);
  }
}

// R98: pick a local picture from disk and hang it as a photo card.
async function uploadLocalImage() {
  const { dialog } = require('electron');
  const r = await dialog.showOpenDialog({
    title: '选择要挂上晾衣绳的图片',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
  });
  if (r.canceled || !r.filePaths || !r.filePaths.length) return;
  let hung = 0;
  for (const f of r.filePaths.slice(0, 6)) {
    const before = store.liveCount();
    hangCapture(f, { flying: false });
    if (store.liveCount() > before) hung++;
  }
  if (hung > 0) {
    revealLinePinned();
  } else {
    store.play('beep', 0.4);
  }
}

// A new memo lifts off from where it was written and flies onto the line.
function hangMemoFlight(memoData, fromRect) {
  keepOpen = true;
  wanted = true;
  placeOnDisplay(targetDisplay());
  refresh();
  // v1.6 修复"移走鼠标绳不收回"：pinned 只在光标重新进入绳带时才清除，
  // 提交后鼠标若不经过绳带就永久卡住。改用 2.5s 宽限 peek——看得到落绳，
  // 且无论如何都会自动收回；鼠标进入绳带则宽限自然续期。
  reveal({ peekFor: 2.5 });

  const id = store.addMemo({ ...memoData, flying: true });
  if (id == null) return;

  setTimeout(() => {
    const item = store.find(id);
    const to = cardFrameFor(id);
    if (!item || !to) { store.land(id); return; }
    if (!overlayWin || overlayWin.isDestroyed()) { store.land(id); return; } // R101 guard
    // R98: fly over the display the ROPE hangs on (per-display ropes since R96)
    const d = lastLineDisplay || screen.getPrimaryDisplay();
    // Flights are rare and transient: give them the full screen for half a
    // second, then shrink back to the fitted preview size.
    const full = { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height };
    const wasFit = overlayFit;
    overlayWin.setBounds(full);
    overlayWin.showInactive();
    overlayFit = null;
    overlayWin.webContents.send('flight', {
      item: serializeItem(item, true),
      from: fromRect ? { x: fromRect.x, y: fromRect.y, w: fromRect.width, h: fromRect.height } : null,
      to,
      display: d.bounds,
    });
    setTimeout(() => {
      store.land(id);
      store.play('tink', 0.35);
      if (!previewOpen && overlayWin && !overlayWin.isDestroyed()) {
        overlayWin.hide();
        overlayFit = wasFit;
      }
    }, 560);
  }, 50);
}

// A discarded card falls over the whole screen, from where it hangs.
function fallAnimation(item) {
  if (!isPresent || !isRevealed || item.flying) return;
  if (!overlayWin || overlayWin.isDestroyed()) return; // R101: destroyed-window timers crashed the app
  const from = cardFrameFor(item.id);
  if (!from) return;
  const d = lastLineDisplay || screen.getPrimaryDisplay();
  const full = { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height };
  overlayWin.setBounds(full);
  overlayWin.showInactive();
  overlayWin.webContents.send('fall', {
    item: serializeItem(item, true),
    from,
    display: d.bounds,
  });
  // R160: fall is now crumple (350ms) + drop (~630ms) = 980ms in overlay.js —
  // hide the fx layer only after the new animation ends (was 750ms).
  setTimeout(() => { if (!previewOpen && overlayWin && !overlayWin.isDestroyed()) overlayWin.hide(); }, 1000);
}

// ---------------------------------------------------------------------------
// Quick memo window (QuickMemoWindowController)
// ---------------------------------------------------------------------------

const RATIO_SIZES = { wide: [500, 350], square: [420, 420], tall: [400, 490] };

// One persistent editor window, created lazily and reused — window creation
// (transparent surface allocation) was costing 300-600ms per open here.
let memoBooted = false;

function showQuickMemo(editingId = null, opts = {}) {
  let initial = { text: '', color: 'yellow', aspectRatio: 'wide' };
  if (editingId) {
    const item = store.find(editingId);
    if (item && item.kind === 'memo') {
      initial = { text: item.memo.text, color: item.memo.color, aspectRatio: item.memo.aspectRatio };
    } else {
      editingId = null;
    }
  }

  const [w, h] = RATIO_SIZES[initial.aspectRatio] || RATIO_SIZES.wide;

  const centerAndShow = () => {
    try {
      // Faithful to the original (NSScreen.screens.first): primary centering.
      const pd = screen.getPrimaryDisplay();
      const pwa = pd.workArea;
      memoWin.setBounds({
        x: Math.round(pwa.x + pwa.width / 2 - w / 2),
        y: Math.round(pwa.y + pwa.height / 2 - h / 2),
        width: w, height: h,
      });
    } catch { /* keep current position */ }
    memoWin.show();
    memoWin.focus();
  };

  if (memoWin && !memoWin.isDestroyed() && memoBooted) {
    memoWin._editingId = editingId;
    const resetData = { editingId, ...initial };
    if (!editingId && store.getDraft()) resetData.draft = store.getDraft();
    memoWin.webContents.send('memo:reset', resetData);
    centerAndShow();
    return;
  }

  memoWin = new BrowserWindow({
    width: w, height: h,
    frame: false, transparent: true, resizable: true,
    minWidth: 360, minHeight: 260, maxWidth: 1200, maxHeight: 1000,
    skipTaskbar: false, show: false, hasShadow: false,
    title: 'SunMemo 速记',
    icon: assets.icon32,
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false },
  });
  memoWin._editingId = editingId;
  const coldData = { editingId: editingId, ...initial };
  if (!editingId && store.getDraft()) coldData.draft = store.getDraft();
  memoWin.loadFile(path.join(__dirname, 'renderer', 'memo', 'memo.html'), {
    query: { data: JSON.stringify(coldData) },
  });
  memoWin.once('ready-to-show', () => {
    memoBooted = true;
    if (opts.prewarm) return; // stay hidden; first real open is then instant
    centerAndShow();
  });
  memoWin.on('closed', () => { memoWin = null; memoBooted = false; });
}

function resizeMemoWindow(ratio) {
  if (!memoWin) return;
  const [w, h] = RATIO_SIZES[ratio] || RATIO_SIZES.wide;
  const b = memoWin.getBounds();
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  memoWin.setBounds({ x: Math.round(cx - w / 2), y: Math.round(cy - h / 2), width: w, height: h });
}

function closeQuickMemo() {
  // Hide, don't destroy — the editor stays warm for the next open.
  if (memoWin && !memoWin.isDestroyed()) memoWin.hide();
}

// ---------------------------------------------------------------------------
// Hero preview window
// ---------------------------------------------------------------------------

function showPreview(id) {
  const item = store.find(id);
  if (!item || item.falling) return;
  previewCurrentId = id;
  const to = cardFrameFor(id);
  if (!to) return;
  closeDocPeek(); // 弹出阅读若开着，先收（overlay 只呈现一个面板）
  // R101: ALWAYS fullscreen on the rope's display. The old "fit the overlay
  // around the card" math raced the fullscreen flight/fall paths under
  // mixed-DPI — setBounds DIP rects got rescaled across monitors and the
  // overlay ballooned to span BOTH displays, landing previews (and their
  // buttons) off-screen. One display, one bounds call, renderer centers.
  const d = lastLineDisplay || screen.getPrimaryDisplay();
  if (!overlayWin || overlayWin.isDestroyed()) return; // R103 guard
  previewOpen = true;
  // R206+: 点击展开时，绳上悬停态（含图片自动放大）立即清除——同一时刻只呈现一个
  try { lineWin.webContents.send('line:cool'); } catch { /* ignore */ }
  overlayFit = { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height };
  overlayWin.setBounds(overlayFit);
  overlayWin.show();
  previewPeg = { x: to.cx - overlayFit.x, y: (to.ropeTop - lineBounds.y) + L.PIN_ABOVE + 2 };
  previewOrigin = { x: to.x - overlayFit.x, y: to.y - overlayFit.y, w: to.w, h: to.h };
  overlayWin.webContents.send('show-preview', {
    item: serializeItem(item, true),
    peg: previewPeg,
    origin: previewOrigin,
    display: { x: 0, y: 0, width: overlayFit.width, height: overlayFit.height },
  });
}

// v1.7 时光晾衣绳：归档便签按周回忆板（overlay 承载），点击卡片恢复上绳
function showMemory() {
  if (!sync || !overlayWin || overlayWin.isDestroyed()) return;
  closePreview();
  closeDocPeek();
  const groups = new Map();
  sync.archived.forEach((m, i) => {
    const d = new Date(m.tornDownAt || m.createdAt || Date.now());
    if (isNaN(d.getTime())) return;
    const day = (d.getDay() + 6) % 7; // 周一为一周之始
    const ws = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
    const key = ws.getFullYear() + '-' + String(ws.getMonth() + 1).padStart(2, '0') + '-' + String(ws.getDate()).padStart(2, '0');
    if (!groups.has(key)) {
      groups.set(key, { label: (ws.getMonth() + 1) + ' 月 ' + ws.getDate() + ' 那一周', items: [] });
    }
    const g = groups.get(key);
    if (g.items.length < 40) {
      const cd = new Date(m.createdAt || m.tornDownAt);
      g.items.push({ i, text: m.text || '', color: m.color || 'yellow', isDone: !!m.isDone, date: (cd.getMonth() + 1) + '月' + cd.getDate() + '日' });
    }
  });
  const weeks = [...groups.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, 12)
    .map(([key, g]) => ({ key, label: g.label, items: g.items }));
  const d = lastLineDisplay || screen.getPrimaryDisplay();
  overlayFit = { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height };
  overlayWin.setBounds(overlayFit);
  if (!overlayWin.isVisible()) overlayWin.showInactive();
  overlayWin.webContents.send('show-memory', { weeks, count: sync.archived.length });
}
ipcMain.on('memory:open', () => showMemory());
  // 晾衣绳位置设置：列出已连接显示器（设置窗下拉用）
  ipcMain.handle('displays:list', () => screen.getAllDisplays().map(d => ({
    id: displaySig(d),
    label: (d.primary ? '主显示器 ' : '扩展显示器 ') + d.bounds.width + '×' + d.bounds.height,
  })));
ipcMain.on('line:memory', () => showMemory()); // 命令面板入口（line 端通道）
ipcMain.on('memory:restore', (_e, idx) => {
  const id = store.restoreArchived(Number(idx));
  if (id != null) {
    store.play('tink', 0.35);
    broadcast();
    if (overlayWin && !overlayWin.isDestroyed() && overlayWin.isVisible()) showMemory(); // 回忆板刷新（该条已离场）
  }
});
ipcMain.on('memory:close', () => {
  if (!previewOpen && !docPeekOpen && overlayWin && !overlayWin.isDestroyed() && overlayWin.isVisible()) overlayWin.hide();
});

// ---- v1.8 桌面窗口堆 ---------------------------------------------------------（功能已移除）

// v1.8 信标状态：beacon 页面加载完成时主动拉一次（消除启动时序竞态）
ipcMain.handle('beacon:get-stats', () => beaconStatsNow());

// v1.6 文档卡悬停弹出阅读（Quick Look popover）：overlay 全屏窗承载 420×600
// 阅读面板，锚定卡片上方（底边压住卡顶，光标保持在面板内避免闪烁回环）。
let docPeekOpen = false, docPeekSince = 0;
ipcMain.on('line:doc-peek', (_e, { id }) => {
  const item = store.find(id);
  if (!item || item.kind !== 'doc' || item.falling || previewOpen) return;
  store.touch(id); // v1.8: 悬停阅读也是"动了它"——沉降龄期归零
  showDocPeek(item);
});
ipcMain.on('line:doc-peek-close', (_e, p) => {
  // 面板弹出瞬间的边缘 mouseleave 不算离开（光标从卡移入面板的过渡）
  if (p && p.reason === 'hover' && Date.now() - docPeekSince < 450) return;
  closeDocPeek();
});
function showDocPeek(item) {
  const f = cardFrameFor(item.id);
  if (!f || !overlayWin || overlayWin.isDestroyed()) return;
  const d = lastLineDisplay || screen.getDisplayNearestPoint({ x: Math.round(f.x + f.w / 2), y: Math.round(f.y) });
  const wa = d.workArea;
  // 用户要求：面板放桌面正中，且不与绳上任何东西重叠——垂直居中于绳带下方的自由区
  const stripBottom = wa.y + L.PANEL_H + 18;
  const PW = Math.min(470, Math.round(wa.width * 0.32));
  const freeH = wa.height - (stripBottom - wa.y);
  const PH = Math.min(620, freeH - 24);
  if (PH < 260) return; // 屏幕太矮放不下阅读面板
  const px = Math.round(wa.x + (wa.width - PW) / 2);
  const py = Math.round(stripBottom + (freeH - PH) / 2);
  docPeekOpen = true;
  docPeekSince = Date.now();
  try { lineWin.webContents.send('line:cool'); } catch { /* ignore */ }
  overlayFit = { x: d.bounds.x, y: d.bounds.y, width: d.bounds.width, height: d.bounds.height };
  overlayWin.setBounds(overlayFit);
  if (!overlayWin.isVisible()) overlayWin.showInactive();
  overlayWin.webContents.send('show-doc-peek', {
    item: serializeItem(item, true),
    panel: { x: px - wa.x, y: py - wa.y, w: PW, h: PH },
    anchor: { x: f.x - wa.x, y: f.y - wa.y, w: f.w, h: f.h }, // 光标停在源卡片上也保持打开
  });
}
function closeDocPeek() {
  if (!docPeekOpen) return;
  docPeekOpen = false;
  if (overlayWin && !overlayWin.isDestroyed()) overlayWin.webContents.send('doc-peek-close');
  setTimeout(() => {
    if (!docPeekOpen && !previewOpen && overlayWin && !overlayWin.isDestroyed() && overlayWin.isVisible()) overlayWin.hide();
  }, 260);
}

function closePreview() {
  previewOpen = false;
  closeDocPeek(); // v1.7.1: 工具窗/搜索打开时把悬停阅读面板一并收掉
  if (overlayWin && !overlayWin.isDestroyed() && overlayWin.isVisible()) overlayWin.hide(); // R103
}

// ---------------------------------------------------------------------------
// Settings & Welcome windows
// ---------------------------------------------------------------------------

function showSearch() {
  if (previewOpen) closePreview(); // R166b: overlay would swallow clicks
  if (searchWin && !searchWin.isDestroyed()) {
    searchWin.webContents.send('search:refresh', {
      items: store.items.filter(i => i.kind === 'memo' && !i.falling).map(i => serializeItem(i, true)),
    });
    searchWin.show(); searchWin.focus(); return;
  }
  const d = displayUnderCursor() || screen.getPrimaryDisplay();
  const wa = d.workArea;
  searchWin = new BrowserWindow({
    x: Math.round(wa.x + wa.width / 2 - 210), y: Math.round(wa.y + wa.height * 0.2),
    width: 420, height: 480,
    frame: false, transparent: true, resizable: false, skipTaskbar: false,
    show: false, hasShadow: false, title: '搜索便签', icon: assets.icon32,
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false },
  });
  searchWin.loadFile(path.join(__dirname, 'renderer', 'search', 'search.html'));
  searchWin.once('ready-to-show', () => {
    try {
      // R97: keep the cursor-relative placement — this used to re-pin the
      // window to the primary display, undoing the `d` computed above.
      searchWin.setBounds({
        x: Math.round(wa.x + wa.width / 2 - 210),
        y: Math.round(wa.y + wa.height * 0.2),
        width: 420, height: 480,
      });
    } catch { /* keep default centering */ }
    searchWin.show();
    searchWin.focus();
  });
  searchWin.on('closed', () => { searchWin = null; });
}

function showStats() {
  if (previewOpen) closePreview(); // R166b: overlay would swallow clicks
  if (statsWin && !statsWin.isDestroyed()) { statsWin.show(); statsWin.focus(); return; }
  statsWin = new BrowserWindow({
    width: 380, height: 560, show: false, resizable: false, frame: false, transparent: true,
    skipTaskbar: true, hasShadow: false, title: 'SunMemo 统计', icon: assets.icon32,
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false },
  });
  statsWin.loadFile(path.join(__dirname, 'renderer', 'stats', 'stats.html'));
  statsWin.once('ready-to-show', () => {
    try {
      const pd = screen.getPrimaryDisplay();
      const pwa = pd.workArea;
      statsWin.setBounds({ x: Math.round(pwa.x + pwa.width / 2 - 190), y: Math.round(pwa.y + pwa.height / 2 - 280), width: 380, height: 560 });
    } catch { /* default */ }
    statsWin.show();
    statsWin.focus();
  });
  statsWin.webContents.on('did-finish-load', () => {
    try { statsWin.webContents.send('stats:refresh'); } catch { /* ignore */ }
  });
  statsWin.on('closed', () => { statsWin = null; });
}

function showSettings() {
  if (previewOpen) closePreview(); // R166b: overlay would swallow clicks
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 480, height: 700, show: false, resizable: false,
    title: 'SunMemo 偏好设置', icon: assets.icon32, autoHideMenuBar: true,
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false },
  });
  settingsWin.setMenuBarVisibility(false);
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings', 'settings.html'));
  settingsWin.once('ready-to-show', () => { settingsWin.show(); settingsWin.focus(); });
  settingsWin.on('closed', () => { settingsWin = null; });
}

function showWelcome() {
  if (previewOpen) closePreview(); // R166b: overlay would swallow clicks
  if (welcomeWin && !welcomeWin.isDestroyed()) { welcomeWin.show(); welcomeWin.focus(); return; }
  welcomeWin = new BrowserWindow({
    // 740 高：特性清单增至 5 条后卡片更高，600 会把底部按钮裁掉半截
    width: 440, height: 740, show: false, frame: false, transparent: true,
    resizable: false, skipTaskbar: true, hasShadow: false,
    webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false },
  });
  welcomeWin.loadFile(path.join(__dirname, 'renderer', 'welcome', 'welcome.html'));
  welcomeWin.once('ready-to-show', () => { welcomeWin.show(); welcomeWin.focus(); });
  welcomeWin.on('closed', () => { welcomeWin = null; });
}

// ---------------------------------------------------------------------------
// Hotkeys (HotKeyManager port)
// ---------------------------------------------------------------------------

let registered = [];
function registerHotkeys() {
  registered.forEach(acc => globalShortcut.unregister(acc));
  registered = [];
  hkFailures = [];
  const hk = store.settings.hotkeys;

  const bind = (acc, fn) => {
    if (!acc) return false;
    if (globalShortcut.isRegistered(acc)) globalShortcut.unregister(acc);
    const ok = globalShortcut.register(acc, fn);
    if (ok) registered.push(acc);
    else hkFailures.push(acc);
    return ok;
  };

  bind(hk.toggle, toggle);
  // When toggle is the default Ctrl+Alt+Space, Ctrl+Alt+T keeps working too.
  if (hk.toggle === 'Control+Alt+Space') bind('Control+Alt+T', toggle);
  bind(hk.memo, () => showQuickMemo(null));
  bind(hk.paste, () => { if (!watchers.hangCurrentClipboard(store)) store.play('beep', 0.4); });
  bind('Control+Alt+F', showSearch);
}

// ---------------------------------------------------------------------------
// Tray (the macOS status item menu)
// ---------------------------------------------------------------------------

function setupTray() {
  tray = new Tray(assets.icon16);
  tray.setToolTip('SunMemo · 晾想法');
  tray.setContextMenu(buildTrayMenu());
}

function buildTrayMenu() {
  const items = [];
  const memos = store ? store.items.filter(i => i.kind === 'memo' && !i.falling) : [];

  // R99: 顶部动态状态区 — 在绳/待办/归档一目了然（禁用态，不可点击）。
  let todoTotal = 0, todoDone = 0;
  memos.forEach(m => { const st = calculateTodoStats(m.memo.text); todoTotal += st.total; todoDone += st.completed; });
  items.push(
    { label: `📅 在绳 ${store ? store.liveCount() : 0} · 待办 ${todoDone}/${todoTotal} · 归档 ${sync.archived.length}`, enabled: false },
    { type: 'separator' },
  );

  // 发现新版本时置顶醒目显示
  if (updateState && updateState.update) {
    items.push({
      label: `✨ 发现新版本 v${updateState.latest} (点击更新)`,
      click: () => shell.openExternal('https://github.com/km-open-lab/SunMemo/releases/latest'),
    }, { type: 'separator' });
  }
  if (hkFailures.length > 0) {
    items.push({ label: `⚠ 快捷键被占用: ${hkFailures.join(' / ')}`, enabled: false }, { type: 'separator' });
  }

  items.push(
    { label: isRevealed ? '隐藏晾衣绳' : '显示晾衣绳', click: toggle },
    { label: '弹窗新建便签', click: () => showQuickMemo(null) },
    { label: '搜索便签	Ctrl+Alt+F', click: showSearch },
    { label: '📊 本周统计', click: showStats },
    { label: '🕰 时光晾衣绳', click: showMemory },
    { label: '挂上剪贴板内容', click: () => { if (!watchers.hangCurrentClipboard(store)) store.play('beep', 0.4); } },
    // R98: local picture upload — photo cards aren't screenshots-only anymore
    // (drag-drop onto the rope also works since R94).
    { label: '上传本地图片...', click: uploadLocalImage },
    { type: 'separator' },
  );

  // ♻️ 回收站：最近撕下的便签可一键恢复（与"全部撕下"同属内容管理组）
  if (sync.archived.length > 0) {
    const recycleChildren = [
      // 破坏性操作保护：清空前二次确认（取消为默认按钮，误触即止）
      { label: '🗑 清空回收站', click: async () => {
          const { dialog } = require('electron');
          const r = await dialog.showMessageBox({
            type: 'warning', buttons: ['清空', '取消'], defaultId: 1, cancelId: 1,
            message: '清空回收站？', detail: '将永久删除全部归档便签，无法恢复。',
          });
          if (r.response !== 0) return;
          sync.archived = []; sync.saveArchived(); refreshTray();
        } },
      { label: '📂 打开回收站文件夹', click: () => shell.openPath(sync.archivePath) },
      { type: 'separator' },
    ];
    const perPage = 8;
    const pages = Math.ceil(sync.archived.length / perPage);
    const page = Math.min(recyclePage, pages - 1);
    sync.archived.slice(page * perPage, page * perPage + perPage).forEach((m, gi) => {
      const tornDate = m.tornDownAt ? String(m.tornDownAt).slice(5, 10) : '';
      recycleChildren.push({
        label: '恢复: ' + String(m.text || '').split(String.fromCharCode(10))[0].slice(0, 32) + (tornDate ? '  (' + tornDate + ' 撕下)' : ''),
        click: () => {
          recyclePage = 0;
          const nid = store.restoreArchived(page * perPage + gi);
          refreshTray();
          if (nid) { revealLinePinned(); setTimeout(() => { if (lineWin && !lineWin.isDestroyed()) lineWin.webContents.send('card-flash', nid); }, 350); }
        },
      });
    });
    if (pages > 1) {
      recycleChildren.push({ type: 'separator' });
      recycleChildren.push({ label: '< 上一步（' + (page + 1) + '/' + pages + '）', enabled: page > 0, click: () => { recyclePage = Math.max(0, page - 1); refreshTray(); } });
      recycleChildren.push({ label: '下一步 >', enabled: page < pages - 1, click: () => { recyclePage = page + 1; refreshTray(); } });
    }
    items.push({ label: `♻️ 回收站（${sync.archived.length}）`, submenu: recycleChildren });
  }
  if (memos.length > 0) {
    const firstLine = t => { for (const l of String(t).split(String.fromCharCode(10))) { const x = l.replace(/^#+\s*/, '').trim(); if (x) return x; } return '（空）'; };
    items.push({
      label: '便签预览', submenu: memos.slice(0, 8).map(m => ({
        label: firstLine(m.memo.text).slice(0, 40) || '（空）',
        click: () => { revealLinePinned(); setTimeout(() => showPreview(m.id), 120); },
      })),
    });
  }
  items.push(
    {
      label: '全部撕下', enabled: store.liveCount() > 0,
      // 破坏性操作保护：撕下前二次确认；绳上有图片时提示图片不会被归档
      click: async () => {
        if (store.liveCount() === 0) return;
        const { dialog } = require('electron');
        const hasImages = store.items.some(i => i.kind === 'image' && !i.falling);
        const r = await dialog.showMessageBox({
          type: 'warning', buttons: ['全部撕下', '取消'], defaultId: 1, cancelId: 1,
          message: '全部撕下？',
          detail: '便签将从绳上撕下' + (hasImages ? '，图片不会归档' : '') + '。',
        });
        if (r.response !== 0) return;
        store.clear();
      },
    },
    { type: 'separator' },
    { label: '偏好设置与快捷键...', click: showSettings },
    {
      label: '更多选项', submenu: [
        { label: '🔄 检查更新...', click: async () => { const r = await checkUpdate(); tray && tray.displayBalloon && tray.displayBalloon({ title: 'SunMemo 检查更新', content: r.status }); } },
        { label: '📤 导出便签备份...', click: exportMemos },
        { label: '📥 导入便签备份...', click: importMemos },
        { label: '📄 打开本地备份 (SunMemo.md)', click: () => sync.openInEditor() },
        { label: '📂 打开截图文件夹', click: () => shell.openPath(watchers.shotsFolder) },
        { label: '💡 欢迎与使用引导...', click: showWelcome },
        { label: 'ℹ️ 关于 SunMemo', click: () => {
          const { dialog } = require('electron');
          dialog.showMessageBox({
            type: 'info',
            title: '关于 SunMemo',
            message: `SunMemo · 晾想法 v${app.getVersion()} (Windows)`,
            detail: '把未完成的想法与待办，晾在桌面阳光下。\n\n完全参考 km-open-lab/SunMemo (macOS) 复刻。\nElectron ' + process.versions.electron + ' · 本地离线 · 隐私安全',
            buttons: ['打开项目主页', '确定'],
          }).then(r => { if (r.response === 0) shell.openExternal('https://github.com/km-open-lab/SunMemo'); });
        } },
        { type: 'separator' },
        {
          label: '自动挂上新复制的截图', type: 'checkbox', checked: store.settings.autoHang,
          click: item => setSetting('autoHang', item.checked),
        },
        {
          label: '声效', type: 'checkbox', checked: store.settings.soundOn,
          click: item => setSetting('soundOn', item.checked),
        },
        {
          label: '开机自启', type: 'checkbox',
          checked: app.getLoginItemSettings().openAtLogin,
          click: () => app.setLoginItemSettings({ openAtLogin: !app.getLoginItemSettings().openAtLogin }),
        },
      ]
    },
    { type: 'separator' },
    { label: '退出 SunMemo', accelerator: 'CmdOrCtrl+Q', click: () => { quitting = true; app.quit(); } },
  );
  return Menu.buildFromTemplate(items);
}

let traySig = '';
let recyclePage = 0;
function refreshTray() {
  if (!tray) return;
  // setContextMenu is a native shell call — only rebuild when something the
  // menu shows actually changed.
  const n = store ? store.liveCount() : 0;
  const memos = store.items.filter(i => i.kind === 'memo' && !i.falling);
  let todoTotal = 0, todoDone = 0;
  memos.forEach(m => { const st = calculateTodoStats(m.memo.text); todoTotal += st.total; todoDone += st.completed; });
  const sig = `${n}|${isRevealed}|${updateState && updateState.update}|${hkFailures.join(',')}|${store.settings.autoHang}|${store.settings.soundOn}|${recyclePage}|${sync.archived.length}|${todoTotal}/${todoDone}|${memos.map(m => m.memo.text.length + m.memo.text.slice(-6)).join(';')}`;
  const ver = 'v' + app.getVersion();
  tray.setToolTip(n > 0 ? `SunMemo · 晾想法 ${ver}（绳上 ${n} 条）` : `SunMemo · 晾想法 ${ver}`);
  if (sig === traySig) return;
  traySig = sig;
  tray.setContextMenu(buildTrayMenu());
}

function setSetting(key, value) {
  if (key === 'accent') delete store.settings.accentCustom; // R157: preset pick retires the custom color
  store.settings[key] = value;
  store.saveSettingsOnly();
  if (key === 'powerSave') {
    [lineWin, beaconWin].forEach(w => {
      if (w && !w.isDestroyed()) {
        try { w.webContents.executeJavaScript(`document.body.classList.toggle('power-save', ${!!value})`).catch(() => {}); } catch { /* ignore */ }
      }
    });
  }
  if (key === 'cardFont') {
    try { lineWin.webContents.executeJavaScript(`document.body.dataset.font = '${value}'`).catch(() => {}); } catch { /* ignore */ }
  }
  if (key === 'autoHang') watchers.autoHang = value;
  if (key === 'imgZoom') {
    try { lineWin.webContents.executeJavaScript(`document.body.classList.toggle('imgzoom', ${!!value})`).catch(() => {}); } catch { /* ignore */ }
  }
  if (key === 'compact') {
    try { lineWin.webContents.executeJavaScript(`document.body.classList.toggle('compact', ${!!value})`).catch(() => {}); } catch { /* ignore */ }
  }
  if (key === 'wind') {
    [lineWin].forEach(w => { if (w && !w.isDestroyed()) { try { w.webContents.send('wind', !!value); } catch { /* ignore */ } } });
  }
  if (key === 'volume') {
    // R139: keep the line renderer's ambient-wind gain in step with the volume setting.
    [lineWin].forEach(w => { if (w && !w.isDestroyed()) { try { w.webContents.send('settings-volume', value ?? 0.6); } catch { /* ignore */ } } });
  }
  if (key === 'accent') [lineWin, overlayWin, memoWin, searchWin, settingsWin, statsWin].forEach(w => {
    if (w && !w.isDestroyed() && w.isVisible !== undefined) {
      try { w.webContents.executeJavaScript(`document.documentElement.style.setProperty('--accent', '${({ sunrise: '#ff8f1f', mint: '#2fbf9f', sakura: '#f06292', sky: '#4a9ff5', grape: '#8b5cf6' })[value] || '#ff8f1f'}')`).catch(() => {}); } catch { /* ignore */ }
    }
  });
  // R157: custom accent color — broadcast the hex as-is, no table lookup.
  if (key === 'accentCustom') [lineWin, overlayWin, memoWin, searchWin, settingsWin, statsWin].forEach(w => {
    if (w && !w.isDestroyed() && w.isVisible !== undefined) {
      try { w.webContents.executeJavaScript(`document.documentElement.style.setProperty('--accent', '${value}')`).catch(() => {}); } catch { /* ignore */ }
    }
  });
  refreshTray();
}

// ---------------------------------------------------------------------------
// Demo data & screenshot runs (development / visual QA)
// ---------------------------------------------------------------------------

function seedDemo() {
  console.log('[seed] items before:', store.items.length);
  store.addMemo({ text: '# 🚀 项目待办冲刺\n- [ ] 优化 SunMemo 待办清单\n- [ ] 备份数据库与 **配置文件**\n- [x] 修复窗口排版对齐 #工作\n> 💡 支持 Markdown 语法与清单', color: 'green' });
  store.addMemo({ text: '## 灵感速记\n今晚写一篇关于「晾衣绳交互」的博客\n- [ ] 列提纲\n- [x] 找到配图 #灵感', color: 'pink' });
  store.addMemo({ text: '买咖啡豆 ☕️\n预约周五的羽毛球场地\n给妈妈打电话 #生活', color: 'yellow' });
  if (assets.demoShotPath) hangCapture(assets.demoShotPath, { flying: false });
  revealLinePinned();
  refreshTray();
}

async function runShots() {
  fs.mkdirSync(shotsDir, { recursive: true });
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const snap = async (win, name, tries = 3) => {
    for (let i = 0; i < tries; i++) {
      try {
        const img = await win.webContents.capturePage();
        if (!img.isEmpty()) {
          fs.writeFileSync(path.join(shotsDir, name), img.toPNG());
          console.log('[shots]', name);
          return;
        }
      } catch (e) { console.error('[shots]', name, e.message); }
      await sleep(900);
    }
    console.error('[shots]', name, 'gave up');
  };

  await sleep(2200);
  await snap(lineWin, '01-line.png');
  try {
    const probe = await lineWin.webContents.executeJavaScript(`(() => {
      const p = document.querySelector('.slot .peg');
      if (!p) return 'NO PEG ELEMENT';
      const r = p.getBoundingClientRect();
      const cs = getComputedStyle(p);
      return JSON.stringify({ x: r.x, y: r.y, w: r.width, h: r.height, bg: cs.backgroundImage.slice(0, 50), display: cs.display, opacity: cs.opacity, zIndex: cs.zIndex });
    })()`);
    console.log('[probe] peg:', probe);
  } catch (e) { console.log('[probe] failed:', e.message); }

  const first = store.items.find(i => i.kind === 'memo');
  if (first) {
    showPreview(first.id);
    await sleep(1400);
    await snap(overlayWin, '02-preview.png');
    closePreview();
  }
  await sleep(500);

  showQuickMemo(null);
  await sleep(900);
  if (memoWin) {
    memoWin.webContents.send('memo:demo-fill');
    await sleep(400);
    await snap(memoWin, '03-quickmemo.png');
    closeQuickMemo();
  }
  await sleep(400);

  showSettings();
  await sleep(1500);
  if (settingsWin) await snap(settingsWin, '04-settings.png');
  if (settingsWin) settingsWin.close();
  await sleep(600);

  showWelcome();
  await sleep(1500);
  if (welcomeWin) await snap(welcomeWin, '05-welcome.png');
  if (welcomeWin) welcomeWin.close();

  setTimeout(() => app.quit(), 600);
}

// ---------------------------------------------------------------------------
// Broadcast & serialization
// ---------------------------------------------------------------------------

// Thumbs are immutable per item, so each one crosses the process boundary
// only once; the line renderer caches the rest. Flights/previews force-include.
const thumbSent = new Set();

function serializeItem(item, forceThumb = false) {
  const sendThumb = item.thumb != null && (forceThumb || !thumbSent.has(item.id));
  if (item.thumb != null) thumbSent.add(item.id);
  return {
    id: item.id, kind: item.kind, tilt: item.tilt,
    url: item.url, // 文档阅读器/回收站等按原路径读文件（fileUrl 只是展示用别名）
    thumb: sendThumb ? item.thumb : null,
    thumbW: item.thumbW, thumbH: item.thumbH,
    memo: item.memo ? { ...item.memo } : null,
    docType: item.docType || null, docName: item.docName || '',
    docSize: item.docSize || 0, docMtime: item.docMtime || 0,
    flying: !!item.flying, falling: !!item.falling,
    desktop: item.desktop ? { ...item.desktop } : null,
    fileUrl: 'file://' + item.url.replace(/\\/g, '/'),
  };
}

function broadcast() {
  if (!lineWin || lineWin.isDestroyed()) return;
  const items = store.items.map(i => serializeItem(i));
  // Drop thumbSent entries for items that left the store, so the set (and the
  // renderer cache it guards) cannot grow without bound across a session.
  const live = new Set(store.items.map(i => i.id));
  for (const id of thumbSent) if (!live.has(id)) thumbSent.delete(id);
  lineWin.webContents.send('state', {
    items,
    revealed: isRevealed,
    copiedID,
    draggingID,
    pressedID,
    userPinned,
    agedIds: agedIdsNow(), // v1.8 沉降布局：闲置卡 id 集合（renderer 只做视图层排序）
  });
  // Keep an open hero preview in sync (todo toggles reflect immediately).
  if (previewOpen && previewCurrentId && overlayWin && !overlayWin.isDestroyed()) {
    const cur = store.find(previewCurrentId);
    if (cur && !cur.falling) {
      overlayWin.webContents.send('show-preview', {
        item: serializeItem(cur, true),
        peg: previewPeg || null,
        origin: previewOrigin || null,
        display: { x: 0, y: 0, width: overlayFit ? overlayFit.width : window_width(), height: overlayFit ? overlayFit.height : 800 },
        swap: true,
      });
    }
  }
  refreshTray();
  pushBeaconStats();
}

// v1.8 沉降布局：3 天（L.SINK_DAYS）没动的卡自动沉到绳尾。置顶便签永不沉；
// 图片/文档的龄期来自 config touches 表，memo 用自己的 touchedAt。
function agedIdsNow() {
  if (store.settings.sink === false) return [];
  const now = Date.now();
  const out = [];
  for (const i of store.items) {
    if (i.falling || i.desktop) continue;
    if (i.kind === 'memo' && i.memo.pinned) continue;
    if (L.ageDaysOf(i, store.touches, now) >= L.SINK_DAYS) out.push(i.id);
  }
  return out;
}

function window_width() { return 900; }

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

function setupIPC() {
  ipcMain.on('line:ready', () => broadcast());
  ipcMain.handle('gfx:mode', () => ({ software: isSoftwareRendering() }));
  ipcMain.on('line:hit', (_e, rects) => { hitRects = Array.isArray(rects) ? rects : []; });
  // (line:hot retired — see the click-through model note above.)

  ipcMain.on('line:open-preview', (_e, id) => { store.touch(id); showPreview(id); });
  ipcMain.on('line:open-editor', (_e, id) => { if (id) store.touch(id); showQuickMemo(id || null); });
  ipcMain.on('line:discard', (_e, id) => store.discard(id));
  ipcMain.on('line:copy', (_e, id) => { store.touch(id); store.copy(id); });
  ipcMain.on('line:toggle-done', (_e, id) => store.toggleMemoDone(id));
  ipcMain.on('line:undo-torn', () => { const id = store.undoTorn(); if (id) revealLinePinned(); });
  // v1.8 退场确认的「收进回忆板」：走 discard 管线（归档 + crumple 落下动画）
  ipcMain.on('line:archive-done', (_e, id) => store.discard(id));
  // R76: Markdown 引用格式构建（供右键菜单/预览共用）
function buildMdQuote(m) {
  const NL = String.fromCharCode(10);
  const d = new Date(m.createdAt);
  const pad = n => String(n).padStart(2, '0');
  const stamp = d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const colorName = { yellow: '暖阳黄', green: '薄荷绿', pink: '樱花粉', blue: '晴空蓝' }[m.color] || '暖阳黄';
  const body = String(m.text || '').split(NL).map(l => '> ' + l).join(NL);
  const title = String(m.text || '').split(NL)[0].replace(/^#+\s*/, '') || '便签';
  return '> **' + title + '**' + NL + '>' + NL + body + NL + '>' + NL + '> — SunMemo · ' + colorName + ' · ' + stamp;
}

// 便签导出为 PNG：离屏渲染卡片视觉 → capturePage → 存盘（窗口用完即毁）。
// 文件名取首行文本（清洗非法字符），取消选择则不做任何渲染。
async function exportMemoPng(id) {
  const item = store.find(id);
  if (!item || item.kind !== 'memo') return;
  const m = item.memo;
  const { dialog } = require('electron');
  const firstLine = String(m.text || '').split('\n')[0].replace(/^#+\s*/, '').trim();
  const safe = (firstLine || '便签').replace(/[\\/:*?"<>|\x00-\x1f]/g, '').replace(/\.+$/, '').trim().slice(0, 40) || '便签';
  const r = await dialog.showSaveDialog({
    title: '导出为图片',
    defaultPath: safe + '.png',
    filters: [{ name: 'PNG 图片', extensions: ['png'] }],
  });
  if (r.canceled || !r.filePath) return;
  try {
    const png = await renderMemoPng(m.text, m.color, { ratio: m.aspectRatio });
    fs.writeFileSync(r.filePath, png);
    store.play('blip', 0.5);
  } catch (e) { logError('export-png', e); }
}

// R70: 搜索窗勾选"含回收站" → 恢复归档便签 → 走 stats:restore
  // R70: 统计面板回收站恢复（reveal + welcome flash，同原 search:restore）
  ipcMain.on('stats:restore', (_e, archiveIndex) => {
    const nid = store.restoreArchived(archiveIndex);
    refreshTray();
    broadcast();
    if (nid) {
      revealLinePinned();
      setTimeout(() => { if (lineWin && !lineWin.isDestroyed()) lineWin.webContents.send('card-flash', nid); }, 350);
    }
  });
  // R71: 永久删除单条归档
  ipcMain.on('stats:delete-archive', (_e, archiveIndex) => {
    if (archiveIndex >= 0 && archiveIndex < sync.archived.length) {
      sync.archived.splice(archiveIndex, 1);
      sync.saveArchived();
      refreshTray();
      broadcast();
    }
  });
  ipcMain.on('beacon:click', (_e, pos) => {
    store.play('blip', 0.3);
    revealLinePinned();
    // R61: the little sun flies from the beacon into the rope (visual continuity)
    if (pos && lineBounds && lineWin && !lineWin.isDestroyed()) {
      const d = screen.getPrimaryDisplay();
      const scale = d.scaleFactor || 1;
      lineWin.webContents.send('beacon-fly', {
        fromX: pos.fromX / scale - lineBounds.x,
        fromY: pos.fromY / scale - lineBounds.y,
      });
    }
  });
  ipcMain.on('overlay:copy-md', (_e, id) => {
    const item = store.find(id);
    if (!item || item.kind !== 'memo') return;
    clipboard.writeText(buildMdQuote(item.memo));
  });
  ipcMain.on('overlay:save-as', async (_e, id) => {
    const item = store.find(id);
    if (!item || item.kind !== 'image') return;
    const { dialog } = require('electron');
    const r = await dialog.showSaveDialog({
      title: '另存为',
      defaultPath: item.url.split(/[\\/]/).pop(),
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
    });
    if (r.canceled || !r.filePath) return;
    try { fs.copyFileSync(item.url, r.filePath); store.play('blip', 0.5); } catch (e) { logError('save-as', e); }
  });
  // R92: renderer pulls the same payload broadcast() pushes — the recovery
  // path after a renderer crash/reload used to reject silently (dead white
  // line until the next state-changing event).
  ipcMain.handle('line:get-state', () => ({
    items: store.items.map(i => serializeItem(i)),
    revealed: isRevealed,
    copiedID,
    draggingID,
    pressedID,
    userPinned,
    agedIds: agedIdsNow(),
  }));
  // thumb 自愈：thumbSent 是「对 line 一次性」优化，但搜索/预览等任何窗口的
  // 强制序列化都会把额度烧掉，renderer reload 的竞态也可能错过唯一一次发送。
  // renderer 发现缺 thumb 时从这里拉，一行自愈，不再依赖广播时序。
  ipcMain.handle('line:thumb', (_e, id) => {
    const it = store.items.find(i => i.id === id);
    return it && it.thumb ? it.thumb : null;
  });
  // 文档卡内容读取（悬停阅读/预览/速记窗拖入共用）。文本 8MB 封顶、二进制
  // 64MB 封顶——悬停阅读是速览，超大文件走系统应用。
  ipcMain.handle('doc:load-text', async (_e, file) => {
    try {
      const st = await fs.promises.stat(file);
      if (st.size > 8 * 1024 * 1024) return { ok: false, err: '文件超过 8MB，请用系统应用打开' };
      return { ok: true, text: await fs.promises.readFile(file, 'utf8') };
    } catch (e) { return { ok: false, err: String(e && e.message || e) }; }
  });
  ipcMain.handle('doc:load', async (_e, file) => {
    try {
      const st = await fs.promises.stat(file);
      if (st.size > 64 * 1024 * 1024) return { ok: false, err: '文件超过 64MB，请用系统应用打开' };
      return { ok: true, buf: await fs.promises.readFile(file) };
    } catch (e) { return { ok: false, err: String(e && e.message || e) }; }
  });
  // 文档阅读器内的 http(s) 链接 → 系统浏览器（只放行这两种协议）
  ipcMain.on('doc:open-external', (_e, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      require('electron').shell.openExternal(url).catch(() => {});
    }
  });
  // 晾衣绳滚动偏移：renderer 拖拽/滚轮平移后上报，cardFrameFor 用它修正
  // 飞行落点/预览定位的屏幕坐标（绳不动、卡片沿绳滑）。
  ipcMain.on('line:scroll', (_e, x) => { lineScrollX = Number(x) || 0; });
  // R92: renderer-side rope-zone hover. Complements the OS-cursor tracking:
  // on the mixed-DPI secondary display getCursorScreenPoint coords can
  // misalign with getBounds, retracting the line while a card is hovered.
  ipcMain.on('line:hot', (_e, hot) => { rendererHot = !!hot; });
  ipcMain.on('line:toggle-userpin', () => {
    userPinned = !userPinned;
    if (userPinned) revealLinePinned();
    updateBeacon();
    broadcast();
  });
  // R94: files dropped onto the rope. Images hang as photo cards; md/txt/pdf/
  // docx/ppt/xls hang as document cards (v1.6). store.hang() rejects anything
  // else gracefully.
  ipcMain.on('line:drop-file', (_e, file) => {
    if (!file) return;
    if (docTypeOf(file)) {
      const before = store.liveCount();
      hangCapture(file, { flying: false });
      if (store.liveCount() > before) return;
      store.play('beep', 0.4);
      lineWin && !lineWin.isDestroyed() && lineWin.webContents.send('hint-toast', '文档打不开（可能已被移动或删除）');
      return;
    }
    // hangCapture has no return value — compare liveCount before/after as the
    // success signal. A drop that hangs nothing must not vanish silently.
    const before = store.liveCount();
    hangCapture(file, { flying: false });
    if (store.liveCount() === before) {
      store.play('beep', 0.4);
      lineWin && !lineWin.isDestroyed() && lineWin.webContents.send('hint-toast', '暂不支持该类型的文件（支持图片与常见文档）');
    }
  });
  // v1.6 拖到信标太阳上 = 直接挂绳（绳收起时的投递口）；成功即展开绳看新卡
  ipcMain.on('beacon:drop-files', (_e, files) => {
    if (!Array.isArray(files) || !files.length) return;
    let hung = 0;
    for (const file of files) {
      if (!file || typeof file !== 'string') continue;
      const before = store.liveCount();
      hangCapture(file, { flying: false });
      if (store.liveCount() > before) hung++;
    }
    if (hung > 0) {
      revealLinePinned();
      if (tray && tray.displayBalloon) {
        try { tray.displayBalloon({ title: '已挂上晾衣绳', content: '拖入了 ' + hung + ' 个文件', icon: assets.icon32 }); } catch { /* ignore */ }
      }
    } else {
      store.play('beep', 0.4);
    }
  });
  ipcMain.on('line:toggle-pinned', (_e, id) => store.toggleMemoPinned(id));
  ipcMain.on('line:reorder', (_e, { id, toIndex }) => { store.reorder(id, toIndex); store.touch(id); });
  // 卡片角度持久化：重排/摆弄后 renderer 把新角度落库（store.setTilt）。
  ipcMain.on('line:set-tilt', (_e, { id, tilt }) => store.setTilt(id, tilt));
  ipcMain.on('line:toggle-ratio', (_e, { id, ratio }) => store.updateMemoAspectRatio(id, ratio));
  ipcMain.on('line:toggle-todo', (_e, { id, lineIndex }) => store.toggleMemoTodoLine(id, lineIndex));
  ipcMain.on('line:hang-clipboard', () => {
    // R100: a bare beep read as a dead button — say what's missing.
    if (watchers.hangCurrentClipboard(store)) return;
    store.play('beep', 0.4);
    const fmt = (() => { try { return clipboard.availableFormats().join(', '); } catch { return ''; } })();
    lineWin && !lineWin.isDestroyed() && lineWin.webContents.send('hint-toast', fmt.includes('image') ? '剪贴板图片正在处理…' : '剪贴板里没有图片（当前: ' + (fmt || '空') + '）');
  });
  ipcMain.on('line:settings', () => showSettings());
  ipcMain.on('line:reveal', id => store.reveal(id));
  // R150: 空格临时预览 —— 4 秒 peek，之后走常规自动收回（peekUntil 挡住收回判定）。
  ipcMain.on('line:peek', () => reveal({ peekFor: 4 }));
  // R164: Esc on the rope page tucks it away (user expectation from previews)
  ipcMain.on('line:toggle', () => toggle());
  ipcMain.on('line:open', id => store.open(id));
  ipcMain.on('line:trash', (_e, id) => store.trash(id)); // R186: 曾缺 _e（首参是 event）——移到回收站永不命中
  // 标记 — the Windows stand-in for macOS Markup: open the image in MS Paint.
  ipcMain.on('line:markup', (_e, id) => {
    const item = store.find(id);
    if (!item || item.kind !== 'image') return;
    // R100: mspaint's own launch is slow — say so immediately, silence reads
    // as "the button is dead".
    lineWin && !lineWin.isDestroyed() && lineWin.webContents.send('hint-toast', '画图中打开图片…（首次启动稍慢）');
    try {
      const { spawn } = require('child_process');
      spawn('mspaint', [item.url], { detached: true, stdio: 'ignore' }).unref();
    } catch { store.open(id); }
  });
  // R99: drag a card off the rope onto the desktop → it becomes a floating
  // sticky note at the drop point (Windows stand-in for the macOS tear-off).
  // Releasing inside the strip snaps back; closing the sticky returns the
  // card to the line. The item stays in the store the whole time.
  const stickies = new Map();
  function createSticky(item) {
    if (stickies.has(item.id) && !stickies.get(item.id).isDestroyed()) return;
    const wide = item.kind === 'image' ? Math.min(420, (item.thumbW || 360) + 48) : 360;
    const high = item.kind === 'image' ? Math.min(460, (item.thumbH || 300) * (wide / (item.thumbW || 360)) + 56) : 280;
    // 落点在哪个屏就按哪个屏的 workArea 钳制 —— 用 lastLineDisplay 会把
    // 副屏拖放的便签硬拽回主屏（跨屏钳制错误）。
    const pd = screen.getDisplayNearestPoint({ x: Math.round(item.desktop.x), y: Math.round(item.desktop.y) }) || screen.getPrimaryDisplay();
    const wa = pd.workArea;
    const x = Math.max(wa.x + 8, Math.min(item.desktop.x - wide / 2, wa.x + wa.width - wide - 8));
    const y = Math.max(wa.y + 8, Math.min(item.desktop.y - 24, wa.y + wa.height - high - 8));
    const win = new BrowserWindow({
      x: Math.round(x), y: Math.round(y), width: Math.round(wide), height: Math.round(high),
      frame: false, transparent: true, resizable: true, skipTaskbar: true, hasShadow: false,
      alwaysOnTop: true, title: '桌面便签', icon: assets.icon32,
      webPreferences: { preload: PRELOAD, contextIsolation: true, nodeIntegration: false, additionalArguments: ['--sticky-id=' + item.id] },
    });
    win.setAlwaysOnTop(true, 'floating');
    win.loadFile(path.join(__dirname, 'renderer', 'sticky', 'sticky.html'), { search: 'id=' + encodeURIComponent(item.id) });
    stickies.set(item.id, win);
    win.on('closed', () => {
      if (stickies.get(item.id) === win) stickies.delete(item.id);
    });
  }
  ipcMain.on('line:tear-to-desktop', (_e, { id, x, y }) => {
    const item = store.find(id);
    if (!item || item.falling) return;
    item.desktop = { x: Math.round(x), y: Math.round(y) };
    store.play('tink', 0.3);
    broadcast();
    createSticky(item);
  });
  ipcMain.handle('sticky:data', (_e, id) => {
    const item = store.find(id);
    return item ? serializeItem(item, true) : null;
  });
  ipcMain.on('sticky:return', (_e, id) => {
    const item = store.find(id);
    if (item) { delete item.desktop; broadcast(); revealLinePinned(); }
    const w = stickies.get(id);
    if (w && !w.isDestroyed()) w.close();
  });
  ipcMain.on('sticky:hide', (_e, id) => {
    const w = stickies.get(id);
    if (w && !w.isDestroyed()) w.hide();
  });
  ipcMain.on('sticky:save-text', (_e, { id, text }) => {
    if (!text || !String(text).trim()) return;
    store.updateMemo(id, { text: String(text) });
    broadcast();
  });
  // R151: 便签右键菜单 —— 置顶切换（状态记在 win._ontop）/ 半透明 1↔0.75 切换。
  ipcMain.on('sticky:ontop', (_e, { id, on }) => {
    const w = stickies.get(id);
    if (!w || w.isDestroyed()) return;
    w._ontop = !!on;
    w.setAlwaysOnTop(!!on);
  });
  ipcMain.on('sticky:opacity', (_e, { id }) => {
    const w = stickies.get(id);
    if (!w || w.isDestroyed()) return;
    w.setOpacity((w.getOpacity() || 1) > 0.9 ? 0.75 : 1);
  });
  ipcMain.on('line:drag', (_e, { id, icon }) => {
    const item = store.find(id);
    if (!item) return;
    draggingID = id;
    broadcast();
    const { webContents } = require('electron');
    lineWin.webContents.startDrag({
      file: item.url,
      icon: icon ? nativeImage.createFromDataURL(icon) : assets.icon32,
    });
    setTimeout(() => { draggingID = null; store.prune(); broadcast(); }, 800);
  });
  ipcMain.on('line:menu', (_e, id) => {
    const item = store.find(id);
    if (!item) return;
    store.touch(id); // v1.8: 唤出菜单即视为"动了它"
    const template = item.kind === 'memo' ? [
      ...(calculateTodoStats(item.memo.text).total > 0 && calculateTodoStats(item.memo.text).completed === calculateTodoStats(item.memo.text).total
        ? [{ label: '🎉 全部待办已完成', enabled: false }]
        : []),
      { label: '查看完整便签', click: () => showPreview(id) },
      { label: '复制便签文本', click: () => store.copy(id) },
      { label: '复制为 MD 引用', click: () => clipboard.writeText(buildMdQuote(item.memo)) },
      { label: '导出为图片...', click: () => exportMemoPng(id) },
      { label: item.memo.isDone ? '标记为未完成' : '标记为已完成', click: () => store.toggleMemoDone(id) },
      { label: item.memo.pinned ? '取消置顶' : '📌 置顶', click: () => store.toggleMemoPinned(id) },
      { label: '编辑便签', click: () => showQuickMemo(id) },
      {
        label: '切换比例', submenu: [
          { label: '▭ 宽版 (16:10)', click: () => store.updateMemoAspectRatio(id, 'wide') },
          { label: '□ 方版 (1:1)', click: () => store.updateMemoAspectRatio(id, 'square') },
          { label: '▯ 竖版 (3:4)', click: () => store.updateMemoAspectRatio(id, 'tall') },
        ]
      },
      { type: 'separator' },
      { label: '在资源管理器中显示', click: () => store.reveal(id) },
      { type: 'separator' },
      { label: '撕下便签', click: () => store.discard(id) },
    ] : [
      { label: '放大查看', click: () => showPreview(id) },
      { label: '复制图片', click: () => store.copy(id) },
      { label: '打开图片', click: () => store.open(id) },
      { label: '标记 (画图)', click: () => { try { require('child_process').spawn('mspaint', [item.url], { detached: true, stdio: 'ignore' }).unref(); } catch { store.open(id); } } },
      { type: 'separator' },
      { label: '在资源管理器中显示', click: () => store.reveal(id) },
      { type: 'separator' },
      { label: '移到回收站', click: () => store.trash(id) },
    ];
    // lineWin 常态 focusable:false（WS_EX_NOACTIVATE，永不抢焦点）。Windows 的
    // TrackPopupMenu 要求属主窗口处于前台，否则菜单在同一帧内被系统吞掉——
    // 右键菜单在绳上从未真正出现过。借焦点弹菜单，popup 的关闭回调里立即归还。
    try { lineWin.setFocusable(true); lineWin.focus(); } catch { /* ignore */ }
    Menu.buildFromTemplate(template).popup({
      window: lineWin,
      callback: () => {
        try { lineWin.blur(); lineWin.setFocusable(false); } catch { /* ignore */ }
      },
    });
  });

  // Overlay (hero preview / flights)
  ipcMain.on('overlay:close', () => closePreview());
  ipcMain.on('overlay:edit', (_e, id) => { closePreview(); showQuickMemo(id); });
  ipcMain.on('overlay:discard', (_e, id) => { closePreview(); store.discard(id); });
  ipcMain.on('overlay:trash', (_e, id) => { closePreview(); store.trash(id); });
  ipcMain.on('overlay:copy', (_e, id) => store.copy(id));
  // inline edit inside the hero preview
  ipcMain.on('overlay:inline-save', (_e, { id, text }) => {
    if (!id || !text || !text.trim()) return;
    store.updateMemo(id, { text: text.trim() });
  });
  ipcMain.on('overlay:toggle-ratio', (_e, { id, ratio }) => store.updateMemoAspectRatio(id, ratio));
  ipcMain.on('overlay:toggle-todo', (_e, { id, lineIndex }) => {
    try { fs.appendFileSync(path.join(app.getPath('userData'), 'toggle-trace.log'), Date.now() + ' toggle ' + id + ' line=' + lineIndex + '\n'); } catch { /* ignore */ }
    store.toggleMemoTodoLine(id, lineIndex);
  });
  // ↑/↓ in the hero preview cycles through the memos on the line.
  ipcMain.on('overlay:nav', (_e, dir) => {
    const memos = store.items.filter(i => i.kind === 'memo' && !i.falling);
    if (memos.length < 2) return;
    const idx = Math.max(0, memos.findIndex(m => m.id === previewCurrentId));
    const next = memos[(idx + (dir > 0 ? 1 : memos.length - 1)) % memos.length];
    const to = cardFrameFor(next.id);
    if (!to) return;
    previewCurrentId = next.id;
    overlayWin.webContents.send('show-preview', {
      item: serializeItem(next, true),
      peg: { x: to.cx - overlayFit.x, y: (to.ropeTop - lineBounds.y) + L.PIN_ABOVE + 2 },
      origin: { x: to.x - overlayFit.x, y: to.y - overlayFit.y, w: to.w, h: to.h },
      display: { x: 0, y: 0, width: overlayFit.width, height: overlayFit.height },
      swap: true,
    });
  });

  // Quick memo window
  ipcMain.on('memo:save', (_e, { text, color, aspectRatio }) => {
    const editingId = memoWin && memoWin._editingId;
    const from = memoWin ? memoWin.getBounds() : null;
    closeQuickMemo();
    if (editingId) {
      store.updateMemo(editingId, { text, color, aspectRatio });
      revealLinePinned();
    } else {
      hangMemoFlight({ text, color, aspectRatio }, from);
    }
  });
  ipcMain.on('memo:cancel', () => closeQuickMemo());
  ipcMain.on('memo:draft-save', (_e, payload) => { store.setDraft(payload.text); });
  ipcMain.on('memo:draft-clear', () => { store.setDraft(''); });
  ipcMain.on('memo:ratio', (_e, ratio) => resizeMemoWindow(ratio));
  ipcMain.on('memo:open-md', () => sync.openInEditor());

  // Search window
  ipcMain.handle('stats:data', () => {
    const memos = store.items.filter(i => i.kind === 'memo' && !i.falling);
    const todos = { total: 0, done: 0 };
    memos.forEach(m => { const st = calculateTodoStats(m.memo.text); todos.total += st.total; todos.done += st.completed; });
    const weekAgo = Date.now() - 7 * 86400000;
    const tornThisWeek = sync.archived.filter(a => new Date(a.tornDownAt).getTime() > weekAgo).length;
    const recentTorn = sync.archived.map(a => a.tornDownAt);
    const prevWeekAgo = Date.now() - 14 * 86400000;
    const prevTorn = sync.archived
      .filter(a => { const t = new Date(a.tornDownAt).getTime(); return t > prevWeekAgo && t <= weekAgo; })
      .map(a => a.tornDownAt);
    const recentArchived = sync.archived.slice(0, 6).map((a, i) => ({
      index: i,
      text: String(a.text || '').split(String.fromCharCode(10))[0].slice(0, 30),
      time: String(a.tornDownAt || '').slice(0, 10),
    }));
    return {
      onLine: memos.length,
      images: store.items.filter(i => i.kind === 'image' && !i.falling).length,
      todos,
      archived: sync.archived.length,
      tornThisWeek,
      archivedAll: sync.archived.length,
      recentTorn,
      prevTorn,
      recentArchived,
    };
  });
  // R152: 搜索结果含图片（renderer 按 memo 前图片后分组展示）
  ipcMain.handle('search:data', () => ({
    items: store.items.filter(i => (i.kind === 'memo' || i.kind === 'image') && !i.falling).map(i => serializeItem(i, true)),
  }));
  ipcMain.on('search:close', () => {
    if (searchWin && !searchWin.isDestroyed()) searchWin.close();
    // 关闭搜索后视线回归：若晾衣绳展开着，把它带回最前（R65）
    if (isRevealed && lineWin && !lineWin.isDestroyed()) lineWin.moveTop();
  });
  ipcMain.on('search:open-tag', (_e, tag) => {
    if (searchWin && !searchWin.isDestroyed()) searchWin.close();
    showSearch();
    setTimeout(() => { if (searchWin && !searchWin.isDestroyed()) searchWin.webContents.send('search:set-tag', tag); }, 350);
  });
  ipcMain.on('search:set-tag', (_e, tag) => {
    if (searchWin && !searchWin.isDestroyed()) searchWin.webContents.send('search:set-tag', tag);
  });
  ipcMain.on('search:open', (_e, id) => {
    if (searchWin && !searchWin.isDestroyed()) searchWin.close();
    revealLinePinned();
    setTimeout(() => showPreview(id), 120);
  });
  ipcMain.on('search:edit', (_e, id) => {
    if (searchWin && !searchWin.isDestroyed()) searchWin.close();
    showQuickMemo(id);
  });

  // Settings
  ipcMain.handle('settings:data', () => ({
    settings: store.settings,
    version: app.getVersion(),
    login: app.getLoginItemSettings().openAtLogin,
    iconPath: 'file://' + String(assets.iconPath).replace(/\\/g, '/'),
    hotkeyStatus: hkFailures.length ? `⚠ 注册失败（可能被其他程序占用）：${hkFailures.join('、')}` : '',
  }));
  ipcMain.on('settings:set', (_e, { key, value }) => setSetting(key, value));
  ipcMain.on('settings:hotkeys', (_e, hotkeys) => {
    store.settings.hotkeys = { ...store.settings.hotkeys, ...hotkeys };
    store.saveSettingsOnly();
    registerHotkeys();
    refreshTray();
  });
  ipcMain.on('settings:reset-hotkeys', () => {
    store.settings.hotkeys = { toggle: 'Control+Alt+Space', memo: 'Control+Alt+N', paste: 'Control+Alt+V' };
    store.saveSettingsOnly();
    registerHotkeys();
    refreshTray();
  });
  ipcMain.on('settings:login', (_e, on) => app.setLoginItemSettings({ openAtLogin: !!on }));
  // R92: the settings window's relaunch button used to be a dead send —
  // the receiver never existed, so toggles needing a restart did nothing.
  ipcMain.on('settings:relaunch', () => { app.relaunch(); app.quit(); });
  ipcMain.handle('settings:check-update', async () => {
    const r = await checkUpdate();
    updateState = r;
    refreshTray();
    return r;
  });

  // Welcome
  ipcMain.on('welcome:done', (_e, { takeover }) => {
    store.settings.welcomed = true;
    store.settings.inboxOffered = true;
    store.settings.takeover = !!takeover;
    store.settings.autoHang = !!takeover;
    store.saveSettingsOnly();
    if (welcomeWin) welcomeWin.close();
    watchers.autoHang = !!takeover;
    refreshTray();
    revealLinePinned();
  });
}

// ---- 导出 / 导入全部便签 ----
function exportMemos() {
  const { dialog } = require('electron');
  const memos = store.items.filter(i => i.kind === 'memo' && !i.falling).map(i => ({ ...i.memo }));
  const archived = sync.archived;
  dialog.showSaveDialog({
    title: '导出便签备份',
    defaultPath: 'SunMemo-Backup-' + new Date().toISOString().slice(0, 10) + '.json',
    filters: [{ name: 'JSON', extensions: ['json'] }],
  }).then(r => {
    if (r.canceled || !r.filePath) return;
    fs.writeFileSync(r.filePath, JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), memos, archived }, null, 2));
    store.play('blip', 0.5);
  });
}

function importMemos() {
  const { dialog } = require('electron');
  dialog.showOpenDialog({
    title: '导入便签备份',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile'],
  }).then(r => {
    if (r.canceled || !r.filePaths[0]) return;
    try {
      const data = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
      const list = Array.isArray(data) ? data : (data.memos || []);
      let n = 0;
      for (const m of list) {
        if (m && m.text) { store.addMemo({ text: m.text, color: m.color || 'yellow', aspectRatio: m.aspectRatio || 'wide' }); n++; }
      }
      revealLinePinned();
      refreshTray();
      console.log('[import] added ' + n);
    } catch (e) { console.log('[import] failed:', e.message); }
  });
}

async function checkUpdate() {
  try {
    const res = await fetch('https://api.github.com/repos/km-open-lab/SunMemo/releases/latest', {
      headers: { 'User-Agent': 'SunMemo-Windows' }, signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const latest = String(data.tag_name || '').replace(/^v/, '');
    const current = app.getVersion();
    if (latest && latest !== current) {
      return { update: true, latest, status: `✨ 发现新版本 v${latest}（当前 v${current}）` };
    }
    return { update: false, status: `已是最新版本 v${current} ✅` };
  } catch (e) {
    return { update: false, status: '检查更新失败：' + e.message };
  }
}
