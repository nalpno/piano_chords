/*
 * Song chart: parse lyrics with chords (ChordPro "[C]word" or chords-over-lyrics),
 * render them on screen and lay them out as SVG pages for PNG / PDF export.
 */
(function (PC) {
  'use strict';

  const T = PC.Theory;
  const D = PC.Diagram;
  const X = PC.Export;
  const FONT = D.FONT;
  const NC = /^(N\.?C\.?|n\.?c\.?)$/;

  function isChordToken(tok) {
    return T.isChord(tok) || NC.test(tok);
  }

  // Tokens allowed on a chord line besides chords (bar lines, repeats...).
  function isFillerToken(tok) {
    return /^(\||\|\||:\|\|?|\|\|?:|-+|\/|%|x\d+|\(x?\d+x?\)|\.+)$/i.test(tok);
  }

  function isChordLine(line) {
    const toks = line.trim().split(/\s+/).filter(Boolean);
    if (!toks.length) return false;
    let chords = 0;
    for (const t of toks) {
      const bare = t.replace(/^\(|\)$/g, '');
      if (isChordToken(bare)) chords++;
      else if (!isFillerToken(t)) return false;
    }
    return chords > 0;
  }

  function chordColumns(line) {
    const out = [];
    const re = /\S+/g;
    let m;
    while ((m = re.exec(line))) {
      const bare = m[0].replace(/^\(|\)$/g, '');
      if (isChordToken(bare)) out.push({ col: m.index, chord: bare });
    }
    return out;
  }

  function sectionOf(line) {
    const t = line.trim();
    let m = /^\{(?:c|comment|ci|comment_italic|start_of_\w+|soc|sov|sob)\s*:?\s*(.*)\}$/i.exec(t);
    if (m) return m[1] || null;
    m = /^\[([^\]]+)\]$/.exec(t);
    if (m && !isChordToken(m[1].trim())) return m[1].trim();
    m = /^([A-Za-zÇĞİÖŞÜçğıöşü][\wÇĞİÖŞÜçğıöşü .'-]{0,30}):$/.exec(t);
    if (m) return m[1];
    return null;
  }

  /** Parse song text into { title, artist, lines[] }. */
  function parse(text) {
    const song = { title: '', artist: '', lines: [] };
    const raw = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    for (let i = 0; i < raw.length; i++) {
      const line = raw[i].replace(/\t/g, '    ');
      const trimmed = line.trim();
      let m;
      if ((m = /^\{\s*(title|t)\s*:\s*(.*)\}$/i.exec(trimmed))) { song.title = m[2].trim(); continue; }
      if ((m = /^\{\s*(artist|subtitle|st|a)\s*:\s*(.*)\}$/i.exec(trimmed))) { song.artist = m[2].trim(); continue; }
      if (/^\{\s*(end_of_\w+|eoc|eov|eob)\s*\}$/i.test(trimmed)) continue;
      if (!trimmed) { song.lines.push({ type: 'empty' }); continue; }
      if (/^\{.*\}$/.test(trimmed) && !sectionOf(trimmed)) continue;
      const section = sectionOf(line);
      if (section) { song.lines.push({ type: 'section', text: section }); continue; }

      // Inline ChordPro chords: "[Am]Hello [F]darkness"
      if (/\[[^\]]+\]/.test(line)) {
        const segs = [];
        const re = /\[([^\]]*)\]/g;
        let last = 0;
        let chord = null;
        while ((m = re.exec(line))) {
          const txt = line.slice(last, m.index);
          if (txt || chord) segs.push({ chord, text: txt });
          chord = m[1].trim() || null;
          last = re.lastIndex;
        }
        segs.push({ chord, text: line.slice(last) });
        song.lines.push({ type: 'lyric', segments: segs.filter((s) => s.chord || s.text) });
        continue;
      }

      // Chords above lyrics
      if (isChordLine(line)) {
        const cols = chordColumns(line);
        const next = raw[i + 1] !== undefined ? raw[i + 1].replace(/\t/g, '    ') : null;
        if (next !== null && next.trim() && !isChordLine(next) && !sectionOf(next) && !/^\{.*\}$/.test(next.trim())) {
          const segs = [];
          if (cols[0].col > 0) segs.push({ chord: null, text: next.slice(0, cols[0].col) });
          cols.forEach((c, k) => {
            const end = k + 1 < cols.length ? cols[k + 1].col : undefined;
            segs.push({ chord: c.chord, text: next.slice(c.col, end) });
          });
          song.lines.push({ type: 'lyric', segments: segs.filter((s) => s.chord || s.text) });
          i++;
        } else {
          song.lines.push({ type: 'lyric', segments: cols.map((c) => ({ chord: c.chord, text: '' })) });
        }
        continue;
      }
      song.lines.push({ type: 'lyric', segments: [{ chord: null, text: line }] });
    }
    // Trim leading/trailing blank lines
    while (song.lines.length && song.lines[0].type === 'empty') song.lines.shift();
    while (song.lines.length && song.lines[song.lines.length - 1].type === 'empty') song.lines.pop();
    return song;
  }

  function transpose(song, semitones) {
    if (!semitones) return song;
    return Object.assign({}, song, {
      lines: song.lines.map((l) => (l.type !== 'lyric' ? l : Object.assign({}, l, {
        segments: l.segments.map((s) => ({ chord: s.chord ? T.transposeSymbol(s.chord, semitones) : null, text: s.text })),
      }))),
    });
  }

  /** Unique chords in order of appearance. */
  function uniqueChords(song) {
    const seen = new Set();
    const out = [];
    song.lines.forEach((l) => {
      if (l.type !== 'lyric') return;
      l.segments.forEach((s) => {
        if (!s.chord || NC.test(s.chord)) return;
        const key = T.canonical(s.chord);
        if (seen.has(key)) return;
        seen.add(key);
        out.push(s.chord);
      });
    });
    return out;
  }

  /**
   * Split segments into word pieces so long lines can wrap at spaces.
   * The chord stays on the first piece; `hyphen` marks a word split by a chord.
   */
  function pieces(segments) {
    const out = [];
    segments.forEach((s, idx) => {
      const words = s.text.match(/\S+\s*|\s+/g) || [''];
      words.forEach((w, k) => out.push({ chord: k === 0 ? s.chord : null, text: w }));
      const next = segments[idx + 1];
      const lastPiece = out[out.length - 1];
      if (next && next.chord && s.text && /\S$/.test(s.text) && /^\S/.test(next.text)) lastPiece.hyphen = true;
    });
    return out;
  }

  // ---------- On-screen rendering ----------

  function renderHTML(song, resolve, opts) {
    const esc = D.esc;
    const html = [];
    if (song.title) html.push(`<h2 class="sheet-title">${esc(song.title)}</h2>`);
    if (song.artist) html.push(`<div class="sheet-artist">${esc(song.artist)}</div>`);
    const chords = uniqueChords(song);
    if (opts.showChart && chords.length) {
      html.push('<div class="sheet-chart">');
      chords.forEach((c) => {
        const r = resolve(c);
        if (!r) return;
        const d = D.svg(r.notes, { name: r.display, labels: r.labels, noteList: false, style: opts.style, color: opts.color }, 0.85);
        html.push(`<button type="button" class="chart-item" data-chord="${esc(c)}" title="${esc(r.labels.join(' '))}">${d.svg}</button>`);
      });
      html.push('</div>');
    }
    html.push('<div class="sheet-lyrics">');
    song.lines.forEach((l) => {
      if (l.type === 'empty') { html.push('<div class="sheet-gap"></div>'); return; }
      if (l.type === 'section') { html.push(`<div class="sheet-section">${esc(l.text)}</div>`); return; }
      const hasChord = l.segments.some((s) => s.chord);
      html.push(`<div class="sheet-line${hasChord ? ' has-chords' : ''}">`);
      pieces(l.segments).forEach((p) => {
        let chordHtml = '';
        if (p.chord) {
          const r = resolve(p.chord);
          const diag = r && opts.inline
            ? D.svg(r.notes, { showHeader: false, showLabels: false, style: opts.style, color: opts.color }, opts.inlineScale).svg
            : '';
          chordHtml = `<span class="seg-chord" data-chord="${esc(p.chord)}"><span class="seg-name">${esc(r ? r.display : p.chord)}</span>${diag}</span>`;
        } else if (hasChord) {
          chordHtml = '<span class="seg-chord empty"></span>';
        }
        const text = p.text ? esc(p.text) : '&nbsp;';
        html.push(`<span class="seg">${chordHtml}<span class="seg-text${p.hyphen ? ' hyphen' : ''}">${text}</span></span>`);
      });
      html.push('</div>');
    });
    html.push('</div>');
    return html.join('');
  }

  // ---------- SVG layout for export ----------

  const PAGE_W = 794;
  const PAGE_H = 1123;
  const MARGIN = 48;

  /** Flow chord diagrams in a grid; returns blocks { h, draw(y) }. */
  function gridBlocks(items, opts, contentW) {
    const scale = opts.gridScale || 0.8;
    const gap = 14;
    const blocks = [];
    let row = [];
    let rowW = 0;
    const flush = () => {
      if (!row.length) return;
      const r = row;
      const h = Math.max(...r.map((d) => d.h * scale)) + gap;
      blocks.push({
        h,
        draw: (y) => r.map((d) => `<g transform="translate(${MARGIN + d.x},${y}) scale(${scale})">${d.body}</g>`).join(''),
      });
      row = [];
      rowW = 0;
    };
    items.forEach((it) => {
      const p = D.parts(it.notes, { name: it.display, labels: it.labels, noteList: opts.noteList === false ? false : undefined, style: opts.style, color: opts.color });
      const w = p.w * scale;
      if (row.length && rowW + w > contentW) flush();
      row.push({ x: rowW, h: p.h, body: p.body });
      rowW += w + gap;
    });
    flush();
    return blocks;
  }

  function textBlock(text, size, weight, color, spaceBefore, italic) {
    const esc = D.esc;
    return {
      h: size * 1.35 + (spaceBefore || 0),
      draw: (y) => `<text x="${MARGIN}" y="${y + (spaceBefore || 0) + size}" font-family="${FONT}" font-size="${size}" font-weight="${weight}"${italic ? ' font-style="italic"' : ''} fill="${color}" xml:space="preserve">${esc(text)}</text>`,
    };
  }

  function lyricBlocks(song, resolve, opts, contentW) {
    const esc = D.esc;
    const lyricSize = 15;
    const chordSize = 14;
    const lyricFont = `${lyricSize}px ${FONT}`;
    const chordFont = `bold ${chordSize}px ${FONT}`;
    const ds = opts.inlineScale;
    const blocks = [];

    song.lines.forEach((l) => {
      if (l.type === 'empty') { blocks.push({ h: 12, draw: () => '' }); return; }
      if (l.type === 'section') { blocks.push(textBlock(l.text, 14, 700, '#555', 8, true)); return; }
      const hasChord = l.segments.some((s) => s.chord);
      const items = pieces(l.segments).map((p) => {
        const r = p.chord ? resolve(p.chord) : null;
        const label = p.chord ? (r ? r.display : p.chord) : '';
        const diag = r && opts.inline ? D.parts(r.notes, { showHeader: false, showLabels: false, style: opts.style, color: opts.color }) : null;
        const text = p.text;
        const tw = X.measure(text.replace(/\s+$/, ' '), lyricFont);
        const cw = label ? X.measure(label, chordFont) + 8 : 0;
        const dw = diag ? diag.w * ds + 6 : 0;
        return { p, label, diag, text, w: Math.max(tw, cw, dw), dh: diag ? diag.h * ds : 0 };
      });
      // Wrap into rows
      const rows = [];
      let cur = [];
      let x = 0;
      items.forEach((it) => {
        if (cur.length && x + it.w > contentW && it.p.text.trim()) {
          rows.push(cur);
          cur = [];
          x = 0;
        }
        it.x = x;
        cur.push(it);
        x += it.w;
      });
      if (cur.length) rows.push(cur);

      rows.forEach((r) => {
        const rowHasChord = hasChord && r.some((it) => it.label);
        const diagH = rowHasChord ? Math.max(0, ...r.map((it) => it.dh)) : 0;
        const chordH = rowHasChord ? chordSize + 4 + (diagH ? diagH + 4 : 0) : 0;
        const h = chordH + lyricSize * 1.45;
        blocks.push({
          h,
          draw: (y) => r.map((it) => {
            const out = [];
            const x0 = MARGIN + it.x;
            if (it.label) {
              out.push(`<text x="${x0}" y="${y + chordSize}" font-family="${FONT}" font-size="${chordSize}" font-weight="700" fill="${opts.color}">${esc(it.label)}</text>`);
              if (it.diag) out.push(`<g transform="translate(${x0},${y + chordSize + 4}) scale(${ds})">${it.diag.body}</g>`);
            }
            const ty = y + chordH + lyricSize;
            if (it.text) out.push(`<text x="${x0}" y="${ty}" font-family="${FONT}" font-size="${lyricSize}" fill="#111" xml:space="preserve">${esc(it.text)}</text>`);
            if (it.p.hyphen) {
              const tw = X.measure(it.text, lyricFont);
              if (it.w - tw > 14) out.push(`<text x="${x0 + (tw + it.w) / 2}" y="${ty}" font-family="${FONT}" font-size="${lyricSize}" fill="#999" text-anchor="middle">-</text>`);
            }
            return out.join('');
          }).join(''),
        });
      });
    });
    return blocks;
  }

  /** Put blocks on A4-sized pages (or one long page when `continuous`). */
  function compose(blocks, continuous) {
    const pages = [];
    let body = [];
    let y = MARGIN;
    blocks.forEach((b) => {
      if (!continuous && y + b.h > PAGE_H - MARGIN && body.length) {
        pages.push({ body: body.join(''), w: PAGE_W, h: PAGE_H });
        body = [];
        y = MARGIN;
      }
      body.push(b.draw(y));
      y += b.h;
    });
    if (continuous) return [{ body: body.join(''), w: PAGE_W, h: Math.ceil(y + MARGIN) }];
    pages.push({ body: body.join(''), w: PAGE_W, h: PAGE_H });
    return pages;
  }

  function sheetPages(song, resolve, opts, continuous) {
    const contentW = PAGE_W - MARGIN * 2;
    const blocks = [];
    if (song.title) blocks.push(textBlock(song.title, 26, 700, '#111', 0));
    if (song.artist) blocks.push(textBlock(song.artist, 15, 400, '#555', 0));
    if (song.title || song.artist) blocks.push({ h: 10, draw: () => '' });
    const chords = uniqueChords(song).map(resolve).filter(Boolean);
    if (opts.showChart && chords.length) {
      blocks.push(...gridBlocks(chords, Object.assign({}, opts, { gridScale: 0.72, noteList: false }), contentW));
      blocks.push({ h: 12, draw: () => '' });
    }
    blocks.push(...lyricBlocks(song, resolve, opts, contentW));
    return compose(blocks, continuous);
  }

  /** Pages for a list of chord diagrams (library export). */
  function gridPages(title, items, opts, continuous) {
    const contentW = PAGE_W - MARGIN * 2;
    const blocks = [];
    if (title) {
      blocks.push(textBlock(title, 24, 700, '#111', 0));
      blocks.push({ h: 12, draw: () => '' });
    }
    blocks.push(...gridBlocks(items, Object.assign({ gridScale: 1 }, opts), contentW));
    return compose(blocks, continuous);
  }

  PC.Song = { parse, transpose, uniqueChords, renderHTML, sheetPages, gridPages };
})(window.PC = window.PC || {});
