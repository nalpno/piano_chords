/*
 * Application wiring: state, UI events, library, song chart.
 */
(function (PC) {
  'use strict';

  const T = PC.Theory;
  const A = PC.Audio;
  const D = PC.Diagram;
  const X = PC.Export;
  const S = PC.Song;
  const t = PC.I18n.t;
  const $ = (id) => document.getElementById(id);

  const STORE = { settings: 'pcs.settings', library: 'pcs.library', song: 'pcs.song' };

  const EXAMPLE_SONG = [
    '{title: Amazing Grace}',
    '{artist: John Newton, 1779 (public domain)}',
    '',
    '[Verse 1]',
    'A[G]mazing [G7]grace, how [C]sweet the [G]sound',
    'That [G]saved a wretch like [D]me',
    'I [G]once was [G7]lost, but [C]now am [G]found',
    'Was [Em]blind, but [D]now I [G]see',
    '',
    '[Verse 2]',
    '      G          G7        C        G',
    '\'Twas grace that taught my heart to fear,',
    '    G              D',
    'And grace my fears relieved;',
    '    G            G7         C',
    'How precious did that grace appear',
    '    Em     D/F#  G',
    'The hour I first believed.',
  ].join('\n');

  // ---------- Persistence ----------
  function load(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) { return fallback; }
  }
  function store(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage unavailable */ }
  }

  const settings = Object.assign({
    lang: (navigator.language || 'en').toLowerCase().startsWith('tr') ? 'tr' : 'en',
    style: 'classic', color: '#d32f2f', accidentals: 'auto', bass: true,
    instrument: 'piano', volume: 0.8, latch: true, octave: 4,
    showChart: true, inline: true, inlineScale: 0.45, transpose: 0, tab: 'keyboard',
    midiRes: 'beat', midiDetail: 'sevenths', midiSlash: true, midiBpl: 4,
  }, load(STORE.settings, {}));
  const saveSettings = () => store(STORE.settings, settings);

  let library = load(STORE.library, []);
  const saveLibrary = () => { store(STORE.library, library); renderLibrary(); };

  // ---------- Toast ----------
  let toastTimer = null;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
  }

  function pretty(name) {
    return String(name || '').replace(/#/g, '♯').replace(/b/g, '♭');
  }

  function diagramOpts(extra) {
    return Object.assign({ style: settings.style, color: settings.color }, extra);
  }

  // ---------- Note state ----------
  const held = new Set(); // keys physically down (MIDI, computer keys, mouse w/o latch)
  const gesture = new Set(); // notes of the current "gesture" (kept after release)
  const latched = new Set(); // mouse-latched notes
  let sustain = false;
  let lastKey = '';
  let current = { notes: [], detection: null, chord: null, labels: [] };

  function activeNotes() {
    return [...new Set([...gesture, ...latched])].sort((a, b) => a - b);
  }

  function pressPhysical(m, vel) {
    if (held.size === 0 && !sustain) gesture.clear();
    held.add(m);
    gesture.add(m);
    A.noteOn(m, vel);
    update();
  }
  function releasePhysical(m) {
    if (!held.has(m)) return;
    held.delete(m);
    A.noteOff(m);
    update();
  }
  function clearNotes() {
    held.clear();
    gesture.clear();
    latched.clear();
    A.allOff();
    update();
  }
  function setNotes(notes) {
    held.clear();
    gesture.clear();
    latched.clear();
    notes.forEach((n) => latched.add(n));
    update();
    if (notes.length) keyboard.scrollTo(Math.round((notes[0] + notes[notes.length - 1]) / 2));
  }

  // ---------- Keyboard ----------
  const keyboard = PC.Keyboard.create($('piano'), {
    onDown(m) {
      A.unlock();
      if (settings.latch) {
        if (latched.has(m) || gesture.has(m)) {
          latched.delete(m);
          gesture.delete(m);
        } else {
          latched.add(m);
          A.playChord([m], { duration: 0.9 });
        }
        update();
      } else {
        pressPhysical(m, 0.8);
      }
    },
    onUp(m) {
      if (!settings.latch) releasePhysical(m);
    },
  });

  // ---------- Chord detection & panel ----------
  function update() {
    const notes = activeNotes();
    const key = notes.join(',');
    if (key !== lastKey) {
      lastKey = key;
      const det = T.detect(notes);
      current = { notes, detection: det, chord: det.best };
      $('nameInput').value = det.best ? det.best.name : '';
      renderDetection();
    }
    renderKeys();
    renderPreview();
  }

  function chordForLabels() {
    const typed = T.parse($('nameInput').value);
    return typed || current.chord;
  }

  function renderKeys() {
    const chord = chordForLabels();
    const labels = T.labelNotes(current.notes, chord);
    current.labels = labels;
    const lit = new Map();
    current.notes.forEach((n, i) => lit.set(n, labels[i]));
    keyboard.render(held, lit);
  }

  function renderDetection() {
    const det = current.detection;
    const big = $('chordBig');
    big.classList.remove('unknown');
    if (!current.notes.length) {
      big.textContent = t('noChord');
      big.classList.add('unknown');
    } else if (det.best) {
      big.textContent = pretty(det.best.name);
    } else if (det.single) {
      big.textContent = pretty(det.single);
    } else {
      big.textContent = t('unknownChord');
      big.classList.add('unknown');
    }
    const labels = T.labelNotes(current.notes, det.best);
    $('noteList').textContent = labels.length ? labels.map(pretty).join('  ') : '—';
    const alts = $('altList');
    alts.innerHTML = '';
    (det.alternatives || []).forEach((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = pretty(c.name);
      b.addEventListener('click', () => {
        $('nameInput').value = c.name;
        big.textContent = pretty(c.name);
        renderKeys();
        renderPreview();
      });
      alts.appendChild(b);
    });
    $('altRow').hidden = !(det.alternatives && det.alternatives.length);
  }

  function currentName() {
    const v = $('nameInput').value.trim();
    if (v) return v;
    const det = current.detection;
    return det && (det.best ? det.best.name : det.single) || '';
  }

  function currentItem() {
    return { name: currentName(), display: currentName(), notes: current.notes, labels: current.labels };
  }

  function renderPreview() {
    const box = $('preview');
    if (!current.notes.length) {
      box.innerHTML = D.svg([], diagramOpts({ name: '', showLabels: false, noteList: false })).svg;
      return;
    }
    box.innerHTML = D.svg(current.notes, diagramOpts({ name: currentName(), labels: current.labels }), 1.5).svg;
  }

  // ---------- Export helpers ----------
  async function run(task) {
    toast(t('exporting'));
    try {
      await task();
      $('toast').classList.remove('show');
    } catch (e) {
      console.error(e);
      toast(t('exportError', { msg: e.message || e }));
    }
  }

  function singlePng(item) {
    const p = D.parts(item.notes, diagramOpts({ name: item.display || item.name, labels: item.labels }));
    return run(() => X.png({ body: p.body, w: p.w, h: p.h }, item.name, 4));
  }
  function singlePdf(item) {
    return run(() => X.pdf(S.gridPages('', [item], diagramOpts({ gridScale: 2.4 })), item.name));
  }

  // ---------- Library ----------
  function libItem(entry) {
    const chord = T.parse(entry.name);
    return { name: entry.name, display: entry.name, notes: entry.notes, labels: T.labelNotes(entry.notes, chord) };
  }

  function saveCurrent() {
    if (!current.notes.length) return;
    const name = currentName() || current.labels.join(' ');
    const key = T.canonical(name);
    const existing = library.find((e) => T.canonical(e.name) === key);
    if (existing) {
      existing.name = name;
      existing.notes = current.notes.slice();
      existing.updated = Date.now();
    } else {
      library.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, notes: current.notes.slice(), created: Date.now() });
    }
    saveLibrary();
    renderSong();
    toast(t('saved', { name: pretty(name) }));
  }

  function renderLibrary() {
    $('libCount').textContent = library.length;
    $('libEmpty').hidden = library.length > 0;
    const grid = $('libGrid');
    grid.innerHTML = '';
    library.forEach((entry) => {
      const item = libItem(entry);
      const card = document.createElement('div');
      card.className = 'lib-card';
      const d = D.svg(item.notes, diagramOpts({ name: item.display, labels: item.labels }));
      card.innerHTML = `<div class="diagram" title="${D.esc(t('play'))}">${d.svg}</div><div class="actions"></div>`;
      card.querySelector('.diagram').addEventListener('click', () => A.playChord(item.notes));
      const actions = card.querySelector('.actions');
      const add = (label, fn, cls) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn' + (cls ? ' ' + cls : '');
        b.textContent = label;
        b.addEventListener('click', fn);
        actions.appendChild(b);
      };
      add(t('play'), () => A.playChord(item.notes));
      add(t('edit'), () => { switchTab('keyboard'); setNotes(item.notes); $('nameInput').value = item.name; renderDetectionName(item.name); });
      add(t('png'), () => singlePng(item));
      add(t('pdf'), () => singlePdf(item));
      add(t('rename'), () => {
        const n = prompt(t('renamePrompt'), entry.name);
        if (n && n.trim()) { entry.name = n.trim(); saveLibrary(); renderSong(); }
      });
      add(t('delete'), () => {
        if (confirm(t('confirmDelete', { name: entry.name }))) {
          library = library.filter((e) => e !== entry);
          saveLibrary();
          renderSong();
        }
      }, 'danger');
      grid.appendChild(card);
    });
  }

  function renderDetectionName(name) {
    $('chordBig').textContent = pretty(name);
    $('chordBig').classList.remove('unknown');
    renderKeys();
    renderPreview();
  }

  // ---------- Song chart ----------
  function resolveChord(name) {
    const chord = T.parse(name);
    if (!chord) return null;
    const key = T.canonical(name);
    const saved = library.find((e) => T.canonical(e.name) === key);
    const notes = saved ? saved.notes.slice() : T.voicing(chord, { bass: settings.bass });
    return { name, display: name, notes, labels: T.labelNotes(notes, chord) };
  }

  function currentSong() {
    const song = S.transpose(S.parse($('songText').value), settings.transpose);
    const title = $('songTitle').value.trim();
    if (title) song.title = title;
    return song;
  }

  function songOpts() {
    return diagramOpts({ showChart: settings.showChart, inline: settings.inline, inlineScale: settings.inlineScale });
  }

  function renderSong() {
    const text = $('songText').value;
    const sheet = $('sheet');
    if (!text.trim()) {
      sheet.innerHTML = `<p class="empty">${D.esc(t('songEmpty'))}</p>`;
      return;
    }
    const song = currentSong();
    sheet.innerHTML = S.renderHTML(song, (n) => {
      const r = resolveChord(n);
      return r && Object.assign({}, r, { display: r.display });
    }, songOpts());
    // Pretty-print chord names on screen (SVG exports keep ASCII # and b).
    sheet.querySelectorAll('.seg-name').forEach((e) => { e.textContent = pretty(e.textContent); });
  }

  let songTimer = null;
  function onSongInput() {
    clearTimeout(songTimer);
    songTimer = setTimeout(() => {
      store(STORE.song, { title: $('songTitle').value, text: $('songText').value });
      renderSong();
    }, 200);
  }

  function songFileName() {
    const s = currentSong();
    return s.title || 'song-chart';
  }

  // ---------- Tabs ----------
  function switchTab(name) {
    if (name !== 'midi' && PC.MidiChords) PC.MidiChords.stop();
    settings.tab = name;
    saveSettings();
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    document.querySelectorAll('.tab-panel').forEach((p) => { p.hidden = p.id !== 'tab-' + name; });
    if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
  }

  // ---------- MIDI ----------
  let midiState = { status: 'waiting', names: [] };
  function renderMidiStatus() {
    const el = $('midiStatus');
    const txt = el.querySelector('.txt');
    el.classList.remove('ok', 'warn');
    const s = midiState.status;
    if (s === 'connected') {
      el.classList.add('ok');
      txt.textContent = t('midiConnected') + ': ' + midiState.names.join(', ');
    } else if (s === 'waiting') {
      txt.textContent = t('midiWaiting');
    } else {
      el.classList.add('warn');
      txt.textContent = t(s === 'unsupported' ? 'midiUnsupported' : s === 'denied' ? 'midiDenied' : 'midiNone');
    }
    el.title = txt.textContent;
  }
  let flashTimer = null;
  function flashMidi() {
    const el = $('midiStatus');
    el.classList.add('flash');
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => el.classList.remove('flash'), 80);
  }

  PC.Midi.init({
    onNoteOn(n, v) { flashMidi(); pressPhysical(n, v); },
    onNoteOff(n) { releasePhysical(n); },
    onSustain(on) {
      sustain = on;
      A.setSustain(on);
    },
    onAllOff() { held.clear(); A.allOff(); update(); },
    onStatus(status, names) { midiState = { status, names }; renderMidiStatus(); },
  });

  // ---------- Computer keyboard ----------
  const KEYMAP = {
    KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6, KeyG: 7,
    KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12, KeyO: 13, KeyL: 14, KeyP: 15, Semicolon: 16,
  };
  const pcKeysDown = new Map();
  function typingTarget(e) {
    const tag = (e.target.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
  }
  window.addEventListener('keydown', (e) => {
    if (typingTarget(e) || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (settings.tab !== 'keyboard') return;
    if (e.code === 'KeyZ' || e.code === 'KeyX') {
      settings.octave = Math.max(1, Math.min(7, settings.octave + (e.code === 'KeyZ' ? -1 : 1)));
      $('octaveLabel').textContent = settings.octave;
      saveSettings();
      keyboard.scrollTo((settings.octave + 1) * 12 + 6);
      return;
    }
    if (!(e.code in KEYMAP)) return;
    const m = (settings.octave + 1) * 12 + KEYMAP[e.code];
    if (m < T.MIDI_MIN || m > T.MIDI_MAX) return;
    e.preventDefault();
    pcKeysDown.set(e.code, m);
    pressPhysical(m, 0.75);
  });
  window.addEventListener('keyup', (e) => {
    if (!pcKeysDown.has(e.code)) return;
    releasePhysical(pcKeysDown.get(e.code));
    pcKeysDown.delete(e.code);
  });
  window.addEventListener('blur', () => {
    pcKeysDown.forEach((m) => releasePhysical(m));
    pcKeysDown.clear();
  });

  // ---------- UI wiring ----------
  function applyLang(lang) {
    settings.lang = lang;
    saveSettings();
    PC.I18n.setLang(lang);
    document.querySelectorAll('.lang-switch button').forEach((b) => b.classList.toggle('active', b.dataset.lang === lang));
    renderMidiStatus();
    lastKey = null;
    update();
    renderLibrary();
    renderSong();
    PC.MidiChords.refresh();
  }

  /** Replace the song chart text (used by the MIDI → Chords tab). */
  function sendToSong(text, title) {
    $('songTitle').value = title || '';
    $('songText').value = text;
    settings.transpose = 0;
    $('trVal').textContent = '0';
    saveSettings();
    store(STORE.song, { title: $('songTitle').value, text });
    switchTab('song');
    renderSong();
    toast(t('midiSent'));
    $('songText').focus();
  }

  function init() {
    // Restore settings into controls
    $('latch').checked = settings.latch;
    $('instrument').value = settings.instrument;
    $('volume').value = settings.volume;
    $('styleSel').value = settings.style;
    $('colorSel').value = settings.color;
    $('accSel').value = settings.accidentals;
    $('bassSel').checked = settings.bass;
    $('optChart').checked = settings.showChart;
    $('optInline').checked = settings.inline;
    $('optSize').value = settings.inlineScale;
    $('trVal').textContent = settings.transpose > 0 ? '+' + settings.transpose : settings.transpose;
    $('octaveLabel').textContent = settings.octave;
    A.setInstrument(settings.instrument);
    A.setVolume(settings.volume);
    T.setAccidentalPref(settings.accidentals);
    document.documentElement.style.setProperty('--accent', settings.color);

    const savedSong = load(STORE.song, null);
    if (savedSong) {
      $('songTitle').value = savedSong.title || '';
      $('songText').value = savedSong.text || '';
    }

    document.querySelectorAll('.tab-btn').forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
    document.querySelectorAll('.lang-switch button').forEach((b) => b.addEventListener('click', () => applyLang(b.dataset.lang)));

    $('latch').addEventListener('change', (e) => { settings.latch = e.target.checked; saveSettings(); });
    $('clearBtn').addEventListener('click', clearNotes);
    $('instrument').addEventListener('change', (e) => { settings.instrument = e.target.value; A.setInstrument(settings.instrument); saveSettings(); });
    $('volume').addEventListener('input', (e) => { settings.volume = parseFloat(e.target.value); A.setVolume(settings.volume); saveSettings(); });

    $('nameInput').addEventListener('input', () => {
      const v = $('nameInput').value.trim();
      $('chordBig').textContent = v ? pretty(v) : (current.notes.length ? t('unknownChord') : t('noChord'));
      renderKeys();
      renderPreview();
    });
    $('saveBtn').addEventListener('click', saveCurrent);
    $('playBtn').addEventListener('click', () => A.playChord(current.notes));
    $('arpBtn').addEventListener('click', () => A.playChord(current.notes, { arpeggio: true }));
    $('pngBtn').addEventListener('click', () => current.notes.length && singlePng(currentItem()));
    $('pdfBtn').addEventListener('click', () => current.notes.length && singlePdf(currentItem()));

    $('lookupForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const name = $('lookupInput').value.trim();
      const r = resolveChord(name);
      if (!r) { toast(t('invalidChord', { name })); return; }
      setNotes(r.notes);
      $('nameInput').value = name;
      renderDetectionName(name);
      A.playChord(r.notes);
    });

    const refreshAll = () => { saveSettings(); renderKeys(); renderPreview(); renderLibrary(); renderSong(); };
    $('styleSel').addEventListener('change', (e) => { settings.style = e.target.value; refreshAll(); });
    $('colorSel').addEventListener('input', (e) => {
      settings.color = e.target.value;
      document.documentElement.style.setProperty('--accent', settings.color);
      refreshAll();
    });
    $('accSel').addEventListener('change', (e) => {
      settings.accidentals = e.target.value;
      T.setAccidentalPref(settings.accidentals);
      lastKey = null;
      update();
      refreshAll();
    });
    $('bassSel').addEventListener('change', (e) => { settings.bass = e.target.checked; refreshAll(); });

    // Library
    $('libPdf').addEventListener('click', () => library.length &&
      run(() => X.pdf(S.gridPages(t('libraryTitle'), library.map(libItem), diagramOpts()), 'chord-library')));
    $('libPng').addEventListener('click', () => library.length &&
      run(() => X.png(S.gridPages(t('libraryTitle'), library.map(libItem), diagramOpts(), true)[0], 'chord-library', 2)));
    $('libJson').addEventListener('click', () => {
      X.download(new Blob([JSON.stringify({ app: 'piano-chord-studio', version: 1, chords: library }, null, 2)], { type: 'application/json' }), 'chord-library.json');
    });
    $('libImport').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      file.text().then((txt) => {
        const data = JSON.parse(txt);
        const list = Array.isArray(data) ? data : data.chords;
        if (!Array.isArray(list)) throw new Error('bad format');
        let n = 0;
        list.forEach((c) => {
          if (!c || typeof c.name !== 'string' || !Array.isArray(c.notes)) return;
          const notes = c.notes.map(Number).filter((x) => x >= T.MIDI_MIN && x <= T.MIDI_MAX);
          if (!notes.length) return;
          const key = T.canonical(c.name);
          const ex = library.find((l) => T.canonical(l.name) === key);
          if (ex) ex.notes = notes;
          else library.push({ id: c.id || Date.now().toString(36) + n, name: c.name, notes, created: c.created || Date.now() });
          n++;
        });
        saveLibrary();
        renderSong();
        toast(t('imported', { n }));
      }).catch(() => toast(t('importError'))).finally(() => { e.target.value = ''; });
    });
    $('libClear').addEventListener('click', () => {
      if (library.length && confirm(t('confirmClear'))) { library = []; saveLibrary(); renderSong(); }
    });

    // Song
    $('songText').addEventListener('input', onSongInput);
    $('songTitle').addEventListener('input', onSongInput);
    $('optChart').addEventListener('change', (e) => { settings.showChart = e.target.checked; saveSettings(); renderSong(); });
    $('optInline').addEventListener('change', (e) => { settings.inline = e.target.checked; saveSettings(); renderSong(); });
    $('optSize').addEventListener('input', (e) => { settings.inlineScale = parseFloat(e.target.value); saveSettings(); renderSong(); });
    const setTranspose = (v) => {
      settings.transpose = ((v + 17) % 12 + 12) % 12 - 5; // keep within -5..+6
      $('trVal').textContent = settings.transpose > 0 ? '+' + settings.transpose : settings.transpose;
      saveSettings();
      renderSong();
    };
    $('trDown').addEventListener('click', () => setTranspose(settings.transpose - 1));
    $('trUp').addEventListener('click', () => setTranspose(settings.transpose + 1));
    $('exampleBtn').addEventListener('click', () => {
      $('songTitle').value = '';
      $('songText').value = EXAMPLE_SONG;
      onSongInput();
    });
    $('sheet').addEventListener('click', (e) => {
      const el = e.target.closest('[data-chord]');
      if (!el) return;
      const r = resolveChord(el.dataset.chord);
      if (r) A.playChord(r.notes);
    });
    $('songPng').addEventListener('click', () => $('songText').value.trim() &&
      run(() => X.png(S.sheetPages(currentSong(), resolveChord, songOpts(), true)[0], songFileName(), 2)));
    $('songPdf').addEventListener('click', () => $('songText').value.trim() &&
      run(() => X.pdf(S.sheetPages(currentSong(), resolveChord, songOpts(), false), songFileName())));

    PC.MidiChords.init({ toast, pretty, resolveChord, saveSettings, sendToSong }, settings);

    const initialTab = (location.hash || '').slice(1);
    switchTab(['keyboard', 'library', 'midi', 'song'].includes(initialTab) ? initialTab : settings.tab || 'keyboard');
    applyLang(settings.lang);
    keyboard.scrollTo(60);
  }

  init();
})(window.PC = window.PC || {});
