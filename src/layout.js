'use strict';
// Shared layout math — a faithful port of SunMemo's Layout enum (LineView.swift).
// All values are CSS pixels, matching the macOS point values 1:1.

const PANEL_H = 275;
const ROPE_TOP = 10;
const CARD_W = 150;
const PIN_ABOVE = 9.5;
const CARD_RADIUS = 16;
const CARD_INSET = 4;
const CARD_OFFSET_BELOW_TOP = 26 - 12; // PeggedView.cardOffsetBelowTop

const RATIOS = {
  wide:   { title: '宽版', subtitle: '16:10 宽屏横版', symbol: '▭',
            rope: { w: 220, h: 140 }, content: { w: 206, h: 122 },
            preview: { w: 510, h: 320 }, previewBody: 185, editor: { w: 500, h: 350 } },
  square: { title: '方版', subtitle: '1:1 正方便利贴', symbol: '□',
            rope: { w: 160, h: 160 }, content: { w: 146, h: 142 },
            preview: { w: 400, h: 400 }, previewBody: 265, editor: { w: 420, h: 420 } },
  tall:   { title: '竖版', subtitle: '3:4 长条清单', symbol: '▯',
            rope: { w: 155, h: 210 }, content: { w: 141, h: 192 },
            preview: { w: 380, h: 500 }, previewBody: 365, editor: { w: 400, h: 490 } },
};

// The rope hangs as a parabola from edge to edge of the screen.
function sag(width) { return Math.min(32, width * 0.018); }

function ropeY(x, width) {
  if (width <= 0) return ROPE_TOP;
  const f = x / width;
  return ROPE_TOP + 4 * sag(width) * f * (1 - f);
}

// Few cards: natural 205px spacing. Many cards: compress smoothly to 45px.
// On software-rendered machines the frosted cards are opaque, so the natural
// spacing opens up to keep neighbour text readable.
let SW_MODE = false;
function setSoftwareMode(v) { SW_MODE = !!v; }

function dynamicSpacing(count, width) {
  const natural = SW_MODE ? 226 : 205;
  const minStep = SW_MODE ? 58 : 45;
  if (count <= 1) return natural;
  const available = Math.max(260, width - 260);
  const needed = (count - 1) * natural;
  if (needed <= available) return natural;
  return Math.max(minStep, available / (count - 1));
}

function xAt(index, count, width) {
  const step = dynamicSpacing(count, width);
  const total = Math.max(count - 1, 0) * step;
  return width / 2 - total / 2 + index * step;
}

// ---- v1.8 沉降布局 ----------------------------------------------------------
// 绳一长"可见"就死了：解法不在新功能，在布局规则——N 天没动的卡自动沉到绳尾、
// 缩小降透明，活跃卡永远占黄金视野。绳自己排优先级，而不是逼人整理。
// 龄期判定与晒褪色同一套触达时间源：memo 用 touchedAt/createdAt，图片/文档
// 用 config touches 表（store.touch 在交互时更新）。置顶便签永不沉。
const SINK_DAYS = 3;

function ageDaysOf(item, touches, now) {
  let t = 0;
  if (item.kind === 'memo') {
    t = new Date((item.memo && (item.memo.touchedAt || item.memo.createdAt)) || 0).getTime();
  } else {
    t = (touches && touches[item.url]) || 0;
  }
  if (!t || !isFinite(t)) return 0;
  return Math.max(0, ((now || Date.now()) - t) / 86400000);
}

// 展示序：活跃卡保持原相对顺序在前，沉底卡原相对顺序聚到绳尾（纯视图层排序，
// 不动 store.items —— 保存的挂绳顺序与 Alt 拖拽顺序不受影响）。
function sinkOrder(items, agedSet) {
  if (!agedSet || !agedSet.size) return items;
  const active = [], aged = [];
  for (const it of items) (agedSet.has(it.id) ? aged : active).push(it);
  return active.concat(aged);
}

// Item width on the rope.
function ropeWidth(item) {
  if (item.kind === 'memo') {
    const r = RATIOS[(item.memo && item.memo.aspectRatio) || 'wide'] || RATIOS.wide;
    return r.rope.w;
  }
  return CARD_W;
}

// Screen-space frame of the card *below* the peg (the visual card, pin included
// above it). Mirrors AppDelegate.cardFrame(for:).
function cardFrame(item, index, count, panelX, panelY, width) {
  const x = xAt(index, count, width);
  const viewTop = ropeY(x, width) - PIN_ABOVE;
  const cardTop = viewTop + CARD_OFFSET_BELOW_TOP;
  let w, h;
  if (item.kind === 'memo') {
    const r = RATIOS[(item.memo && item.memo.aspectRatio) || 'wide'] || RATIOS.wide;
    w = r.rope.w; h = r.rope.h;
  } else {
    const iw = item.thumbW || CARD_W - 14, ih = item.thumbH || 104;
    w = iw + CARD_INSET * 2; h = ih + CARD_INSET * 2;
  }
  return { x: panelX + x - w / 2, y: panelY + cardTop, w, h, cx: x, ropeTop: panelY + viewTop };
}

// Peeking scheme B: hand-parting playing cards.
function peekTransform(index, hoveredIndex, total) {
  const addIndex = total; // the add-card sits after the last item
  const result = { xOff: 0, yOff: 0, tilt: 0, z: index + 1 };
  if (hoveredIndex == null) return result;
  const dist = Math.abs(index - hoveredIndex);
  if (index === hoveredIndex) return { xOff: 0, yOff: 8.0, tilt: 0, z: 1000 };
  const left = index < hoveredIndex;
  const d = Math.abs(index - hoveredIndex);
  let xOff = 0, tilt = 0;
  if (d === 1) { xOff = -28; tilt = -2.2; }
  else if (d === 2) { xOff = -14; tilt = -1.2; }
  else if (d === 3) { xOff = -5; tilt = -0.5; }
  if (!left) { xOff = -xOff; tilt = -tilt; }
  return { xOff, yOff: 0, tilt, z: 900 - d };
}

function addCardPeekOffset(hoveredIndex, itemCount) {
  if (hoveredIndex == null) return 0;
  const dist = itemCount - hoveredIndex;
  if (dist === 1) return 26;
  if (dist === 2) return 12;
  return 0;
}

const L = { PANEL_H, ROPE_TOP, CARD_W, PIN_ABOVE, CARD_RADIUS, CARD_INSET, CARD_OFFSET_BELOW_TOP,
  RATIOS, sag, ropeY, dynamicSpacing, xAt, ropeWidth, cardFrame, peekTransform, addCardPeekOffset, setSoftwareMode,
  SINK_DAYS, ageDaysOf, sinkOrder };

// CommonJS (main process) and <script> (renderer pages) both work.
if (typeof module !== 'undefined' && module.exports) module.exports = L;
if (typeof window !== 'undefined') window.L = L;
