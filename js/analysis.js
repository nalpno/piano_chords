/*
 * Chord progression analysis for MIDI files: key estimation, bar grid and
 * window-by-window chord recognition with smoothing.
 */
(function (PC) {
  'use strict';

  const T = PC.Theory;

  const DETAIL = {
    triads: ['', 'm', 'dim', 'aug', 'sus4', 'sus2'],
    sevenths: ['', 'm', 'dim', 'aug', 'sus4', 'sus2', '7', 'maj7', 'm7', 'm7b5', 'dim7', '6', 'm6', '7sus4'],
    extended: ['', 'm', 'dim', 'aug', 'sus4', 'sus2', '7', 'maj7', 'm7', 'm7b5', 'dim7', '6', 'm6', '7sus4',
      'add9', 'madd9', '9', 'maj9', 'm9', '6/9', '7b9', '7#9', 'aug7', 'm11', '13'],
  };

  // Krumhansl-Kessler key profiles
  const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const MINOR = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  const MAJOR_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const MINOR_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];
  const FLAT_MAJOR = [1, 3, 5, 8, 10];
  const FLAT_MINOR = [0, 2, 3, 5, 7, 10];

  function correlate(a, b) {
    const n = a.length;
    const ma = a.reduce((s, x) => s + x, 0) / n;
    const mb = b.reduce((s, x) => s + x, 0) / n;
    let num = 0;
    let da = 0;
    let db = 0;
    for (let i = 0; i < n; i++) {
      num += (a[i] - ma) * (b[i] - mb);
      da += (a[i] - ma) ** 2;
      db += (b[i] - mb) ** 2;
    }
    return da && db ? num / Math.sqrt(da * db) : 0;
  }

  function estimateKey(hist) {
    let best = null;
    for (let tonic = 0; tonic < 12; tonic++) {
      const rotated = hist.map((_, i) => hist[(i + tonic) % 12]);
      [[MAJOR, false], [MINOR, true]].forEach(([profile, minor]) => {
        const r = correlate(rotated, profile);
        if (!best || r > best.r) best = { tonic, minor, r };
      });
    }
    if (!best) return null;
    const name = best.minor ? MINOR_NAMES[best.tonic] + 'm' : MAJOR_NAMES[best.tonic];
    let flats = null; // null = neutral (C major / A minor)
    if (best.minor) {
      if (FLAT_MINOR.includes(best.tonic)) flats = true;
      else if (best.tonic !== 9) flats = false;
    } else if (FLAT_MAJOR.includes(best.tonic)) flats = true;
    else if (best.tonic !== 0) flats = false;
    return { tonic: best.tonic, minor: best.minor, name, flats, confidence: best.r };
  }

  /** Bars from the time-signature map. */
  function buildBars(song, endTick) {
    const bars = [];
    const sigs = song.timeSigs;
    let tick = 0;
    let si = 0;
    while (tick < endTick || bars.length === 0) {
      while (si + 1 < sigs.length && sigs[si + 1].tick <= tick) si++;
      const sig = sigs[si];
      const beatLen = (song.ppq * 4) / sig.den;
      const len = beatLen * sig.num;
      bars.push({ index: bars.length, start: tick, end: tick + len, num: sig.num, den: sig.den, beatLen });
      tick += len;
      if (bars.length > 5000) break;
    }
    return bars;
  }

  function windowsFor(bar, resolution) {
    let beats;
    if (resolution === 'bar') beats = bar.num;
    else if (resolution === 'half') beats = bar.num % 2 === 0 ? bar.num / 2 : bar.num;
    else beats = bar.den === 8 && bar.num % 3 === 0 ? 3 : 1; // compound meters: dotted-quarter beats
    const out = [];
    for (let b = 0; b < bar.num; b += beats) {
      out.push({ start: bar.start + b * bar.beatLen, end: bar.start + Math.min(bar.num, b + beats) * bar.beatLen, bar: bar.index, beat: b });
    }
    return out;
  }

  function scoreTemplate(w, root, template, bassPc) {
    let inW = 0;
    let missing = 0;
    template.pcs.forEach((p) => {
      const v = w[(root + p) % 12];
      inW += v;
      if (v < 0.02) missing++;
    });
    let score = inW - 0.7 * (1 - inW) - 0.12 * missing - 0.05 * Math.max(0, template.pcs.length - 3);
    if (root === bassPc) score += 0.1;
    if (w[root] < 0.02) score -= 0.15;
    return score;
  }

  /**
   * Analyse a parsed MIDI song.
   * opts: { tracks: Set<index>, resolution: 'beat'|'half'|'bar', detail, slash }
   */
  function analyze(song, opts) {
    const o = Object.assign({ resolution: 'beat', detail: 'sevenths', slash: true }, opts);
    const notes = [];
    song.tracks.forEach((tr) => {
      if (o.tracks && !o.tracks.has(tr.index)) return;
      tr.notes.forEach((n) => { if (n.channel !== 9) notes.push(n); });
    });
    notes.sort((a, b) => a.start - b.start);
    const endTick = notes.reduce((m, n) => Math.max(m, n.end), 0);
    const toSec = PC.MidiFile.timeMap(song);

    // Key from duration-weighted pitch classes.
    const hist = new Array(12).fill(0);
    notes.forEach((n) => { hist[n.midi % 12] += (n.end - n.start) * (0.5 + n.velocity / 254); });
    const key = notes.length ? estimateKey(hist) : null;

    const bars = buildBars(song, endTick);
    const templates = DETAIL[o.detail].map((s) => T.templateBySuffix[s]);
    const windows = [];
    bars.forEach((bar) => windows.push(...windowsFor(bar, o.resolution)));

    // Pass 1: pitch-class weights, bass and sounding notes per window.
    let idx = 0;
    let active = [];
    const frames = windows.map((win) => {
      while (idx < notes.length && notes[idx].start < win.end) active.push(notes[idx++]);
      active = active.filter((n) => n.end > win.start);
      const len = win.end - win.start;
      const raw = new Array(12).fill(0);
      let total = 0;
      let bass = null;
      const sounding = [];
      active.forEach((n) => {
        const ov = Math.min(n.end, win.end) - Math.max(n.start, win.start);
        if (ov <= 0) return;
        const frac = ov / len;
        // Bass notes define the harmony more than melody notes do.
        const register = n.midi < 55 ? 1.3 : n.midi >= 72 ? 0.7 : 1;
        const weight = frac * (0.5 + n.velocity / 254) * register;
        raw[n.midi % 12] += weight;
        total += weight;
        if (frac >= 0.25) {
          sounding.push(n.midi);
          if (bass === null || n.midi < bass) bass = n.midi;
        }
      });
      if (bass === null && total > 0) bass = Math.min(...active.filter((n) => n.end > win.start && n.start < win.end).map((n) => n.midi));
      return { win, raw, total, bass, notes: [...new Set(sounding)].sort((a, b) => a - b) };
    });
    // Whole-bar weights give context to sparse windows (arpeggios, broken chords).
    const barRaw = {};
    frames.forEach((f) => {
      const b = barRaw[f.win.bar] || (barRaw[f.win.bar] = new Array(12).fill(0));
      f.raw.forEach((v, k) => { b[k] += v; });
    });

    // Pass 2: pick a chord per window.
    let prev = null;
    const results = [];
    frames.forEach((f) => {
      const { win, total } = f;
      if (total < 0.05) {
        results.push({ win, chord: null });
        prev = null;
        return;
      }
      let raw = f.raw;
      const notable = raw.filter((v) => v / total >= 0.08).length;
      if (notable < 3) {
        const ctx = barRaw[win.bar];
        const ctxTotal = ctx.reduce((x, y) => x + y, 0);
        raw = raw.map((v, k) => v / total + (0.6 * ctx[k]) / ctxTotal);
      }
      const sum = raw.reduce((x, y) => x + y, 0);
      const w = raw.map((v) => v / sum);
      const bassPc = f.bass % 12;

      let best = null;
      templates.forEach((t) => {
        for (let root = 0; root < 12; root++) {
          const sc = scoreTemplate(w, root, t, bassPc);
          if (!best || sc > best.score) best = { score: sc, root, t };
        }
      });
      // Smoothing: keep the previous chord unless the new one is clearly better.
      if (prev) {
        const ps = scoreTemplate(w, prev.root, prev.t, bassPc);
        // A chord that only adds a tone to the previous one (C -> Cmaj7, Em -> Em7)
        // is usually a passing melody note, so it has to win by a wider margin.
        const prevPcs = prev.t.pcs.map((p) => (prev.root + p) % 12);
        const bestPcs = best.t.pcs.map((p) => (best.root + p) % 12);
        const addsTone = prevPcs.every((p) => bestPcs.includes(p));
        if (ps >= best.score - (addsTone ? 0.2 : 0.08)) best = { score: ps, root: prev.root, t: prev.t };
      }
      prev = best;
      results.push({ win, root: best.root, t: best.t, bassPc, bass: f.bass, raw: w, notes: f.notes });
    });

    // Same-root runs where the quality flickers (C, Cmaj7, C6...) because of
    // melody notes are re-scored as one chord over the whole run.
    for (let i = 0; i < results.length;) {
      if (!results[i].t) { i++; continue; }
      let j = i;
      while (j + 1 < results.length && results[j + 1].t && results[j + 1].root === results[i].root &&
        results[j + 1].win.start === results[j].win.end) j++;
      const run = results.slice(i, j + 1);
      const beatLen = (k) => (run[k].win.end - run[k].win.start) / bars[run[k].win.bar].beatLen;
      let flicker = false;
      for (let a = 0, b; a < run.length; a = b) {
        let beats = 0;
        for (b = a; b < run.length && run[b].t === run[a].t; b++) beats += beatLen(b);
        if (run.length > 1 && beats < 2) flicker = true;
      }
      if (flicker) {
        const sum = new Array(12).fill(0);
        run.forEach((r) => r.raw.forEach((v, k) => { sum[k] += v; }));
        const tot = sum.reduce((x, y) => x + y, 0);
        const w = sum.map((v) => v / tot);
        const bassPc = run[0].bassPc;
        let best = null;
        templates.forEach((t) => {
          const sc = scoreTemplate(w, run[0].root, t, bassPc);
          if (!best || sc > best.score) best = { score: sc, t };
        });
        run.forEach((r) => { r.t = best.t; });
      }
      i = j + 1;
    }

    // One bass per chord: the lowest bass note while the chord lasts, so broken
    // chords don't flicker between inversions (Am, Am/C, Am...).
    for (let i = 0; i < results.length;) {
      let j = i;
      if (results[i].t) {
        while (j + 1 < results.length && results[j + 1].t === results[i].t && results[j + 1].root === results[i].root &&
          results[j + 1].win.start === results[j].win.end) j++;
        const low = Math.min(...results.slice(i, j + 1).map((r) => r.bass));
        for (let k = i; k <= j; k++) results[k].bassPc = low % 12;
      }
      i = j + 1;
    }

    results.forEach((r) => {
      if (!r.t) { r.chord = null; return; }
      const bassInChord = r.t.pcs.some((p) => (r.root + p) % 12 === r.bassPc);
      let name = T.buildChord(r.root, r.t, o.slash && bassInChord ? r.bassPc : null).name;
      if (key && key.flats !== null) name = T.respell(name, key.flats);
      r.chord = name;
    });

    // Merge equal neighbours into segments.
    const segments = [];
    results.forEach((r) => {
      const last = segments[segments.length - 1];
      const name = r.chord || 'N.C.';
      if (last && last.name === name && last.end === r.win.start) {
        last.end = r.win.end;
        return;
      }
      segments.push({ name, start: r.win.start, end: r.win.end, bar: r.win.bar, beat: r.win.beat, notes: r.notes || [] });
    });
    // Drop leading / trailing silence.
    while (segments.length && segments[0].name === 'N.C.') segments.shift();
    while (segments.length && segments[segments.length - 1].name === 'N.C.') segments.pop();
    segments.forEach((s) => {
      s.startSec = toSec(s.start);
      s.endSec = toSec(s.end);
    });

    const firstBar = segments.length ? segments[0].bar : 0;
    const lastBar = segments.length ? segments[segments.length - 1].bar : -1;
    let lastEnd = segments.length ? segments[segments.length - 1].end : 0;
    const usedBars = bars.filter((b) => b.index >= firstBar && b.index <= lastBar && b.start < lastEnd);

    return {
      key, bars: usedBars, segments, toSec,
      tempo: 60e6 / song.tempos[0].uspq,
      timeSig: song.timeSigs[0],
      duration: toSec(endTick),
      noteCount: notes.length,
    };
  }

  /** Chords inside one bar (continuations from the previous bar are flagged). */
  function chordsInBar(result, bar) {
    return result.segments
      .filter((s) => s.start < bar.end && s.end > bar.start)
      .map((s) => ({
        seg: s,
        name: s.name,
        cont: s.start < bar.start,
        beats: (Math.min(s.end, bar.end) - Math.max(s.start, bar.start)) / bar.beatLen,
      }));
  }

  /**
   * Plain-text chord sheet in "chords over lyrics" layout, one line per
   * `barsPerLine` bars, with an empty line under each for the lyrics.
   */
  function toSongText(result, opts) {
    const o = Object.assign({ barsPerLine: 4, title: '' }, opts);
    const lines = [];
    if (o.title) lines.push(`{title: ${o.title}}`);
    if (result.key) lines.push(`{comment: Key ${result.key.name} · ${Math.round(result.tempo)} BPM · ${result.timeSig.num}/${result.timeSig.den}}`);
    lines.push('');
    const maxName = result.segments.reduce((m, s) => Math.max(m, s.name.length), 0);
    for (let i = 0; i < result.bars.length; i += o.barsPerLine) {
      const group = result.bars.slice(i, i + o.barsPerLine);
      let line = '';
      group.forEach((bar, k) => {
        const barWidth = Math.max(12, (maxName + 2) * Math.min(bar.num, 2));
        const barCol = k * barWidth;
        chordsInBar(result, bar).forEach((c) => {
          if (c.cont && k > 0) return; // show a held chord only at the start of a line
          const beatPos = c.cont ? 0 : (c.seg.start - bar.start) / bar.beatLen;
          let col = barCol + Math.round((beatPos / bar.num) * barWidth);
          if (line.length && col <= line.length) col = line.length + 1;
          line = line.padEnd(col, ' ') + c.name;
        });
      });
      lines.push(line.replace(/\s+$/, ''));
      lines.push('');
    }
    return lines.join('\n').replace(/\n+$/, '\n');
  }

  PC.Analysis = { analyze, chordsInBar, toSongText, estimateKey };
})(window.PC = window.PC || {});
