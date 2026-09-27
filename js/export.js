/*
 * Export helpers: SVG -> PNG, multi-page PDF (jsPDF, loaded on demand),
 * text measuring and file downloads.
 */
(function (PC) {
  'use strict';

  // Bundled copy first (works offline), CDN as a fallback.
  const JSPDF_URLS = ['vendor/jspdf.umd.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.2/jspdf.umd.min.js'];
  let jspdfPromise = null;
  let measureCtx = null;

  function measure(text, font) {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    measureCtx.font = font;
    return measureCtx.measureText(text).width;
  }

  function fileName(name, ext) {
    const base = String(name || 'chord').trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_') || 'chord';
    return base + '.' + ext;
  }

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function svgToCanvas(svgMarkup, w, h, scale) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = Math.round(w * scale);
        c.height = Math.round(h * scale);
        const g = c.getContext('2d');
        g.fillStyle = '#ffffff';
        g.fillRect(0, 0, c.width, c.height);
        g.drawImage(img, 0, 0, c.width, c.height);
        resolve(c);
      };
      img.onerror = reject;
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgMarkup);
    });
  }

  function wrapSvg(body, w, h) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
      `<rect width="${w}" height="${h}" fill="#fff"/>${body}</svg>`;
  }

  /** page: { body, w, h } */
  async function png(page, name, scale) {
    const c = await svgToCanvas(wrapSvg(page.body, page.w, page.h), page.w, page.h, scale || 3);
    await new Promise((res) => c.toBlob((b) => { download(b, fileName(name, 'png')); res(); }, 'image/png'));
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = () => { s.remove(); reject(new Error('Could not load ' + src)); };
      document.head.appendChild(s);
    });
  }

  function loadJsPdf() {
    if (window.jspdf) return Promise.resolve(window.jspdf);
    if (!jspdfPromise) {
      jspdfPromise = JSPDF_URLS.reduce(
        (p, url) => p.catch(() => loadScript(url).then(() => {
          if (!window.jspdf) throw new Error('jsPDF missing');
          return window.jspdf;
        })),
        Promise.reject(new Error('start')),
      ).catch((e) => { jspdfPromise = null; throw e; });
    }
    return jspdfPromise;
  }

  /** pages: [{ body, w, h }] - each page is fitted onto an A4 sheet. */
  async function pdf(pages, name) {
    const canvases = [];
    for (const p of pages) canvases.push(await svgToCanvas(wrapSvg(p.body, p.w, p.h), p.w, p.h, 2.5));
    let lib;
    try {
      lib = await loadJsPdf();
    } catch (e) {
      printFallback(canvases, name);
      return;
    }
    const doc = new lib.jsPDF({ unit: 'pt', format: 'a4', compress: true });
    const pw = doc.internal.pageSize.getWidth();
    const ph = doc.internal.pageSize.getHeight();
    canvases.forEach((c, i) => {
      if (i > 0) doc.addPage();
      const ratio = Math.min(pw / c.width, ph / c.height);
      const w = c.width * ratio;
      const h = c.height * ratio;
      doc.addImage(c.toDataURL('image/png'), 'PNG', (pw - w) / 2, 0, w, h, undefined, 'FAST');
    });
    doc.save(fileName(name, 'pdf'));
  }

  /** Offline fallback: open a print window so the user can "Save as PDF". */
  function printFallback(canvases, name) {
    const win = window.open('', '_blank');
    if (!win) return;
    const imgs = canvases.map((c) => `<img src="${c.toDataURL('image/png')}" style="width:100%;page-break-after:always">`).join('');
    win.document.write(`<!doctype html><title>${PC.Diagram.esc(name)}</title><style>@page{size:A4;margin:0}body{margin:0}</style>${imgs}`);
    win.document.close();
    win.onload = () => win.print();
  }

  PC.Export = { measure, download, fileName, png, pdf, wrapSvg };
})(window.PC = window.PC || {});
