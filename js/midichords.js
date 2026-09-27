/*
 * "MIDI → Chords" tab: load a MIDI file, show its chord progression bar by
 * bar, play it back and send it to the song chart.
 */
(function (PC) {
  'use strict';

  const T = PC.Theory;
  const A = PC.Audio;
  const $ = (id) => document.getElementById(id);

  let api = null; // helpers provided by app.js
  let settings = null;
  let song = null; // parsed MIDI
  let fileName = '';
  let result = null; // analysis result
  let selected = new Set();
  let keyboard = null;
  let selectedSeg = null;

  // Playback state
  let playing = false;
  let playNotes = [];
  let playIdx = 0;
  let t0 = 0; // AudioContext time of song position 0
  let timer = null;
  let raf = null;

  function t(key, vars) { return PC.I18n.t(key, vars); }

  function fmtTime(sec) {
    const s = Math.max(0, Math.floor(sec));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  const GM_DRUMS = 9;

  // ---------- Example song ----------
  function exampleBytes() {
    const ppq = 480;
    const bar = ppq * 4;
    // C  G/B  Am  F  |  C  Em  Dm7  G7   (bass, chord, melody)
    const prog = [
      [48, [60, 64, 67]], [47, [59, 62, 67]], [45, [60, 64, 69]], [41, [60, 65, 69]],
      [48, [60, 64, 67]], [40, [59, 64, 67]], [38, [60, 62, 65, 69]], [43, [59, 62, 65, 67]],
    ];
    const melody = [72, 74, 76, 74, 71, 74, 79, 77, 72, 76, 69, 72, 77, 76, 74, 72,
      79, 77, 76, 74, 71, 72, 74, 76, 74, 72, 74, 77, 79, 77, 74, 71];
    const piano = { name: 'Piano', channel: 0, program: 0, notes: [] };
    const bass = { name: 'Bass', channel: 1, program: 32, notes: [] };
    const mel = { name: 'Melody', channel: 2, program: 73, notes: [] };
    const drums = { name: 'Drums', channel: 9, notes: [] };
    for (let rep = 0; rep < 2; rep++) {
      prog.forEach(([b, chord], i) => {
        const at = (rep * prog.length + i) * bar;
        bass.notes.push({ midi: b, start: at, dur: bar / 2 - 20, vel: 100 });
        bass.notes.push({ midi: b, start: at + bar / 2, dur: bar / 2 - 20, vel: 90 });
        chord.forEach((m) => {
          piano.notes.push({ midi: m, start: at, dur: bar / 2 - 10, vel: 72 });
          piano.notes.push({ midi: m, start: at + bar / 2, dur: bar / 2 - 10, vel: 64 });
        });
        for (let k = 0; k < 4; k++) {
          mel.notes.push({ midi: melody[i * 4 + k], start: at + k * ppq, dur: ppq - 40, vel: 92 });
          drums.notes.push({ midi: k % 2 ? 38 : 36, start: at + k * ppq, dur: 60, vel: 90 });
        }
      });
    }
    return PC.MidiFile.write([piano, bass, mel, drums], { ppq, bpm: 96 });
  }

  // ---------- Loading ----------
  function loadBytes(bytes, name) {
    stop();
    try {
      song = PC.MidiFile.parse(bytes);
    } catch (e) {
      api.toast(t('midiParseError', { msg: e.message }));
      return;
    }
    fileName = name.replace(/\.(mid|midi|kar|rmi)$/i, '');
    selected = new Set(song.tracks.filter((tr) => tr.notes.length && !isDrumTrack(tr)).map((tr) => tr.index));
    selectedSeg = null;
    $('midiWork').hidden = false;
    $('midiFileName').textContent = name;
    renderTracks();
    analyze();
    if (!song.tracks.some((tr) => tr.notes.length)) api.toast(t('midiNoNotes'));
  }

  function isDrumTrack(tr) {
    return tr.channels.length > 0 && tr.channels.every((c) => c === GM_DRUMS);
  }

  function loadFile(file) {
    if (!file) return;
    file.arrayBuffer().then((buf) => loadBytes(new Uint8Array(buf), file.name))
      .catch(() => api.toast(t('importError')));
  }

  // ---------- Analysis & rendering ----------
  function analyze() {
    if (!song) return;
    result = PC.Analysis.analyze(song, {
      tracks: selected, resolution: settings.midiRes, detail: settings.midiDetail, slash: settings.midiSlash,
    });
    renderStats();
    renderGrid();
    prepPlayback();
  }

  function renderStats() {
    const sig = result.timeSig;
    const parts = [
      [t('midiDuration'), fmtTime(result.duration)],
      [t('midiTempo'), Math.round(result.tempo) + ' BPM'],
      [t('midiMeter'), sig.num + '/' + sig.den],
      [t('midiKey'), result.key ? api.pretty(result.key.name) : '—'],
      [t('midiBars'), String(result.bars.length)],
      [t('midiNotes'), String(result.noteCount)],
    ];
    $('midiStats').innerHTML = parts.map(([k, v]) =>
      `<span class="stat"><span class="muted">${PC.Diagram.esc(k)}</span> <b>${PC.Diagram.esc(v)}</b></span>`).join('');
    $('midiTime').textContent = '0:00 / ' + fmtTime(result.duration);
  }

  function renderTracks() {
    const box = $('midiTracks');
    box.innerHTML = '';
    song.tracks.forEach((tr) => {
      if (!tr.notes.length) return;
      const drum = isDrumTrack(tr);
      const label = document.createElement('label');
      label.className = 'check track' + (drum ? ' drum' : '');
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = selected.has(tr.index);
      cb.disabled = drum;
      cb.addEventListener('change', () => {
        if (cb.checked) selected.add(tr.index);
        else selected.delete(tr.index);
        analyze();
      });
      const name = tr.name || t('midiTrackN', { n: tr.index + 1 });
      const chans = tr.channels.map((c) => c + 1).join(', ');
      const info = document.createElement('span');
      info.innerHTML = `<b>${PC.Diagram.esc(name)}</b> <span class="muted">· ${t('midiChannel')} ${chans} · ${tr.notes.length} ${t('midiNoteWord')}${drum ? ' · ' + t('midiDrums') : ''}</span>`;
      label.append(cb, info);
      box.appendChild(label);
    });
  }

  function renderGrid() {
    const grid = $('midiGrid');
    grid.innerHTML = '';
    grid.style.setProperty('--bpl', settings.midiBpl);
    // Used chords
    const used = [];
    const seen = new Set();
    result.segments.forEach((s) => {
      if (s.name === 'N.C.' || seen.has(s.name)) return;
      seen.add(s.name);
      used.push(s.name);
    });
    const usedBox = $('midiUsed');
    usedBox.innerHTML = '';
    used.forEach((name) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = api.pretty(name);
      b.addEventListener('click', () => showChord(name));
      usedBox.appendChild(b);
    });

    if (!result.segments.length) {
      grid.innerHTML = `<p class="empty">${PC.Diagram.esc(t('midiNoNotes'))}</p>`;
      return;
    }
    const firstBar = result.bars[0].index;
    result.bars.forEach((bar) => {
      const cell = document.createElement('div');
      cell.className = 'bar';
      cell.innerHTML = `<span class="bar-no">${bar.index - firstBar + 1}</span>`;
      const row = document.createElement('div');
      row.className = 'bar-chords';
      PC.Analysis.chordsInBar(result, bar).forEach((c) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'bar-chord' + (c.cont ? ' cont' : '') + (c.name === 'N.C.' ? ' nc' : '');
        b.style.flexGrow = c.beats;
        b.textContent = c.cont ? '–' : api.pretty(c.name);
        b.title = api.pretty(c.name) + ' · ' + fmtTime(c.seg.startSec);
        b.seg = c.seg;
        b.addEventListener('click', () => onChordClick(c.seg));
        row.appendChild(b);
      });
      cell.appendChild(row);
      grid.appendChild(cell);
    });
  }

  function highlight(seg) {
    $('midiGrid').querySelectorAll('.bar-chord').forEach((b) => b.classList.toggle('now', b.seg === seg));
  }

  function showChord(name) {
    const r = api.resolveChord(name);
    if (!r) return;
    A.playChord(r.notes);
    const lit = new Map();
    r.notes.forEach((n, i) => lit.set(n, r.labels[i]));
    keyboard.render(new Set(), lit);
  }

  function onChordClick(seg) {
    selectedSeg = seg;
    if (playing) {
      startAt(seg.startSec);
      return;
    }
    highlight(seg);
    if (seg.name !== 'N.C.') showChord(seg.name);
  }

  // ---------- Playback ----------
  function prepPlayback() {
    const toSec = result.toSec;
    playNotes = [];
    song.tracks.forEach((tr) => {
      if (!selected.has(tr.index)) return;
      tr.notes.forEach((n) => {
        if (n.channel === GM_DRUMS) return;
        playNotes.push({ midi: n.midi, s: toSec(n.start), e: toSec(n.end), v: n.velocity / 127 });
      });
    });
    playNotes.sort((a, b) => a.s - b.s);
  }

  function startAt(pos) {
    stop(true);
    A.unlock();
    playing = true;
    $('midiPlay').textContent = t('midiStop');
    t0 = A.now() + 0.08 - pos;
    playIdx = playNotes.findIndex((n) => n.s >= pos);
    if (playIdx < 0) playIdx = playNotes.length;
    timer = setInterval(pump, 25);
    pump();
    raf = requestAnimationFrame(frame);
  }

  function pump() {
    const pos = A.now() - t0;
    while (playIdx < playNotes.length && playNotes[playIdx].s < pos + 0.2) {
      const n = playNotes[playIdx++];
      A.scheduleNote(n.midi, n.v * 0.9, t0 + n.s, t0 + n.e);
    }
    if (pos > result.duration + 0.5) stop();
  }

  function frame() {
    if (!playing) return;
    const pos = A.now() - t0;
    $('midiTime').textContent = fmtTime(pos) + ' / ' + fmtTime(result.duration);
    const seg = result.segments.find((s) => pos >= s.startSec && pos < s.endSec) || null;
    highlight(seg);
    if (seg && seg !== frame.lastSeg) {
      frame.lastSeg = seg;
      const cell = $('midiGrid').querySelector('.bar-chord.now');
      if (cell) cell.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    // Show the notes sounding right now.
    const held = new Set();
    for (let i = Math.max(0, playIdx - 200); i < playIdx; i++) {
      const n = playNotes[i];
      if (n.s <= pos && n.e > pos) held.add(n.midi);
    }
    const lit = new Map();
    if (seg && seg.name !== 'N.C.') {
      const chord = T.parse(seg.name);
      if (chord) {
        const pcs = new Set(chord.template.pcs.map((p) => (chord.rootPc + p) % 12));
        if (chord.bassPc !== null) pcs.add(chord.bassPc);
        held.forEach((m) => { if (pcs.has(m % 12)) lit.set(m, ''); });
      }
    }
    keyboard.render(held, lit);
    raf = requestAnimationFrame(frame);
  }

  function stop(keepButton) {
    if (!playing) return;
    playing = false;
    clearInterval(timer);
    cancelAnimationFrame(raf);
    A.stopScheduled();
    if (!keepButton) {
      $('midiPlay').textContent = t('midiPlay');
      keyboard.render(new Set(), new Map());
    }
  }

  // ---------- Export ----------
  function songText(withTitle) {
    return PC.Analysis.toSongText(result, { barsPerLine: Number(settings.midiBpl), title: withTitle ? fileName : '' });
  }

  function copyText() {
    const text = songText(true);
    const done = () => api.toast(t('midiCopied'));
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text, done));
    } else fallbackCopy(text, done);
  }

  function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) { /* ignore */ }
    ta.remove();
  }

  // ---------- Init ----------
  function init(helpers, appSettings) {
    api = helpers;
    settings = appSettings;
    keyboard = PC.Keyboard.create($('midiPiano'), {
      onDown(m) { A.unlock(); A.noteOn(m, 0.8); },
      onUp(m) { A.noteOff(m); },
    });

    $('midiFile').addEventListener('change', (e) => { loadFile(e.target.files[0]); e.target.value = ''; });
    const zone = $('dropZone');
    ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('over'); }));
    zone.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));
    $('midiExample').addEventListener('click', () => loadBytes(exampleBytes(), 'Example progression.mid'));

    $('midiRes').value = settings.midiRes;
    $('midiDetail').value = settings.midiDetail;
    $('midiSlash').checked = settings.midiSlash;
    $('midiBpl').value = String(settings.midiBpl);
    const change = (key, value) => { settings[key] = value; api.saveSettings(); analyze(); };
    $('midiRes').addEventListener('change', (e) => change('midiRes', e.target.value));
    $('midiDetail').addEventListener('change', (e) => change('midiDetail', e.target.value));
    $('midiSlash').addEventListener('change', (e) => change('midiSlash', e.target.checked));
    $('midiBpl').addEventListener('change', (e) => { settings.midiBpl = Number(e.target.value); api.saveSettings(); if (result) renderGrid(); });

    $('midiPlay').addEventListener('click', () => {
      if (!result) return;
      if (playing) stop();
      else startAt(selectedSeg ? selectedSeg.startSec : 0);
    });
    $('midiCopy').addEventListener('click', () => result && copyText());
    $('midiToSong').addEventListener('click', () => {
      if (!result || !result.segments.length) return;
      stop();
      api.sendToSong(songText(false), fileName);
    });
  }

  /** Re-render text after a language or spelling change. */
  function refresh() {
    if (!result) return;
    if (!playing) $('midiPlay').textContent = t('midiPlay');
    renderTracks();
    analyze();
  }

  PC.MidiChords = { init, refresh, stop, example: () => loadBytes(exampleBytes(), 'Example progression.mid') };
})(window.PC = window.PC || {});
