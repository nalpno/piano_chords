/*
 * Chord diagram renderer: produces SVG markup of a small keyboard with the
 * chord's keys highlighted (the "piano chord chart" style).
 */
(function (PC) {
  'use strict';

  const T = PC.Theory;
  const FONT = 'Helvetica, Arial, sans-serif';
  const WW = 16; // white key width
  const WH = 68; // white key height
  const BW = 10; // black key width
  const BH = 42; // black key height
  const PAD = 4;

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  /** Keyboard range for a diagram: starts on a white key, at least two octaves. */
  function range(notes, minWhites) {
    const lo = Math.min(...notes);
    const hi = Math.max(...notes);
    let start = T.isBlack(lo) ? lo - 1 : lo;
    // Start on C or F when that costs at most two extra white keys (looks tidier).
    for (let s = start, whites = 0; s >= T.MIDI_MIN && whites <= 2; s--) {
      if (T.isBlack(s)) continue;
      if (T.mod12(s) === 0 || T.mod12(s) === 5) { start = s; break; }
      whites++;
    }
    start = Math.max(start, T.MIDI_MIN);
    let end = start;
    let whites = 1;
    while (end < T.MIDI_MAX && (whites < minWhites || end < hi)) {
      end++;
      if (!T.isBlack(end)) whites++;
    }
    if (T.isBlack(end) && end < T.MIDI_MAX) end++;
    return { start, end };
  }

  /**
   * Build diagram parts.
   * opts: { name, labels[], showHeader, showLabels, noteList, style:'classic'|'dots', color, minWhites }
   * returns { w, h, body }
   */
  function parts(notes, opts) {
    const o = Object.assign({
      name: '', labels: null, showHeader: true, showLabels: true,
      style: 'classic', color: '#d32f2f', minWhites: 14,
    }, opts);
    const sorted = [...new Set(notes)].sort((a, b) => a - b);
    const labels = o.labels || (sorted.length ? T.labelNotes(sorted, null) : []);
    const on = new Map();
    sorted.forEach((n, i) => on.set(n, labels[i]));

    const r = sorted.length ? range(sorted, o.minWhites) : { start: 48, end: 71 };
    const whites = [];
    const blacks = [];
    const xOf = {};
    let wi = 0;
    for (let m = r.start; m <= r.end; m++) {
      if (T.isBlack(m)) {
        const x = PAD + wi * WW - BW / 2;
        blacks.push({ m, x });
        xOf[m] = x + BW / 2;
      } else {
        const x = PAD + wi * WW;
        whites.push({ m, x });
        xOf[m] = x + WW / 2;
        wi++;
      }
    }
    const kbW = wi * WW;
    const w = kbW + PAD * 2;
    const headerH = o.showHeader ? 30 : 0;
    const top = headerH + PAD;

    // Label rows below the keyboard (alternate rows when labels would collide).
    const labelItems = [];
    if (o.showLabels) {
      const lastX = [-99, -99];
      sorted.forEach((n) => {
        const x = xOf[n];
        let row = x - lastX[0] >= 24 ? 0 : x - lastX[1] >= 24 ? 1 : 0;
        lastX[row] = x;
        labelItems.push({ x, row, text: on.get(n) });
      });
    }
    const rows = labelItems.length ? Math.max(...labelItems.map((l) => l.row)) + 1 : 0;
    const h = top + WH + (rows ? 6 + rows * 13 : 0) + PAD;

    const color = o.color;
    const out = [];
    out.push(`<rect x="0" y="0" width="${w}" height="${h}" fill="#ffffff"/>`);
    if (o.showHeader) {
      out.push(`<text x="${PAD}" y="22" font-family="${FONT}" font-size="20" font-weight="700" fill="#111">${esc(o.name || '')}</text>`);
      if (o.noteList !== false) {
        const list = o.noteList || labels.join(' ');
        out.push(`<text x="${w - PAD}" y="20" font-family="${FONT}" font-size="10.5" fill="#444" text-anchor="end">${esc(list)}</text>`);
      }
    }
    // White keys
    whites.forEach((k) => {
      const lit = on.has(k.m);
      const fill = lit && o.style === 'classic' ? color : '#ffffff';
      out.push(`<rect x="${k.x}" y="${top}" width="${WW}" height="${WH}" fill="${fill}" stroke="#222" stroke-width="1"/>`);
      if (lit && o.style === 'dots') {
        out.push(`<circle cx="${k.x + WW / 2}" cy="${top + WH - 10}" r="5" fill="${color}"/>`);
      }
    });
    // Black keys
    blacks.forEach((k) => {
      const lit = on.has(k.m);
      const fill = lit && o.style === 'classic' ? color : '#1a1a1a';
      out.push(`<rect x="${k.x}" y="${top}" width="${BW}" height="${BH}" fill="${fill}" stroke="#111" stroke-width="1"/>`);
      if (lit && o.style === 'dots') {
        out.push(`<circle cx="${k.x + BW / 2}" cy="${top + BH - 8}" r="4" fill="${color}" stroke="#fff" stroke-width="1"/>`);
      }
    });
    out.push(`<rect x="${PAD}" y="${top}" width="${kbW}" height="${WH}" fill="none" stroke="#111" stroke-width="1.5"/>`);
    labelItems.forEach((l) => {
      const y = top + WH + 14 + l.row * 13;
      out.push(`<text x="${l.x}" y="${y}" font-family="${FONT}" font-size="10" fill="#333" text-anchor="middle">${esc(l.text)}</text>`);
    });
    return { w, h, body: out.join('') };
  }

  function svg(notes, opts, scale) {
    const p = parts(notes, opts);
    const s = scale || 1;
    return {
      w: p.w, h: p.h,
      svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${p.w * s}" height="${p.h * s}" viewBox="0 0 ${p.w} ${p.h}">${p.body}</svg>`,
    };
  }

  PC.Diagram = { parts, svg, esc, FONT };
})(window.PC = window.PC || {});
