'use strict';
// 每日发现卡：好书 / 好电影 / 好音乐 / 格言 / 知识点，挂在绳尾的图文卡片。
// 内容离线内置；按日期播种确定当日顺序，每 5 分钟自动轮换，点击手动换。
(function () {
  const CATS = {
    book:      { label: '好书',   c1: '#7c5cf0', c2: '#4c1d95', scene: 'book' },
    film:      { label: '电影',   c1: '#ef6a6a', c2: '#991b1b', scene: 'film' },
    music:     { label: '音乐',   c1: '#38bdf8', c2: '#075985', scene: 'music' },
    quote:     { label: '格言',   c1: '#f59e0b', c2: '#92400e', scene: 'quote' },
    knowledge: { label: '知识点', c1: '#34d399', c2: '#065f46', scene: 'bulb' },
  };

  // 精选内容池（离线内置，人工挑选的经典）
  const POOL = [
    { cat: 'book', title: '《人类群星闪耀时》', by: '斯蒂芬·茨威格', line: '一个人生命中最大的幸运，莫过于在年富力强时发现了自己的使命。' },
    { cat: 'book', title: '《月亮与六便士》', by: '毛姆', line: '满地都是六便士，他却抬头看见了月亮。' },
    { cat: 'book', title: '《小王子》', by: '圣埃克苏佩里', line: '真正重要的东西，用眼睛是看不见的。' },
    { cat: 'book', title: '《平凡的世界》', by: '路遥', line: '生活不能等待别人来安排，要自己去争取和奋斗。' },
    { cat: 'book', title: '《被讨厌的勇气》', by: '岸见一郎 / 古贺史健', line: '人生不是与他人的比赛，只要自己不断前进即可。' },
    { cat: 'film', title: '《肖申克的救赎》', by: '弗兰克·德拉邦特', line: '希望是美好的事物，也许是世上最美好的东西。' },
    { cat: 'film', title: '《千与千寻》', by: '宫崎骏', line: '一直向前走，千万别向后看。' },
    { cat: 'film', title: '《死亡诗社》', by: '彼得·威尔', line: 'Carpe Diem——抓住今天，让你的生命不同寻常。' },
    { cat: 'film', title: '《心灵奇旅》', by: '皮克斯', line: '火花不是人生目标，是你想要生活的那一刻。' },
    { cat: 'film', title: '《楚门的世界》', by: '彼得·威尔', line: '万一再也见不到你，祝你早安、午安、晚安。' },
    { cat: 'music', title: '《月光》', by: '德彪西', line: '一百多年来最温柔的钢琴夜色。' },
    { cat: 'music', title: '《Vienna》', by: 'Billy Joel', line: '慢慢来——你不必在二十几岁就抵达维也纳。' },
    { cat: 'music', title: '《天空之城》', by: '久石让', line: '一响起就想起飞行与告别的永恒旋律。' },
    { cat: 'music', title: '《夜空中最亮的星》', by: '逃跑计划', line: '给我再去相信的勇气，越过谎言去拥抱你。' },
    { cat: 'music', title: '《Canon in D》', by: '帕赫贝尔', line: '循环往复却步步向上——这就是坚持的形状。' },
    { cat: 'quote', title: '木心', by: '《文学回忆录》', line: '岁月不饶人，我亦未曾饶过岁月。' },
    { cat: 'quote', title: '罗曼·罗兰', by: '《米开朗琪罗传》', line: '认清生活的真相后依然热爱生活。' },
    { cat: 'quote', title: '尼采', by: '《查拉图斯特拉如是说》', line: '每一个不曾起舞的日子，都是对生命的辜负。' },
    { cat: 'quote', title: '苏轼', by: '《定风波》', line: '竹杖芒鞋轻胜马，谁怕？一蓑烟雨任平生。' },
    { cat: 'quote', title: '加缪', by: '《西西弗神话》', line: '登上顶峰的斗争本身，就足以充实人的心灵。' },
    { cat: 'quote', title: '王阳明', by: '《传习录》', line: '人须在事上磨练，做功夫乃有益。' },
    { cat: 'knowledge', title: '番茄工作法', by: '弗朗西斯科·西里洛', line: '25 分钟专注 + 5 分钟休息，把大任务切成不吓人的小块。' },
    { cat: 'knowledge', title: '两分钟法则', by: '大卫·艾伦《GTD》', line: '两分钟内能做完的事，立刻做掉。' },
    { cat: 'knowledge', title: '费曼技巧', by: '理查德·费曼', line: '讲不清的地方，就是你没懂的地方。' },
    { cat: 'knowledge', title: '蔡格尼克效应', by: '心理学', line: '未完成的任务最占内存——开始做，比做完更容易。' },
    { cat: 'knowledge', title: '复利思维', by: '数学', line: '每天进步 1%，一年是 37 倍。' },
    { cat: 'knowledge', title: '睡前复盘', by: '认知科学', line: '睡前回忆一遍今天的内容，记忆巩固效率翻倍。' },
    { cat: 'book', title: '《置身事内》', by: '兰小欢', line: '看懂中国经济，从理解地方政府的激励开始。' },
    { cat: 'music', title: '《Here Comes The Sun》', by: 'The Beatles', line: '冰冷的冬天终会过去，太阳来了。' },
    { cat: 'film', title: '《海上钢琴师》', by: '朱塞佩·托纳多雷', line: '陆地对我来说是一艘太大的船。' },
  ];

  // 分类艺术插画（图文并茂的卡面主视觉）
  function sceneSVG(cat) {
    if (cat === 'book') {
      return '<svg viewBox="0 0 160 64" width="100%" height="100%">'
        + '<circle cx="128" cy="16" r="9" fill="rgba(255,236,180,0.9)"/><circle cx="36" cy="12" r="1.6" fill="rgba(255,255,255,0.8)"/><circle cx="76" cy="8" r="1.2" fill="rgba(255,255,255,0.7)"/><circle cx="108" cy="20" r="1.4" fill="rgba(255,255,255,0.6)"/>'
        + '<path d="M44 44 Q62 32 80 42 L80 58 Q62 50 44 58 Z" fill="rgba(255,255,255,0.94)"/>'
        + '<path d="M116 44 Q98 32 80 42 L80 58 Q98 50 116 58 Z" fill="rgba(255,255,255,0.8)"/>'
        + '<path d="M80 42 L80 58" stroke="rgba(0,0,0,0.18)" stroke-width="1.4"/>'
        + '<path d="M50 48 Q62 40 76 46 M90 46 Q104 40 110 48" stroke="rgba(124,92,240,0.5)" stroke-width="1.2" fill="none"/></svg>';
    }
    if (cat === 'film') {
      return '<svg viewBox="0 0 160 64" width="100%" height="100%">'
        + '<circle cx="24" cy="14" r="1.6" fill="rgba(255,255,255,0.7)"/><circle cx="132" cy="10" r="2" fill="rgba(255,236,180,0.85)"/>'
        + '<g transform="rotate(-8 80 36)"><rect x="38" y="22" width="84" height="30" rx="3" fill="rgba(255,255,255,0.94)"/>'
        + '<rect x="42" y="26" width="76" height="6" fill="rgba(0,0,0,0.22)"/>'
        + [0, 1, 2, 3, 4, 5].map(k => '<rect x="' + (44 + k * 13) + '" y="27" width="7" height="4" rx="1" fill="rgba(255,255,255,0.85)"/>').join('')
        + '<rect x="46" y="36" width="68" height="12" fill="rgba(124,92,240,0.35)"/>'
        + '<circle cx="62" cy="42" r="3.4" fill="rgba(255,214,90,0.9)"/><path d="M96 38 l10 4 -10 4 Z" fill="rgba(255,255,255,0.9)"/></g></svg>';
    }
    if (cat === 'music') {
      return '<svg viewBox="0 0 160 64" width="100%" height="100%">'
        + '<path d="M0 44 Q40 30 80 42 T160 40" stroke="rgba(255,255,255,0.35)" stroke-width="1.2" fill="none"/>'
        + '<path d="M0 52 Q40 40 80 50 T160 48" stroke="rgba(255,255,255,0.22)" stroke-width="1.2" fill="none"/>'
        + '<circle cx="52" cy="38" r="6" fill="rgba(255,255,255,0.92)"/><rect x="56" y="16" width="2.6" height="22" fill="rgba(255,255,255,0.92)"/><path d="M56 16 Q70 18 70 28 Q64 24 56 26Z" fill="rgba(255,255,255,0.92)"/>'
        + '<circle cx="96" cy="30" r="5" fill="rgba(255,255,255,0.75)"/><rect x="99.5" y="10" width="2.2" height="20" fill="rgba(255,255,255,0.75)"/>'
        + '<circle cx="124" cy="22" r="4.4" fill="rgba(255,255,255,0.6)"/><rect x="127" y="6" width="2" height="16" fill="rgba(255,255,255,0.6)"/></svg>';
    }
    if (cat === 'quote') {
      return '<svg viewBox="0 0 160 64" width="100%" height="100%">'
        + '<circle cx="130" cy="18" r="12" fill="rgba(255,236,180,0.9)"/><circle cx="126" cy="15" r="2" fill="rgba(146,64,14,0.4)"/>'
        + '<text x="18" y="46" font-family="Georgia,serif" font-size="46" fill="rgba(255,255,255,0.85)">“</text>'
        + '<text x="118" y="46" font-family="Georgia,serif" font-size="46" fill="rgba(255,255,255,0.55)">”</text>'
        + '<path d="M30 56 L130 56" stroke="rgba(255,255,255,0.3)" stroke-width="1"/></svg>';
    }
    return '<svg viewBox="0 0 160 64" width="100%" height="100%">'
      + '<path d="M80 8 L84 20 L96 22 L86 30 L90 44 L80 37 L70 44 L74 30 L64 22 L76 20 Z" fill="rgba(255,236,180,0.92)"/>'
      + '<path d="M34 34 h20 M30 44 h24 M108 38 h22 M104 48 h26" stroke="rgba(255,255,255,0.5)" stroke-width="1.4"/>'
      + '<circle cx="52" cy="30" r="1.6" fill="rgba(255,255,255,0.7)"/><circle cx="118" cy="24" r="1.4" fill="rgba(255,255,255,0.6)"/></svg>';
  }

  function iconSvg(cat) {
    const dot = { book: '#7c5cf0', film: '#ef6a6a', music: '#38bdf8', quote: '#f59e0b', knowledge: '#34d399' }[cat] || '#f59e0b';
    if (cat === 'book') return '<svg viewBox="0 0 24 24" width="13" height="13"><path d="M4 5a2 2 0 0 1 2-2h5v18H6a2 2 0 0 1-2-2V5Zm14 0v14a2 2 0 0 1-2 2h-5V3h5a2 2 0 0 1 2 2Z" fill="' + dot + '"/></svg>';
    if (cat === 'film') return '<svg viewBox="0 0 24 24" width="13" height="13"><rect x="3" y="5" width="18" height="14" rx="2" fill="' + dot + '"/></svg>';
    if (cat === 'music') return '<svg viewBox="0 0 24 24" width="13" height="13"><path d="M9 18V6l10-2v11" stroke="' + dot + '" stroke-width="2" fill="none"/><circle cx="6.5" cy="18" r="2.6" fill="' + dot + '"/><circle cx="16.5" cy="15" r="2.6" fill="' + dot + '"/></svg>';
    if (cat === 'knowledge') return '<svg viewBox="0 0 24 24" width="13" height="13"><path d="M12 3a6 6 0 0 1 4 10.5c-.7.6-1 1.4-1 2.2V17h-6v-1.3c0-.8-.3-1.6-1-2.2A6 6 0 0 1 12 3Z" fill="' + dot + '"/><rect x="9.5" y="18" width="5" height="2.4" rx="1.2" fill="' + dot + '"/></svg>';
    return '<svg viewBox="0 0 24 24" width="13" height="13"><path d="M7 7h5v5c0 3-2 5-5 5v-2c1.5 0 2.5-1 2.5-2H5V7h2Zm9 0h5v5c0 3-2 5-5 5v-2c1.5 0 2.5-1 2.5-2h-4.5V7H16Z" fill="' + dot + '"/></svg>';
  }

  // 当日顺序：以日期为种子的确定性洗牌（每天一套新组合）
  function dayOrder(len) {
    const d = new Date();
    let seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const arr = Array.from({ length: len }, (_, i) => i);
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr;
  }

  window.DISCOVER = {
    current(todayIdx) {
      const order = dayOrder(POOL.length);
      return POOL[order[todayIdx % POOL.length]];
    },
    cardHTML(entry) {
      const m = CATS[entry.cat] || CATS.quote;
      // 与普通卡片同构：实心纸面 + 顶部艺术区，绝不含透明底
      return '<div class="discover-card" title="每日发现 · 点击换一条">'
        + '<span class="dc-spark" style="right:12px;top:9px">✦</span>'
        + '<span class="dc-spark s2" style="right:30px;top:24px">✦</span>'
        + '<div class="dc-art">' + sceneSVG(entry.cat) + '</div>'
        + '<div class="dc-paper">'
        + '<div class="dc-ribbon">' + iconSvg(entry.cat) + '<span>' + m.label + '</span></div>'
        + '<div class="dc-title">' + window.escapeHtml(entry.title) + '</div>'
        + '<div class="dc-by">' + window.escapeHtml(entry.by) + '</div>'
        + '<div class="dc-line">' + window.escapeHtml(entry.line) + '</div>'
        + '</div></div>';
    },
    POOL_LENGTH: POOL.length,
  };
})();
