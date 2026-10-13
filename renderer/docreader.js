'use strict';
// 文档卡共享渲染（line 悬停卡 / overlay 阅读面板两窗共用）：
//  - md/txt/csv  → 内置 markdown-lite 全文渲染（common.js renderPreviewBody）
//  - pdf         → PDF.js（vendor/pdfjs，按页懒渲染，悬停限前 6 页）
//  - docx        → docx-preview（vendor/docx，高保真分页）
//  - ppt/xls/doc → 精致类型板式 + 信息面板（无可靠轻量渲染器，点击系统应用打开）
// 窗口只有局部作用域，全部挂到 window.DOCR。
(function () {
  const META = {
    md:   { label: 'MD',   name: 'Markdown',  c1: '#8b5cf6', c2: '#6d28d9' },
    txt:  { label: 'TXT',  name: '纯文本',    c1: '#64748b', c2: '#334155' },
    pdf:  { label: 'PDF',  name: 'PDF 文档',  c1: '#ef4444', c2: '#b91c1c' },
    docx: { label: 'DOCX', name: 'Word 文档', c1: '#3b82f6', c2: '#1d4ed8' },
    doc:  { label: 'DOC',  name: 'Word 文档', c1: '#3b82f6', c2: '#1d4ed8' },
    ppt:  { label: 'PPT',  name: '演示文稿',  c1: '#f97316', c2: '#c2410c' },
    xls:  { label: 'XLS',  name: '电子表格',  c1: '#22c55e', c2: '#15803d' },
  };

  const api = window.sun;

  // ---- pdf.js 懒加载 + 文档句柄缓存（按文件路径） --------------------------
  // 注意：本文件位于 renderer/ 下，vendor 相对路径是 ./vendor（不是 ../vendor）。
  // 首次 import 偶发 "Failed to fetch"（冷盘/杀软扫描 1.7MB 文件的竞态）——
  // 延迟 400ms 重试一次，失败才真正抛错。
  let pdfjsPromise = null;
  function pdfjs() {
    if (!pdfjsPromise) {
      pdfjsPromise = import('./vendor/pdfjs/pdf.min.mjs')
        .catch(() => new Promise((res, rej) => setTimeout(() => import('./vendor/pdfjs/pdf.min.mjs').then(res, rej), 400)))
        .then(m => {
          // workerSrc 必须给绝对 URL：pdf.js 会以模块自身目录解析相对路径
          //（'./vendor' 会被拼成 vendor/pdfjs/vendor/pdfjs/...），页面在
          // renderer/line 与 renderer/overlay 同层，相对 location 一致。
          m.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', location.href).href;
          return m;
        })
        .catch(e => { pdfjsPromise = null; throw e; });
    }
    return pdfjsPromise;
  }
  const pdfDocs = new Map(); // url -> Promise<PDFDocumentProxy>
  function loadPdf(item) {
    if (!pdfDocs.has(item.url)) {
      pdfDocs.set(item.url,
        api.invoke('doc:load', item.url).then(r => {
          if (!r.ok) throw new Error(r.err || '读取失败');
          return pdfjs().then(p => p.getDocument({ data: r.buf }).promise);
        }).catch(e => { pdfDocs.delete(item.url); throw e; })
      );
    }
    return pdfDocs.get(item.url);
  }

  // ---- 小工具 ----------------------------------------------------------------

  function sizeText(n) {
    n = Number(n) || 0;
    if (n >= 1048576) return (n / 1048576).toFixed(1) + ' MB';
    if (n >= 1024) return Math.max(1, Math.round(n / 1024)) + ' KB';
    return n + ' B';
  }
  function mtimeText(ms) {
    if (!ms) return '';
    const d = new Date(ms);
    return d.getFullYear() === new Date().getFullYear()
      ? (d.getMonth() + 1) + '月' + d.getDate() + '日'
      : d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
  }
  // 文档纸纹缩略（md/txt/docx 无图渲染时的"纸面"）：第一条为标题行
  function paperHTML(item, snip) {
    let lines = '';
    const arr = String(snip || '').split('\n').map(s => s.trim()).filter(Boolean).slice(0, 6);
    for (let i = 0; i < 6; i++) {
      const t = arr[i] || '';
      lines += '<div class="doc-line' + (i === 0 ? ' is-title' : '') + (t ? '' : ' is-blank') + '">' +
        (t ? window.escapeHtml(t.slice(0, 22)) : '') + '</div>';
    }
    return '<div class="doc-paper"><div class="doc-paper-in">' + lines + '</div></div>';
  }

  // ---- 绳上文档卡缩略（renderCardContent 用） --------------------------------

  function cardHTML(item) {
    const m = META[item.docType] || META.txt;
    let visual;
    if (item.docType === 'pdf') {
      visual = '<canvas class="doc-page1" width="276" height="200"></canvas><div class="doc-page1-fallback">' + sheetGlyph(m) + '</div>';
    } else if (item.docType === 'md' || item.docType === 'txt') {
      visual = paperHTML(item, item.docSnip || '');
    } else if (item.docType === 'docx') {
      visual = '<div class="doc-paper docx"><div class="doc-paper-in">' +
        '<div class="doc-line is-title"></div><div class="doc-rule"></div>' +
        '<div class="doc-line"></div><div class="doc-line"></div><div class="doc-line is-blank"></div>' +
        '<div class="doc-line"></div><div class="doc-line is-blank"></div></div></div>';
    } else {
      visual = '<div class="doc-plate" style="background:linear-gradient(145deg,' + m.c1 + ',' + m.c2 + ')">' +
        sheetGlyph(m) + '<span class="doc-plate-label">' + m.label + '</span></div>';
    }
    return '<div class="doc-thumb">' + visual + '</div>' +
      '<div class="doc-info"><span class="doc-chip" style="background:' + m.c1 + '">' + m.label + '</span>' +
      '<span class="doc-name" title="' + window.escapeHtml(item.docName || '') + '">' + window.escapeHtml(item.docName || '') + '</span></div>' +
      '<div class="doc-sub">' + sizeText(item.docSize) + ' · ' + m.name + '</div>';
  }
  function sheetGlyph(m) {
    return '<svg class="doc-glyph" viewBox="0 0 40 52" fill="none">' +
      '<path d="M4 4a3 3 0 0 1 3-3h18l11 11v36a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V4Z" fill="rgba(255,255,255,0.92)"/>' +
      '<path d="M25 1l11 11H27a2 2 0 0 1-2-2V1Z" fill="rgba(0,0,0,0.10)"/>' +
      '<rect x="10" y="22" width="20" height="2.6" rx="1.3" fill="' + m.c1 + '"/>' +
      '<rect x="10" y="29" width="20" height="2.2" rx="1.1" fill="rgba(0,0,0,0.18)"/>' +
      '<rect x="10" y="35" width="14" height="2.2" rx="1.1" fill="rgba(0,0,0,0.14)"/></svg>';
  }

  // pdf 第 1 页 → 绳卡小图（懒渲染；失败保留 fallback，2.4s 后自动重试一次）
  const thumbTried = new Set();
  async function attachPdfThumb(cv, item) {
    if (thumbTried.has(item.id)) return;
    thumbTried.add(item.id);
    try {
      const doc = await loadPdf(item);
      const page = await doc.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const s = Math.min(cv.width / base.width, cv.height / base.height);
      const vp = page.getViewport({ scale: s });
      const ctx = cv.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, cv.width, cv.height);
      await page.render({ canvasContext: ctx, viewport: vp }).promise;
      cv.classList.add('ready');
      cv.parentElement && cv.parentElement.classList.add('has-page');
    } catch (e) {
      // 缩略失败保留类型板式兜底；错误留存便于诊断（window.__docrErr）
      (window.__docrErr = window.__docrErr || []).push(String(e && e.message || e).slice(0, 200));
      setTimeout(() => thumbTried.delete(item.id), 2400); // 冷盘/杀软竞态：允许重试
    }
  }

  // ---- 阅读器（悬停弹出 / overlay 大窗共用） ----------------------------------
  // buildReader(item, {width}) → { el, dispose() }；el 为 .docr 容器。

  async function buildReader(item, { width = 360, pdfPages = 4 } = {}) {
    const m = META[item.docType] || META.txt;
    const el = document.createElement('div');
    el.className = 'docr';
    el.style.setProperty('--docrw', width + 'px');
    const body = document.createElement('div');
    body.className = 'docr-body';
    el.innerHTML = '<div class="docr-head"><span class="doc-chip" style="background:' + m.c1 + '">' + m.label + '</span>' +
      '<span class="docr-name">' + window.escapeHtml(item.docName || '') + '</span>' +
      '<span class="docr-meta">' + sizeText(item.docSize) + (item.docMtime ? ' · ' + mtimeText(item.docMtime) : '') + '</span></div>';
    el.appendChild(body);
    body.innerHTML = '<div class="docr-loading"><span class="docr-spin"></span>正在打开…</div>';

    const renderTasks = new Set();
    let disposed = false;
    let dispose = () => {
      disposed = true;
      renderTasks.forEach(t => { try { t.cancel(); } catch { /* done */ } });
      renderTasks.clear();
    };

    try {
      if (item.docType === 'md' || item.docType === 'txt') {
        const r = await api.invoke('doc:load-text', item.url);
        if (disposed) return { el, dispose };
        if (!r.ok) throw new Error(r.err || '读取失败');
        // 先让加载态画一帧，再做大解析——消除打开瞬间的卡顿
        await new Promise(res => requestAnimationFrame(res));
        if (disposed) return { el, dispose };
        if (item.docType === 'md') {
          // 文档级排版：marked(GFM 表格/嵌套列表/代码块/链接) + DOMPurify 消毒；
          // 失败回退到内置 markdown-lite。
          let html = null;
          try {
            if (typeof window.marked !== 'undefined' && typeof window.DOMPurify !== 'undefined') {
              const raw = window.marked.parse(r.text, { gfm: true, breaks: true });
              html = window.DOMPurify.sanitize(raw, { ADD_ATTR: ['target'] });
            }
          } catch { html = null; }
          body.innerHTML = '<div class="docr-md"' + (html != null ? ' data-rich="1"' : '') + '>' +
            (html != null ? html : window.renderPreviewBody(r.text)) + '</div>';
          // 文内链接：http(s) 交给系统浏览器，锚点/相对路径直接忽略
          body.addEventListener('click', ev => {
            const a = ev.target.closest && ev.target.closest('a[href]');
            if (!a) return;
            ev.preventDefault();
            const href = a.getAttribute('href') || '';
            if (/^https?:\/\//i.test(href)) api.send('doc:open-external', href);
          });
        } else {
          body.innerHTML = '<pre class="docr-txt"></pre>';
          body.firstChild.textContent = r.text;
        }
      } else if (item.docType === 'pdf') {
        const doc = await loadPdf(item);
        if (disposed) return { el, dispose };
        const total = doc.numPages;
        // pdfPages<=0 = 全部页（大图阅读）；>0 = 速览前 N 页（悬停面板）
        const limit = pdfPages > 0 ? Math.min(pdfPages, total) : total;
        body.innerHTML = '';
        const dpr = window.devicePixelRatio || 1;
        const pageW = Math.max(200, width - 36);
        const renderInto = async (wrap, idx) => {
          const page = await doc.getPage(idx);
          if (disposed) return;
          const base = page.getViewport({ scale: 1 });
          const s = pageW / base.width;
          const vp = page.getViewport({ scale: s * dpr });
          const cv = document.createElement('canvas');
          cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
          wrap.style.height = Math.round(vp.height / dpr) + 'px';
          wrap.appendChild(cv);
          const task = page.render({ canvasContext: cv.getContext('2d'), viewport: vp });
          renderTasks.add(task);
          task.promise.then(() => renderTasks.delete(task)).catch(() => {});
        };
        // 余页占位 + 滚动懒渲染：大文件全量可读，打开也不再卡顿
        const io = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
          entries.forEach(en => {
            if (!en.isIntersecting) return;
            const wrap = en.target;
            io.unobserve(wrap);
            wrap.classList.remove('pending');
            renderInto(wrap, Number(wrap.dataset.page)).catch(() => {});
          });
        }, { root: body, rootMargin: '700px 0px' }) : null;
        const addPage = (idx, immediate) => {
          const wrap = document.createElement('div');
          wrap.className = 'docr-pdf-page pending';
          wrap.dataset.page = idx; // 懒渲染回调从这里取页码
          wrap.style.height = Math.round(pageW * 1.414) + 'px'; // A4 估算高，渲染后校正
          body.appendChild(wrap);
          if (immediate || !io) { wrap.classList.remove('pending'); renderInto(wrap, idx).catch(() => {}); }
          else io.observe(wrap);
        };
        addPage(1, true); // 首页立即渲染
        for (let pg = 2; pg <= limit; pg++) addPage(pg, false);
        const foot = document.createElement('div');
        foot.className = 'docr-pdf-foot';
        foot.textContent = '共 ' + total + ' 页' + (total > limit ? ' · 悬停速览前 ' + limit + ' 页，点击卡片看全部' : '');
        if (limit < total) body.appendChild(foot);
        const oldDispose = dispose;
        dispose = () => { if (io) io.disconnect(); oldDispose(); };
      } else if (item.docType === 'docx') {
        if (typeof window.docx === 'undefined') throw new Error('docx 渲染器未加载');
        const r = await api.invoke('doc:load', item.url);
        if (disposed) return { el, dispose };
        if (!r.ok) throw new Error(r.err || '读取失败');
        body.innerHTML = '';
        body.classList.add('docr-docx');
        // A4 原生宽 ~880px，面板内放不下——按面板宽自动 zoom 整页缩放
        body.style.setProperty('--dxz', String(Math.max(0.34, Math.min(1, (width - 46) / 900))));
        await window.docx.renderAsync(r.buf, body, null, { inWrapper: true, breakPages: true, ignoreWidth: false });
      } else if (item.docType === 'ppt' && /\.pptx$/i.test(item.url || '')) {
        // PPTX 悬停速览：抽取每页文字（JSZip 已内置），按"幻灯片"卡呈现
        if (typeof window.JSZip === 'undefined') throw new Error('解析器未加载');
        const r = await api.invoke('doc:load', item.url);
        if (disposed) return { el, dispose };
        if (!r.ok) throw new Error(r.err || '读取失败');
        const zip = await window.JSZip.loadAsync(r.buf);
        if (disposed) return { el, dispose };
        const names = Object.keys(zip.files)
          .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
          .sort((a, b) => (parseInt(a.match(/\d+/)[0], 10) - parseInt(b.match(/\d+/)[0], 10)));
        if (!names.length) throw new Error('未找到可读的幻灯片文字');
        const un = t => String(t).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
        body.innerHTML = '';
        names.forEach((n, i) => {
          const xml = zip.files[n].asText();
          const texts = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(m2 => un(m2[1])).filter(t2 => t2.trim());
          const wrap = document.createElement('div');
          wrap.className = 'docr-ppt-page';
          wrap.innerHTML = '<div class="docr-ppt-num">第 ' + (i + 1) + ' 页</div>' +
            (texts.length ? texts.slice(0, 10).map(t2 => '<div class="docr-ppt-line">' + window.escapeHtml(t2) + '</div>').join('')
              : '<div class="docr-ppt-line empty">（本页无文字内容）</div>');
          body.appendChild(wrap);
        });
        const foot2 = document.createElement('div');
        foot2.className = 'docr-pdf-foot';
        foot2.textContent = '共 ' + names.length + ' 页（文字版速览）· 点击卡片用系统应用打开';
        body.appendChild(foot2);
      } else {
        body.innerHTML = '<div class="docr-info"><div class="docr-info-glyph" style="background:linear-gradient(145deg,' + m.c1 + ',' + m.c2 + ')">' + sheetGlyph(m) + '</div>' +
          '<div class="docr-info-name">' + window.escapeHtml(item.docName || '') + '</div>' +
          '<div class="docr-info-meta">' + m.name + ' · ' + sizeText(item.docSize) + (item.docMtime ? ' · 修改于 ' + mtimeText(item.docMtime) : '') + '</div>' +
          '<div class="docr-info-hint">这类文档暂不支持悬停内读，点击卡片用系统应用打开</div></div>';
      }
    } catch (e) {
      body.innerHTML = '<div class="docr-err">打不开这份文档<br><span>' + window.escapeHtml(String(e && e.message || e).slice(0, 80)) + '</span></div>';
    }
    return { el, dispose };
  }

  window.DOCR = { META, meta: t => META[t] || META.txt, sizeText, mtimeText, cardHTML, attachPdfThumb, buildReader };

  // 预热：空闲时提前加载 PDF.js 渲染模块（首次打开 PDF 不再卡顿）
  setTimeout(() => { pdfjs().catch(() => { /* 网络盘/杀软竞态，用时重试 */ }); }, 2500);
})();
