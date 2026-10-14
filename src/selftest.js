'use strict';
// Automated smoke test of the whole state machine. Run with:
//   electron . --test
// Prints PASS/FAIL lines and exits with code 0/1.

const fs = require('fs');
const path = require('path');
const { clipboard, nativeImage, app } = require('electron');

module.exports = async function selftest(ctx) {
  // ctx = { store, sync, watchers, assets }
  const { store, sync, watchers, assets } = ctx;
  const results = [];
  const snap = () => JSON.stringify(store.items.map(i => ({ k: i.kind, f: i.falling, fall: i.falling, text: (i.memo && i.memo.text || '').slice(0, 12), url: path.basename(i.url) })));
  const check = (name, cond) => { results.push([name, !!cond]); console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${cond ? '' : ' | items=' + snap()}`); };
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  await sleep(1500); // let restore() + broadcast settle

  // 1. addMemo
  const id = store.addMemo({ text: '# 测试便签\n- [ ] 第一件事\n- [x] 第二件事', color: 'blue', aspectRatio: 'wide' });
  check('addMemo creates an item', id && store.items.length === 1);
  check('memo json file written', fs.existsSync(store.items[0].url));

  // 2. SunMemo.md sync (debounced — flush it explicitly)
  store.flushSync();
  await sleep(100);
  const md = fs.readFileSync(sync.markdownPath, 'utf8');
  check('SunMemo.md contains the memo', md.includes('测试便签') && md.includes('便签 1'));

  // 3. toggle todo line
  store.toggleMemoTodoLine(id, 1);
  check('todo line toggled to [x]', store.items[0].memo.text.includes('- [x] 第一件事'));
  check('allDone → isDone true', store.items[0].memo.isDone === true);

  // 3b. v1.8 退场钩子：正好打完最后一项时触发 onAllDone（此前未满、此刻全满）
  {
    let offered = null;
    const prevHook = store.onAllDone;
    store.onAllDone = it => { offered = it ? it.id : null; };
    const id2 = store.addMemo({ text: '- [ ] 甲\n- [ ] 乙', color: 'yellow' });
    store.toggleMemoTodoLine(id2, 0);
    check('exit hook NOT fired while todos remain', offered === null);
    store.toggleMemoTodoLine(id2, 1);
    check('exit hook fired on the final tick', offered === id2);
    // 取消一个再打回去：再次触发（退场机会跟着"完成瞬间"走）
    store.toggleMemoTodoLine(id2, 0);
    offered = null;
    store.toggleMemoTodoLine(id2, 0);
    check('exit hook refires after un-done → re-done', offered === id2);
    store.onAllDone = prevHook;
  }

  // 3c. v1.8 沉降布局：龄期判定与展示序（活跃在前、闲置原序聚尾、置顶不沉）
  {
    const { ageDaysOf, sinkOrder, SINK_DAYS } = require('./layout');
    const now = Date.now();
    const day = 86400000;
    const old1 = { id: 'old1', kind: 'doc', url: 'C:\\x.pdf' };
    const act = { id: 'act', kind: 'doc', url: 'C:\\y.pdf' };
    const pin = { id: 'pin', kind: 'memo', memo: { pinned: true, touchedAt: new Date(now - 30 * day).toISOString() } };
    const old2 = { id: 'old2', kind: 'memo', memo: { touchedAt: new Date(now - (SINK_DAYS + 1) * day).toISOString() } };
    const touches = { 'C:\\x.pdf': now - 9 * day, 'C:\\y.pdf': now };
    check('ageDaysOf: doc uses touches table', Math.round(ageDaysOf(old1, touches, now)) === 9);
    check('ageDaysOf: memo uses touchedAt', Math.round(ageDaysOf(old2, touches, now)) === SINK_DAYS + 1);
    const ordered = sinkOrder([old1, act, pin, old2], new Set(['old1', 'old2']));
    check('sinkOrder: active+pinned stay, aged gather at tail',
      ordered.map(i => i.id).join(',') === 'act,pin,old1,old2');
  }

  // 3d. v1.8 图片/文档触达表持久化（沉降龄期的跨重启来源）
  {
    const img = store.items.find(i => i.kind === 'image');
    if (img) {
      store.touch(img.id);
      store.saveSettingsOnly();
      const cfg = JSON.parse(fs.readFileSync(store.configPath, 'utf8'));
      check('touch() persists to config.touches', !!(cfg.touches && cfg.touches[img.url] > 0));
    }
  }

  // 4. aspect ratio change persists
  store.updateMemoAspectRatio(id, 'tall');
  const onDisk = JSON.parse(fs.readFileSync(store.items[0].url, 'utf8'));
  check('aspectRatio persisted to json', onDisk.aspectRatio === 'tall');

  // 5. updateMemo
  store.updateMemo(id, { text: '# 更新后的便签', color: 'pink' });
  check('updateMemo changes text/color', store.items[0].memo.text === '# 更新后的便签' && store.items[0].memo.color === 'pink');

  // 6. copy memo text
  store.copy(id);
  check('copy puts memo text on clipboard', clipboard.readText() === '# 更新后的便签');

  // 7. clipboard hang (image)
  clipboard.writeImage(nativeImage.createFromPath(assets.demoShotPath));
  const ok = watchers.hangCurrentClipboard(store);
  await sleep(100);
  const shot = store.items.find(i => i.kind === 'image');
  check('hangCurrentClipboard hangs image', ok && !!shot && fs.existsSync(shot.url));

  // 8. hangCurrentClipboard with text
  clipboard.writeText('剪贴板文本便签');
  const ok2 = watchers.hangCurrentClipboard(store);
  check('hangCurrentClipboard hangs text as memo', ok2 && store.items.some(i => i.kind === 'memo' && i.memo.text === '剪贴板文本便签'));

  // 9. discard → archive
  const before = sync.archived.length;
  store.discard(id);
  await sleep(700);
  check('discard archives memo', sync.archived.length === before + 1);
  check('discard removes item', !store.items.some(i => i.id === id));
  store.flushSync();
  await sleep(100);
  const md2 = fs.readFileSync(sync.markdownPath, 'utf8');
  check('archive section in SunMemo.md', md2.includes('历史已撕下便签归档') && md2.includes('更新后的便签'));

  // 10. image prune when file removed
  fs.rmSync(shot.url, { force: true });
  store.prune();
  await sleep(800); // drop() removes the card 600ms after marking it falling
  check('prune drops missing files', !store.items.some(i => i.kind === 'image'));

  // 11. clear
  store.clear();
  await sleep(1200);
  check('clear empties the line', store.liveCount() === 0);

  // 12. restore from disk (restart resilience)
  const re = store.addMemo({ text: '重启恢复测试', color: 'yellow' });
  store.save();
  store.flushSync(); // R112: config write is debounced now — flush before reading
  const paths = JSON.parse(fs.readFileSync(store.configPath || path.join(app.getPath('appData'), 'SunMemo', 'config.json'), 'utf8'));
  check('config.json records pegged path', paths.pegged.length === 1 && fs.existsSync(paths.pegged[0]));

  // 13. recycle-bin restore roundtrip (R94: guards the this.syncRef wiring —
  // a bare `syncRef` here ReferenceError'd and restore silently did nothing)
  const archivedBefore = sync.archived.length;
  const tornText = sync.archived.length ? sync.archived[0].text : null;
  if (archivedBefore > 0) {
    const rid = store.restoreArchived(0);
    check('restoreArchived returns new id', !!rid && store.items.some(i => i.id === rid));
    check('restored memo text matches archive', tornText != null && store.items.some(i => i.memo && i.memo.text === tornText));
    check('restore removes from archive', sync.archived.length === archivedBefore - 1);
    // put it back so later checks / teardown stay balanced
    const back = store.items.find(i => i.id === rid);
    if (back) store.discard(rid);
    await sleep(700);
  }

  console.log(`SELFTEST ${results.every(r => r[1]) ? 'PASSED' : 'FAILED'} (${results.filter(r => r[1]).length}/${results.length})`);
  return results.every(r => r[1]);
};
