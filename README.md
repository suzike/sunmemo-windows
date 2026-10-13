<div align="center">

<img src="assets/icon-preview.png" width="96" alt="SunMemo 图标">

# ☀️ SunMemo for Windows

**把未完成的想法与待办，晾在桌面阳光下。**

一条常驻桌面顶部的晾衣绳：便签与截图像湿毛巾一样夹在绳上，随取随用。<br>
鼠标推住屏幕顶边或 <kbd>Ctrl+Alt+Space</kbd> 呼出，移开自动收起。<br>
**本地离线 · 数据自主 · 完全免费**

![platform](https://img.shields.io/badge/platform-Windows%2010%2F11-blue)
![electron](https://img.shields.io/badge/Electron-43-47848F)
![version](https://img.shields.io/badge/version-1.7.0-ff8f1f)
![tests](https://img.shields.io/badge/tests-19%E8%87%AA%E6%B5%8B%20%2B%2026%20E2E-brightgreen)
![license](https://img.shields.io/badge/license-MIT-green)

**[快速开始](#-快速开始) · [界面一览](#-界面一览) · [全局快捷键](#️-全局快捷键) · [更新日志](CHANGELOG.md)**

<br>

![晾衣绳主界面](docs/img/line-hero.png)

</div>

---

## ✨ 核心体验

- 🖱 **单击预览，Esc 收起** —— 点任意卡片，便签沿悬链线弹到屏幕中央成为大图预览；清单可在预览里直接打勾，实时同步回绳上
- 📄 **文档挂绳 · 悬停即读** —— MD / PDF / Word 拖上绳即成类型化文档卡；悬停在桌面正中弹出阅读面板（PDF.js / docx-preview 高保真渲染，可滚动翻页），粘性面板不跟丢鼠标
- 🔍 **悬停即放大** —— 鼠标放到图片卡上，照片原地 Dock 式弹簧放大 3×，小图瞬间可读；移开即回落，设置可关
- ↔️ **挂满一屏也不怕** —— 卡片保持自然间距，滚轮 / 拖拽左右平移，两端箭头 + 行程条；卡片始终沿绳的垂曲线滑动
- ✅ **智能清单** —— 速记里回车自动续 `- [ ]`，绳上直接打勾，全部完成时撒花庆祝
- 📋 **截图 / 剪贴板接管** —— <kbd>Ctrl+Alt+V</kbd> 挂上剪贴板；截图落盘即自动上绳；本地图片与文档可直接拖入绳上
- ✍️ **拖文本即粘** —— 从任何应用拖选中的文字（或 .txt / .md 文件）进速记窗，直接按内容粘贴，绝不当附件
- 📌 **贴桌便签** —— <kbd>Shift+拖拽</kbd> 把便签贴到桌面：可编辑（实时回写）、置顶窗、半透明，随时放回绳上
- 💾 **Markdown 实时备份** —— 全部内容实时同步到 `文档\SunMemo.md`，Obsidian / Typora 随时查看，永不丢数据
- 🎨 **六主题 + 深色模式** —— 跟随系统深浅色，自定义取色器实时广播到全部窗口
- 🌬 **环境氛围** —— 挂绳 Tink 声、完成 Pop 声、可开关的轻风白噪声、待机时呼吸发光的太阳信标
- 🐦 **绳上小鸟与太阳种子** —— 小鸟随机来访小憩；完成当天全部待办，它会叼来一颗太阳种子挂在绳尾
- 🕰 **时光晾衣绳** —— 撕下的便签按周陈列成回忆板，点击任意一张即可放回绳上
- ◐ **每日发现卡** —— 绳尾图文卡片每 5 分钟轮换好书 / 电影 / 音乐 / 格言 / 知识点，每天一套新组合

## 🔍 悬停即放大（v1.5.0 新增）

不点鼠标，光标放到图片卡上——照片原地弹簧放大 3 倍，配深阴影浮起质感；移开即回落。
设置里「悬停时图片自动放大」可随时开关（默认开启）。

<div align="center">

![悬停放大对比](docs/img/06-imgzoom.png)

</div>

## 🖼 界面一览

| 卡片预览（悬链放大 + 打勾同步） | 速记编辑器（Markdown 工具栏 + 字数状态栏） |
| --- | --- |
| ![卡片预览](docs/img/02-preview.png) | ![速记编辑器](docs/img/03-quickmemo.png) |

| 本周统计（趋势对比 + CSV 导出 + 回收站） | 偏好设置（六主题 + 取色器 + 快捷键自定义） |
| --- | --- |
| ![本周统计](docs/img/stats.png) | ![偏好设置](docs/img/04-settings.png) |

<details>
<summary><b>更多界面（点击展开）</b></summary>

| 欢迎引导 | 深色模式（跟随系统） |
| --- | --- |
| ![欢迎引导](docs/img/05-welcome.png) | ![深色搜索](docs/img/search-dark.png) |

</details>

## ⌨️ 全局快捷键

| 快捷键 | 功能 |
| --- | --- |
| <kbd>Ctrl+Alt+Space</kbd> | 呼出 / 收起晾衣绳 |
| <kbd>Ctrl+Alt+N</kbd> | 弹出速记便签 |
| <kbd>Ctrl+Alt+V</kbd> | 挂上剪贴板内容 |
| <kbd>Ctrl+Alt+F</kbd> | 搜索便签 |
| <kbd>Esc</kbd> | 收起预览 / 收起晾衣绳 |
| <kbd>Shift</kbd>+拖拽卡片 | 撕下贴到桌面 |
| <kbd>Alt</kbd>+拖拽卡片 | 调整顺序 |
| <kbd>Ctrl</kbd>+滚轮 | 调整卡片字号 |

## 🚀 快速开始

```bash
git clone https://github.com/suzike/sunmemo-windows.git
cd sunmemo-windows
npm install
npm start        # 启动
npm run demo     # 启动并注入演示数据
```

要求：Node.js ≥ 18，Windows 10 / 11。

## 🧪 质量守护

```bash
npm start -- --test          # 状态机自测 19 项
node scripts-e2e.mjs         # 端到端 26 项（需应用运行中）
node tools/mem-baseline.mjs  # 内存基线采样
node tests/smoke.mjs         # 功能冒烟（文档卡/滚动/拖文本，需 demo 实例）
```

专项门禁（`tests/`）：`retract`（展开收回）· `dualmode`（扇面/滚动双模式）· `pdf-pages`（PDF 全页懒渲染）· `dragout-real`（真实光标拖出）· `live-gate`（悬停放大/回收站/缩略图自愈）· `fun-pack`（趣味四件套）· `peek-swap`（阅读面板串台）· `beacon-drop`（信标投递）。

每次发版前跑完全部自检与端到端用例；交互类功能（悬停放大、回收站等）以真实光标注入复测后才交付。

## 📦 版本

当前 **v1.7.0** —— 绳上小鸟、太阳种子、时光回忆板与每日发现卡。完整历史见 [CHANGELOG.md](CHANGELOG.md)。

## 📄 License

MIT
