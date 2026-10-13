'use strict';
// 每日发现卡：好书 / 好电影 / 好音乐 / 格言 / 知识点，挂在「记想法」左侧的图文卡片。
// 内容离线内置（110+ 条，按日播种轮换，一个月不重复）；每 5 分钟自动轮换，点击手动换。
(function () {
  const CATS = {
    book:      { label: '好书',   c1: '#7c5cf0', c2: '#4c1d95' },
    film:      { label: '电影',   c1: '#ef6a6a', c2: '#991b1b' },
    music:     { label: '音乐',   c1: '#38bdf8', c2: '#075985' },
    quote:     { label: '格言',   c1: '#f59e0b', c2: '#92400e' },
    knowledge: { label: '知识点', c1: '#34d399', c2: '#065f46' },
  };

  const POOL = [
    { cat: 'book', title: '《人类群星闪耀时》', by: '斯蒂芬·茨威格', line: '一个人生命中最大的幸运，莫过于在年富力强时发现了自己的使命。' },
    { cat: 'book', title: '《月亮与六便士》', by: '毛姆', line: '满地都是六便士，他却抬头看见了月亮。' },
    { cat: 'book', title: '《小王子》', by: '圣埃克苏佩里', line: '真正重要的东西，用眼睛是看不见的。' },
    { cat: 'book', title: '《平凡的世界》', by: '路遥', line: '生活不能等待别人来安排，要自己去争取和奋斗。' },
    { cat: 'book', title: '《被讨厌的勇气》', by: '岸见一郎 / 古贺史健', line: '人生不是与他人的比赛，只要自己不断前进即可。' },
    { cat: 'book', title: '《置身事内》', by: '兰小欢', line: '看懂中国经济，从理解地方政府的激励开始。' },
    { cat: 'book', title: '《活着》', by: '余华', line: '人是为活着本身而活着的，而不是为了活着之外的任何事物。' },
    { cat: 'book', title: '《围城》', by: '钱钟书', line: '城外的人想进去，城里的人想出来。' },
    { cat: 'book', title: '《百年孤独》', by: '加西亚·马尔克斯', line: '生命中曾经有过的所有灿烂，终究都需要用寂寞来偿还。' },
    { cat: 'book', title: '《三体》', by: '刘慈欣', line: '给岁月以文明，而不是给文明以岁月。' },
    { cat: 'book', title: '《霍乱时期的爱情》', by: '马尔克斯', line: '哪儿都可以去，只要不是原地踏步。' },
    { cat: 'book', title: '《万历十五年》', by: '黄仁宇', line: '大历史观：从技术的角度看待历史，而非道德。' },
    { cat: 'book', title: '《乡土中国》', by: '费孝通', line: '差序格局，理解中国一切关系的钥匙。' },
    { cat: 'book', title: '《枪炮、病菌与钢铁》', by: '贾雷德·戴蒙德', line: '地理决定了文明的起点，而非种族。' },
    { cat: 'book', title: '《思考，快与慢》', by: '丹尼尔·卡尼曼', line: '我们有两个自我：直觉的快我，与理性的慢我。' },
    { cat: 'book', title: '《原则》', by: '瑞·达利欧', line: '痛苦 + 反思 = 进步。' },
    { cat: 'book', title: '《非暴力沟通》', by: '马歇尔·卢森堡', line: '观察而不评判，表达感受而非指责。' },
    { cat: 'book', title: '《刻意练习》', by: '安德斯·艾利克森', line: '天赋是练习的结果，不是前提。' },
    { cat: 'book', title: '《人生海海》', by: '麦家', line: '人生海海，敢死不叫勇气，活着才需要勇气。' },
    { cat: 'book', title: '《云边有个小卖部》', by: '张嘉佳', line: '希望和悲伤，都是一缕光。' },
    { cat: 'book', title: '《悉达多》', by: '黑塞', line: '知识可以传授，智慧只能自己觉醒。' },
    { cat: 'book', title: '《局外人》', by: '加缪', line: '在深冬，我终于知道，我身上有一个不可战胜的夏天。' },
    { cat: 'film', title: '《肖申克的救赎》', by: '弗兰克·德拉邦特', line: '希望是美好的事物，也许是世上最美好的东西。' },
    { cat: 'film', title: '《千与千寻》', by: '宫崎骏', line: '一直向前走，千万别向后看。' },
    { cat: 'film', title: '《死亡诗社》', by: '彼得·威尔', line: 'Carpe Diem——抓住今天，让你的生命不同寻常。' },
    { cat: 'film', title: '《心灵奇旅》', by: '皮克斯', line: '火花不是人生目标，是你想要生活的那一刻。' },
    { cat: 'film', title: '《楚门的世界》', by: '彼得·威尔', line: '万一再也见不到你，祝你早安、午安、晚安。' },
    { cat: 'film', title: '《海上钢琴师》', by: '朱塞佩·托纳多雷', line: '陆地对我来说是一艘太大的船。' },
    { cat: 'film', title: '《阿甘正传》', by: '罗伯特·泽米吉斯', line: '生活就像一盒巧克力，你永远不知道下一颗是什么味道。' },
    { cat: 'film', title: '《星际穿越》', by: '克里斯托弗·诺兰', line: '爱是唯一可以超越时间与空间的事物。' },
    { cat: 'film', title: '《盗梦空间》', by: '克里斯托弗·诺兰', line: '一个想法，比任何病毒都顽强，极具感染力。' },
    { cat: 'film', title: '《当幸福来敲门》', by: '加布里尔·穆奇诺', line: '别让别人告诉你，你成不了才。' },
    { cat: 'film', title: '《放牛班的春天》', by: '克里斯托夫·巴拉蒂', line: '每一颗心都需要爱，需要温柔，需要宽容。' },
    { cat: 'film', title: '《怦然心动》', by: '罗伯·莱纳', line: '总有一天你会遇到一个彩虹般绚丽的人。' },
    { cat: 'film', title: '《教父》', by: '弗朗西斯·科波拉', line: '花半秒钟就看透事物本质的人，命运注定不同。' },
    { cat: 'film', title: '《天使爱美丽》', by: '让-皮埃尔·热内', line: '没有爱情的女人就像没有阳光的花。' },
    { cat: 'film', title: '《寻梦环游记》', by: '皮克斯', line: '死亡不是终点，遗忘才是。' },
    { cat: 'film', title: '《飞屋环游记》', by: '皮克斯', line: '冒险就在那里！' },
    { cat: 'film', title: '《本杰明·巴顿奇事》', by: '大卫·芬奇', line: '做你想做的人，这件事没有时间的限制。' },
    { cat: 'film', title: '《闻香识女人》', by: '马丁·布莱斯', line: '走正确的路，那才是有意义的人生。' },
    { cat: 'film', title: '《大鱼》', by: '蒂姆·波顿', line: '一个人不停地讲述故事，最后自己也成了一个故事。' },
    { cat: 'film', title: '《穿条纹睡衣的男孩》', by: '马克·赫尔曼', line: '童年应当有栅栏外的天空。' },
    { cat: 'film', title: '《布达佩斯大饭店》', by: '韦斯·安德森', line: '对称、粉色与旧时代的优雅。' },
    { cat: 'music', title: '《月光》', by: '德彪西', line: '一百多年来最温柔的钢琴夜色。' },
    { cat: 'music', title: '《Vienna》', by: 'Billy Joel', line: '慢慢来——你不必在二十几岁就抵达维也纳。' },
    { cat: 'music', title: '《天空之城》', by: '久石让', line: '一响起就想起飞行与告别的永恒旋律。' },
    { cat: 'music', title: '《夜空中最亮的星》', by: '逃跑计划', line: '给我再去相信的勇气，越过谎言去拥抱你。' },
    { cat: 'music', title: '《Canon in D》', by: '帕赫贝尔', line: '循环往复却步步向上——这就是坚持的形状。' },
    { cat: 'music', title: '《Here Comes The Sun》', by: 'The Beatles', line: '冰冷的冬天终会过去，太阳来了。' },
    { cat: 'music', title: '《晴天》', by: '周杰伦', line: '刮风这天我试过握着你手，但偏偏雨渐渐大到我看不见。' },
    { cat: 'music', title: '《稻香》', by: '周杰伦', line: '回家吧，回到最初的美好。' },
    { cat: 'music', title: '《平凡之路》', by: '朴树', line: '我曾经跨过山和大海，也穿过人山人海。' },
    { cat: 'music', title: '《山丘》', by: '李宗盛', line: '越过山丘，才发现无人等候。' },
    { cat: 'music', title: '《光年之外》', by: '邓紫棋', line: '缘分让我们相遇乱世以外。' },
    { cat: 'music', title: '《起风了》', by: '买辣椒也用券', line: '我曾难自拔于世界之大，也沉溺于其中梦话。' },
    { cat: 'music', title: '《Clair de Lune》', by: '德彪西', line: '月光洒落的速度，大约是心动的速度。' },
    { cat: 'music', title: '《G弦上的咏叹调》', by: '巴赫', line: '在最简单的弦上，奏最深的宁静。' },
    { cat: 'music', title: '《四季·春》', by: '维瓦尔第', line: '春天第一缕风穿过琴弦的声音。' },
    { cat: 'music', title: '《Bohemian Rhapsody》', by: 'Queen', line: '一首歌走完歌剧、民谣与摇滚的一生。' },
    { cat: 'music', title: '《Imagine》', by: 'John Lennon', line: '想象所有的人，分享这世界。' },
    { cat: 'music', title: '《What a Wonderful World》', by: 'Louis Armstrong', line: '我看见树那么绿，玫瑰那么红。' },
    { cat: 'music', title: '《月亮代表我的心》', by: '邓丽君', line: '轻轻的一个吻，已经打动我的心。' },
    { cat: 'music', title: '《海阔天空》', by: 'Beyond', line: '原谅我这一生不羁放纵爱自由。' },
    { cat: 'music', title: '《City of Stars》', by: '《爱乐之城》', line: '星光之城，你是否只为我闪耀。' },
    { cat: 'quote', title: '木心', by: '《文学回忆录》', line: '岁月不饶人，我亦未曾饶过岁月。' },
    { cat: 'quote', title: '罗曼·罗兰', by: '《米开朗琪罗传》', line: '认清生活的真相后依然热爱生活。' },
    { cat: 'quote', title: '尼采', by: '《查拉图斯特拉如是说》', line: '每一个不曾起舞的日子，都是对生命的辜负。' },
    { cat: 'quote', title: '苏轼', by: '《定风波》', line: '竹杖芒鞋轻胜马，谁怕？一蓑烟雨任平生。' },
    { cat: 'quote', title: '加缪', by: '《西西弗神话》', line: '登上顶峰的斗争本身，就足以充实人的心灵。' },
    { cat: 'quote', title: '王阳明', by: '《传习录》', line: '人须在事上磨练，做功夫乃有益。' },
    { cat: 'quote', title: '泰戈尔', by: '《飞鸟集》', line: '世界以痛吻我，要我报之以歌。' },
    { cat: 'quote', title: '里尔克', by: '《给青年诗人的信》', line: '哪有什么胜利可言，挺住意味着一切。' },
    { cat: 'quote', title: '老子', by: '《道德经》', line: '千里之行，始于足下。' },
    { cat: 'quote', title: '庄子', by: '《逍遥游》', line: '举世誉之而不加劝，举世非之而不加沮。' },
    { cat: 'quote', title: '孔子', by: '《论语》', line: '知之者不如好之者，好之者不如乐之者。' },
    { cat: 'quote', title: '曾国藩', by: '家书', line: '天下事，必须躬身入局。' },
    { cat: 'quote', title: '胡适', by: '文集', line: '怕什么真理无穷，进一寸有一寸的欢喜。' },
    { cat: 'quote', title: '罗翔', by: '法学课堂', line: '我们登上并非我们所选择的舞台，演出并非我们所选择的剧本。' },
    { cat: 'quote', title: '王小波', by: '《黄金时代》', line: '那一天我二十一岁，在我一生的黄金时代。' },
    { cat: 'quote', title: '史铁生', by: '《我与地坛》', line: '死是一件不必急于求成的事。' },
    { cat: 'quote', title: '汪曾祺', by: '《人间草木》', line: '人生如梦，我投入的却是真情。' },
    { cat: 'quote', title: '杨绛', by: '《一百岁感言》', line: '内心淡定与从容，才是最美的风景。' },
    { cat: 'quote', title: '黑塞', by: '《德米安》', line: '对每个人而言，真正的职责只有一个：找到自我。' },
    { cat: 'quote', title: '海明威', by: '《真实的高贵》', line: '高贵的是优于过去的自己。' },
    { cat: 'quote', title: '达·芬奇', by: '手稿', line: '充实的一天会带来安眠，充实的一生会带来安息。' },
    { cat: 'quote', title: '曾国藩', by: '家书', line: '物来顺应，未来不迎，当时不杂，既过不恋。' },
    { cat: 'knowledge', title: '番茄工作法', by: '弗朗西斯科·西里洛', line: '25 分钟专注 + 5 分钟休息，把大任务切成小块。' },
    { cat: 'knowledge', title: '两分钟法则', by: '大卫·艾伦《GTD》', line: '两分钟内能做完的事，立刻做掉。' },
    { cat: 'knowledge', title: '费曼技巧', by: '理查德·费曼', line: '讲不清的地方，就是你没懂的地方。' },
    { cat: 'knowledge', title: '蔡格尼克效应', by: '心理学', line: '未完成的任务最占内存——开始做，比做完更容易。' },
    { cat: 'knowledge', title: '复利思维', by: '数学', line: '每天进步 1%，一年是 37 倍。' },
    { cat: 'knowledge', title: '睡前复盘', by: '认知科学', line: '睡前回忆一遍今天的内容，记忆巩固效率翻倍。' },
    { cat: 'knowledge', title: '帕金森定律', by: '管理学', line: '工作会膨胀到占满所有可用时间——设短一点的死线。' },
    { cat: 'knowledge', title: '80/20 法则', by: '帕累托', line: '80% 的成果来自 20% 的关键动作。' },
    { cat: 'knowledge', title: '峰终定律', by: '丹尼尔·卡尼曼', line: '人对一段经历的记忆，由峰值和结尾决定。' },
    { cat: 'knowledge', title: '心流', by: '米哈里·契克森米哈赖', line: '挑战与能力刚好匹配时，时间会消失。' },
    { cat: 'knowledge', title: '第二大脑', by: '蒂亚戈·福特', line: '记下来，让想法替你工作。' },
    { cat: 'knowledge', title: '薛定谔的猫', by: '量子力学', line: '观测之前，盒子里同时装着两种可能。' },
    { cat: 'knowledge', title: '破窗效应', by: '社会学', line: '一扇破窗不修，整栋楼都会破下去。' },
    { cat: 'knowledge', title: '墨菲定律', by: '工程学', line: '可能出错的事，一定会出错——提前做准备。' },
    { cat: 'knowledge', title: '奥卡姆剃刀', by: '哲学', line: '如无必要，勿增实体。' },
    { cat: 'knowledge', title: '幸存者偏差', by: '统计学', line: '你看到的成功案例，是因为失败者没有机会说话。' },
    { cat: 'knowledge', title: '锚定效应', by: '行为经济学', line: '第一个数字，悄悄决定了你心里的价位。' },
    { cat: 'knowledge', title: '达克效应', by: '心理学', line: '知道得越少，越容易高估自己。' },
    { cat: 'knowledge', title: '熵增定律', by: '热力学', line: '万物趋向混乱——对抗熵增要持续输入能量。' },
    { cat: 'knowledge', title: '费斯汀格法则', by: '心理学', line: '生活中 10% 的事无法控制，90% 的反应可以。' },
    { cat: 'knowledge', title: 'GTD 清空大脑', by: '大卫·艾伦', line: '大脑用来思考，不是用来存储。' },
    { cat: 'knowledge', title: 'SMART 目标', by: '管理学', line: '具体、可衡量、可实现、相关、有时限。' },
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
