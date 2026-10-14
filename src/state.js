'use strict';
// Port of Line.swift — the line itself: what hangs on it and what you can do
// with each item. The files never move; the line is only a view onto them.

const fs = require('fs');
const path = require('path');
const { nativeImage } = require('electron');
const { uuid, calculateTodoStats, toggleTodoLine } = require('./sync');

// 挂绳文档类型 → 卡片 docType。md/txt 全文内读；pdf 走 PDF.js；docx 走
// docx-preview；ppt/xls 等无可靠轻量渲染器 → 精致类型板式卡（悬停信息面板）。
const DOC_TYPES = {
  md: 'md', markdown: 'md', txt: 'txt', log: 'txt', csv: 'txt',
  pdf: 'pdf', docx: 'docx', doc: 'doc', pptx: 'ppt', ppt: 'ppt', xlsx: 'xls', xls: 'xls',
};
function docTypeOf(file) {
  const m = /\.(md|markdown|txt|log|csv|pdf|docx|doc|pptx|ppt|xlsx|xls)$/i.exec(file);
  return m ? DOC_TYPES[m[1].toLowerCase()] : null;
}

class LineStore {
  constructor({ memosFolder, configPath }) {
    this.memosFolder = memosFolder;
    this.configPath = configPath;
    this.items = [];            // { id, kind:'memo'|'image'|'doc', url, tilt, flying, falling, memo:{...}, thumb, thumbW, thumbH, docType, docName, docSize, docMtime }
    this.maxItems = 35;
    this.onFall = null;         // (item) => void  (falling animation hook)
    this.onChange = null;       // () => void     (broadcast hook)
    this.onSound = null;        // (name, volume) => void
    this.onSync = null;         // (items) => void
    this.onAllDone = null;      // (item) => void  v1.8 退场钩子：一张便签全部打勾的瞬间
    this.isInternalCopy = false;
    this.syncRef = null; // set by main: lets restoreArchived reach the archive

    this.settings = {
      soundOn: true,
      volume: 0.6,
      accent: 'sunrise',
      powerSave: false,
      wind: false,
      cardFont: 'md',
      compact: false,
      gpuSoftware: true, // this machine's GPU driver TDRs under transparent-window load
      hangNotify: false,
      beacon: true,
      autoHang: false,
      imgZoom: true, // R206+: 悬停图片自动放大（苹果式弹簧缩放，可在设置关闭）
      sink: true,    // v1.8 沉降布局：闲置 3 天的卡片自动沉到绳尾（设置可关）
      autoUpdate: true,
      welcomed: false,
      inboxOffered: false,
      takeover: false,
      hotkeys: {
        toggle: 'Control+Alt+Space',
        memo: 'Control+Alt+N',
        paste: 'Control+Alt+V',
      },
    };
    this.peggedPaths = [];
    // 卡片角度持久化：照片是外部文件不能回写，角度按路径存 config.json 的
    // tilts 表（memo 的角度直接写进各自 json，不走这张表）。
    this.tilts = {};
    // v1.8 沉降布局：图片/文档卡的"最近触达"表（url → ms）。memo 的触达时间
    // 就在自己的 touchedAt 里，不需要这张表。交互（预览/打开/复制/悬停阅读）
    // 经 touch() 更新，沉降龄期据此归零。
    this.touches = {};
    this.loadConfig();
  }

  // ---- config persistence -------------------------------------------------

  loadConfig() {
    for (const candidate of [this.configPath, this.configPath + '.bak']) {
      try {
        const raw = JSON.parse(fs.readFileSync(candidate, 'utf8'));
        if (Array.isArray(raw.pegged)) this.peggedPaths = raw.pegged;
        if (raw.tilts && typeof raw.tilts === 'object') this.tilts = raw.tilts;
        if (raw.touches && typeof raw.touches === 'object') this.touches = raw.touches;
        if (raw.settings) Object.assign(this.settings, raw.settings);
        if (raw.settings && raw.settings.hotkeys) Object.assign(this.settings.hotkeys, raw.settings.hotkeys);
        return;
      } catch { /* try next / first launch */ }
    }
  }

  // Atomic write (tmp + rename) so a crash mid-write can never leave a
  // corrupt config; the previous good copy is kept as .bak.
  writeJsonAtomic(file, data) {
    const tmp = file + '.tmp';
    try {
      if (fs.existsSync(file)) fs.copyFileSync(file, file + '.bak');
      fs.writeFileSync(tmp, data);
      fs.renameSync(tmp, file);
    } catch {
      try { fs.writeFileSync(file, data); } catch { /* best effort */ }
    }
  }

  save() {
    this.peggedPaths = this.items.filter(i => !i.falling).map(i => i.url);
    this.scheduleConfigSave();
    this.scheduleSync();
    if (this.onChange) this.onChange();
  }

  // The config write is a trailing ~400ms debounce so bursty mutations
  // (hang, drop, checklist toggling) cost one config write, not four sync
  // IOs (existsSync+copyFileSync+writeFileSync+renameSync) per change.
  scheduleConfigSave() {
    clearTimeout(this._configTimer);
    this._configTimer = setTimeout(() => {
      this._configTimer = null;
      this.saveConfigNow();
    }, 400);
  }

  // tilts 表只留当前还挂着的照片，掉落/删除的照片条目随之清掉。
  photoTilts() {
    const out = {};
    for (const i of this.items) {
      if (i.kind === 'image' && this.tilts[i.url] != null) out[i.url] = this.tilts[i.url];
    }
    return out;
  }

  // touches 表同理只留在绳条目（图片/文档），离绳即清。
  liveTouches() {
    const out = {};
    for (const i of this.items) {
      if (i.kind !== 'memo' && this.touches[i.url] != null) out[i.url] = this.touches[i.url];
    }
    return out;
  }

  saveConfigNow() {
    const payload = { pegged: this.peggedPaths, settings: this.settings, tilts: this.photoTilts(), touches: this.liveTouches() };
    try {
      fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
      this.writeJsonAtomic(this.configPath, JSON.stringify(payload, null, 2));
    } catch { /* best effort */ }
  }

  // The markdown backup is rebuilt on a short trailing debounce so bursty
  // mutations (clear, checklist toggling) write the two md files once.
  scheduleSync() {
    clearTimeout(this._syncTimer);
    this._syncTimer = setTimeout(() => { if (this.onSync) this.onSync(this.items); }, 400);
  }

  flushSync() {
    clearTimeout(this._syncTimer);
    if (this.onSync) this.onSync(this.items);
    // Cancel any pending debounced config write and perform it synchronously,
    // so before-quit's flushSync() never loses the last change.
    if (this._configTimer) {
      clearTimeout(this._configTimer);
      this._configTimer = null;
      this.saveConfigNow();
    }
  }

  saveSettingsOnly() {
    const payload = { pegged: this.peggedPaths, settings: this.settings, tilts: this.photoTilts(), touches: this.liveTouches() };
    try {
      fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
      this.writeJsonAtomic(this.configPath, JSON.stringify(payload, null, 2));
    } catch { /* best effort */ }
  }

  // ---- thumbnails ----------------------------------------------------------

  makeThumb(file, maxPixels = 480) {
    try {
      const img = nativeImage.createFromPath(file);
      if (img.isEmpty()) return null;
      const size = img.getSize();
      // Huge sources (e.g. 8K screenshots): downsample to a 4096 long-edge cap
      // before the thumbnail math. resize({width}) keeps aspect, so pick the
      // width that lands the long edge on 4096 (never upscales the short side).
      let work = img;
      if (size.width > 4096 || size.height > 4096) {
        work = img.resize({ width: Math.round(4096 * size.width / Math.max(size.width, size.height)) });
      }
      const scale = Math.min(1, maxPixels / Math.max(size.width, size.height));
      const thumb = scale < 1 ? work.resize({ width: Math.round(size.width * scale) }) : work;
      return { dataURL: thumb.toDataURL(), w: size.width, h: size.height };
    } catch { return null; }
  }

  // ---- restore / prune ------------------------------------------------------

  restore() {
    const loaded = new Set();
    for (const p of this.peggedPaths) {
      if (!fs.existsSync(p)) continue;
      this.hang(p, { quietly: true });
      loaded.add(p);
    }
    // Crash-recovery: scan the Memos folder for orphaned memo json files.
    try {
      for (const f of fs.readdirSync(this.memosFolder)) {
        if (!f.toLowerCase().endsWith('.json') || f.startsWith('archived_')) continue;
        const full = path.join(this.memosFolder, f);
        if (!loaded.has(full)) this.hang(full, { quietly: true });
      }
    } catch { /* no folder yet */ }
    if (this.onSync) this.onSync(this.items);
  }

  prune() {
    for (const item of [...this.items]) {
      if (!item.flying && !fs.existsSync(item.url)) this.drop(item.id, { quietly: true });
    }
  }

  // ---- hanging ----------------------------------------------------------------

  hang(file, { quietly = false, flying = false } = {}) {
    const url = path.resolve(file);
    if (this.items.some(i => i.url === url && !i.falling)) return null;

    let item;
    if (url.toLowerCase().endsWith('.json')) {
      try {
        const memo = JSON.parse(fs.readFileSync(url, 'utf8'));
        item = {
          id: memo.id || uuid(), kind: 'memo', url,
          // 卡片记得自己的角度：json 里存过 tilt 就原样恢复，别重新随机。
          tilt: typeof memo.tilt === 'number' ? clampTilt(memo.tilt) : rand(-2.5, 2.5),
          flying, falling: false,
          memo: {
            text: memo.text || '', color: memo.color || 'yellow',
            isDone: !!memo.isDone, createdAt: memo.createdAt || new Date().toISOString(),
            aspectRatio: memo.aspectRatio || 'wide',
          },
        };
      } catch { return null; }
    } else if (docTypeOf(url)) {
      // 文档卡：不拷贝不改动，原文件挂在原位，绳只是视图。
      let st = null;
      try { st = fs.statSync(url); } catch (e) { if (process.env.SUNMEMO_DOC_TRACE) console.log('[doc] stat fail', url, e.message); return null; }
      if (process.env.SUNMEMO_DOC_TRACE) console.log('[doc] hang', docTypeOf(url), path.basename(url));
      item = {
        id: uuid(), kind: 'doc', url,
        tilt: this.tilts[url] != null ? clampTilt(this.tilts[url]) : rand(-2.5, 2.5),
        flying, falling: false,
        docType: docTypeOf(url),
        docName: path.basename(url),
        docSize: st.size,
        docMtime: st.mtimeMs,
      };
      if (this.touches[url] == null) this.touches[url] = Date.now();
    } else {
      const thumb = this.makeThumb(url);
      if (!thumb) return null;
      item = {
        id: uuid(), kind: 'image', url,
        tilt: this.tilts[url] != null ? clampTilt(this.tilts[url]) : rand(-2.5, 2.5),
        flying, falling: false,
        thumb: thumb.dataURL, thumbW: thumb.w, thumbH: thumb.h,
      };
      if (this.touches[url] == null) this.touches[url] = Date.now();
    }
    this.items.push(item);
    this.sortLine();

    // Only drop the oldest *screenshot* when capacity is exceeded. Never auto-drop memos!
    while (this.liveCount() > this.maxItems) {
      const oldest = this.items.find(i => !i.falling && i.kind !== 'memo');
      if (!oldest) break;
      this.drop(oldest.id, { quietly: true });
    }
    this.save();
    if (!quietly) this.play('tink', 0.35);
    return item.id;
  }

  addMemo({ text, color = 'yellow', aspectRatio = 'wide', flying = false, source = 'manual' }) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return null;

    const id = uuid();
    const tilt = rand(-2.5, 2.5);
    const nowIso = new Date().toISOString();
    const memo = { text: trimmed, color, isDone: false, createdAt: nowIso, aspectRatio, source, touchedAt: nowIso };
    fs.mkdirSync(this.memosFolder, { recursive: true });
    const file = path.join(this.memosFolder, `memo_${id}.json`);
    fs.writeFileSync(file, JSON.stringify({ id, tilt, ...memo }, null, 2));

    const item = { id, kind: 'memo', url: file, tilt, flying, falling: false, memo };
    this.items.push(item);
    this.sortLine();
    this.save(); // memos are never auto-dropped
    this.draft = ''; // committed - clear the draft
    if (!flying) {
      // R49: pitch follows the card colour (yellow/green/pink/blue → low→high)
      const PITCH = { yellow: 1, green: 1.12, pink: 1.25, blue: 1.4 };
      this.play('tink', 0.35, PITCH[color] || 1);
    }
    if (this.onHangNotify) this.onHangNotify(String(text).split(String.fromCharCode(10))[0].slice(0, 30));
    return id;
  }

  // ---- memo operations ---------------------------------------------------------

  // v1.8 沉退布局的触达入口：预览/打开/复制/悬停阅读/重排等交互都会调到这里。
  // memo 刷新各自 json 的 touchedAt（晒褪色同一来源）；图片/文档写 config 的
  // touches 表。只广播 + 落盘，不重写 SunMemo.md（内容没变）。
  touch(id) {
    const item = this.find(id);
    if (!item || item.falling) return;
    if (item.kind === 'memo') {
      item.memo.touchedAt = new Date().toISOString();
      this.writeMemoFile(item);
    } else {
      this.touches[item.url] = Date.now();
      this.scheduleConfigSave();
    }
    if (this.onChange) this.onChange();
  }

  updateMemo(id, { text, color, aspectRatio }) {
    const item = this.find(id);
    if (!item || item.kind !== 'memo') return;
    const trimmed = String(text || '').trim();
    if (!trimmed) return;
    item.memo.text = trimmed;
    if (color) item.memo.color = color;
    if (aspectRatio) item.memo.aspectRatio = aspectRatio;
    item.memo.touchedAt = new Date().toISOString(); // 晒褪色计时重置：交互即恢复鲜艳
    this.writeMemoFile(item);
    this.save();
  }

  updateMemoAspectRatio(id, aspectRatio) {
    const item = this.find(id);
    if (!item || item.kind !== 'memo') return;
    item.memo.aspectRatio = aspectRatio;
    this.writeMemoFile(item);
    this.save();
    this.play('tink', 0.25);
  }

  // v1.8 退场：判定"这张便签刚好全部打完"的瞬间（此前未满、此刻全满）。
  // 一个便签可以只有 isDone 总开关（无清单行），同样算全满。
  emitAllDoneIfJustFinished(item, wasAllBefore) {
    const st = calculateTodoStats(item.memo.text);
    const allNow = st.total > 0 && st.completed === st.total;
    if (allNow && !wasAllBefore && this.onAllDone) this.onAllDone(item);
  }

  toggleMemoDone(id) {
    const item = this.find(id);
    if (!item || item.kind !== 'memo') return;
    const st0 = calculateTodoStats(item.memo.text);
    const wasAll = st0.total > 0 && (item.memo.isDone || st0.completed === st0.total);
    item.memo.isDone = !item.memo.isDone;
    item.memo.touchedAt = new Date().toISOString();
    this.writeMemoFile(item);
    this.save();
    if (item.memo.isDone) this.play('pop', 0.25);
    this.emitAllDoneIfJustFinished(item, wasAll);
  }

  toggleMemoTodoLine(id, lineIndex) {
    const item = this.find(id);
    if (!item || item.kind !== 'memo') return;
    const st0 = calculateTodoStats(item.memo.text);
    const wasAll = st0.total > 0 && (item.memo.isDone || st0.completed === st0.total);
    const result = toggleTodoLine(item.memo.text, lineIndex);
    item.memo.text = result.newText;
    item.memo.isDone = result.allDone;
    item.memo.touchedAt = new Date().toISOString();
    this.writeMemoFile(item);
    this.save();
    this.play('pop', 0.25);
    this.emitAllDoneIfJustFinished(item, wasAll);
  }

  writeMemoFile(item) {
    try {
      // tilt 与 memo 字段同级写进 json，hang() 时按 memo.tilt 恢复。
      fs.writeFileSync(item.url, JSON.stringify({ id: item.id, tilt: item.tilt, ...item.memo }, null, 2));
    } catch { /* read-only disk etc. */ }
  }

  // 卡片角度持久化入口（renderer 经 line:set-tilt 调用）：重排/摆弄后的角度
  // 存下来，重启后不再重新随机。memo 写各自 json；照片写 config 的 tilts 表。
  setTilt(id, tilt) {
    const item = this.find(id);
    if (!item) return;
    item.tilt = clampTilt(tilt);
    if (item.kind === 'memo') {
      this.writeMemoFile(item);
    } else {
      this.tilts[item.url] = item.tilt;
      this.scheduleConfigSave();
    }
  }

  // ---- falling / dropping ------------------------------------------------------

  land(id) {
    const item = this.find(id);
    if (item) item.flying = false;
    if (this.onChange) this.onChange();
  }

  liveCount() { return this.items.filter(i => !i.falling).length; }

  // Pinned memos hang at the left end of the line.
  sortLine() {
    const rank = i => (i.kind === 'memo' && i.memo.pinned ? 0 : 1);
    this.items.sort((a, b) => rank(a) - rank(b));
  }

  // R57 未提交草稿（防误关丢失）
  setDraft(text) { this.draft = String(text || ''); }
  getDraft() { return this.draft || ''; }

  // Alt-drag reorder: move an item to a new index (within its pinned section).
  reorder(id, toIndex) {
    const from = this.items.findIndex(i => i.id === id);
    if (from < 0 || toIndex < 0 || toIndex >= this.items.length || from === toIndex) return;
    const [it] = this.items.splice(from, 1);
    this.items.splice(toIndex, 0, it);
    this.save();
  }

  // ♻️ Restore an archived (torn-down) memo back onto the line.
  restoreArchived(index) {
    // this.syncRef — a bare `syncRef` here threw ReferenceError and silently
    // killed recycle-bin restore (the selftest never covered restore; R94 does).
    const ref = this.syncRef;
    const m = ref && ref.archived[index];
    if (!m) return null;
    const nid = this.addMemo({ text: m.text, color: m.color, aspectRatio: m.aspectRatio || 'wide' });
    ref.archived = ref.archived.filter(x => x.id !== m.id);
    ref.saveArchived();
    return nid;
  }

  toggleMemoPinned(id) {
    const item = this.find(id);
    if (!item || item.kind !== 'memo') return;
    item.memo.pinned = !item.memo.pinned;
    this.writeMemoFile(item);
    this.sortLine();
    this.save();
    this.play('tink', 0.25);
  }

  drop(id, { quietly = false } = {}) {
    const item = this.find(id);
    if (!item || item.falling) return;
    if (this.onFall) this.onFall(item);
    item.falling = true;
    this.save();
    if (!quietly) this.play('pop', 0.25);
    setTimeout(() => {
      this.items = this.items.filter(i => i.id !== id);
      if (this.onChange) this.onChange();
    }, 600);
  }

  clear(onEach) {
    const live = this.items.filter(i => !i.falling);
    live.forEach((item, n) => {
      setTimeout(() => {
        if (item.kind === 'memo' && this.onArchive) this.onArchive(item);
        this.drop(item.id, { quietly: n > 0 });
        if (onEach) onEach(item, n);
      }, 60 * n);
    });
  }

  // ---- actions on one item -------------------------------------------------------

  find(id) { return this.items.find(i => i.id === id) || null; }

  copy(id) {
    const item = this.find(id);
    if (!item) return;
    const { clipboard } = require('electron');
    this.isInternalCopy = true;
    if (item.kind === 'memo') {
      clipboard.writeText(item.memo.text);
    } else if (item.kind === 'doc') {
      clipboard.writeText(item.url); // 文档卡复制的是文件路径，内容可从卡里看
    } else {
      clipboard.writeImage(nativeImage.createFromPath(item.url));
    }
    if (this.onCopied) this.onCopied(id);
  }

  discard(id) {
    const item = this.find(id);
    if (!item) return;
    if (item.kind === 'memo') {
      if (this.onArchive) this.onArchive(item);
      try { fs.rmSync(item.url, { force: true }); } catch { /* ignore */ }
      // R43: remember the content so the toast can undo the tear-off.
      this.lastTorn = { text: item.memo.text, color: item.memo.color, aspectRatio: item.memo.aspectRatio };
      if (this.onTorn) this.onTorn(this.lastTorn);
      this.drop(id);
    } else {
      this.drop(id);
    }
  }

  undoTorn() {
    if (!this.lastTorn) return null;
    const id = this.addMemo({ text: this.lastTorn.text, color: this.lastTorn.color, aspectRatio: this.lastTorn.aspectRatio });
    return id;
  }

  trash(idOrPayload) {
    // R186: 调用方形状不一（字符串 id 或 {id}）——统一取 id，否则 find 永不命中
    const id = typeof idOrPayload === 'object' && idOrPayload ? idOrPayload.id : idOrPayload;
    const item = this.find(id);
    if (!item) return;
    if (item.kind === 'memo') {
      if (this.onArchive) this.onArchive(item);
      try { fs.rmSync(item.url, { force: true }); } catch { /* ignore */ }
      // Memo trash used to be silent while image trash played — give it the
      // same 'trash' cue (softer). The drop below stays quiet, so no double.
      this.play('trash', 0.25);
      this.drop(id, { quietly: true });
      return;
    }
    // R186: 先移除卡片（释放渲染器对图片文件的句柄），再入回收站——
    // 句柄未释放时 trashItem/rmSync 都会失败
    this.play('trash', 0.5);
    this.drop(id, { quietly: true });
    shell_trash(item.url); // 立即入回收站：700ms 延迟期间退出应用会留孤儿文件
  }

  open(id) {
    const item = this.find(id);
    if (!item) return;
    if (item.kind === 'memo') return 'memo';
    require('electron').shell.openPath(item.url);
    return 'image';
  }

  reveal(id) {
    const item = this.find(id);
    if (item) require('electron').shell.showItemInFolder(item.url);
  }

  play(name, volume) {
    if (this.settings.soundOn && this.onSound) this.onSound(name, volume);
  }
}

function rand(min, max) { return min + Math.random() * (max - min); }
function clampTilt(t) {
  const n = Number(t);
  return Number.isFinite(n) ? Math.max(-3.5, Math.min(3.5, n)) : 0;
}

async function shell_trash(file) {
  // R186: Electron 原生回收站 API——此前的 PowerShell COM MoveHere 在部分
  // 机器上静默失败（图片"移到回收站"后条目不消失）。失败时兜底直接删除。
  try {
    const ok = await require('electron').shell.trashItem(file);
    if (ok) return true;
  } catch { /* fall through */ }
  try { fs.rmSync(file, { force: true }); return true; } catch { return false; }
}

module.exports = { LineStore, calculateTodoStats, docTypeOf, DOC_TYPES };
