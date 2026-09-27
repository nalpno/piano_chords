/*
 * Music theory helpers: note naming, chord templates, chord detection,
 * chord-name parsing and default voicings.
 */
(function (PC) {
  'use strict';

  const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
  const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
  const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
  // Most common spelling for each root when no preference is set.
  const AUTO_MAJOR = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const AUTO_MINOR = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'];

  const MIDI_MIN = 21; // A0
  const MIDI_MAX = 108; // C8

  let accidentalPref = 'auto'; // 'auto' | 'sharps' | 'flats'

  // Interval names -> semitones. Degree = the number (1..13).
  const DEGREE_BASE = { 1: 0, 2: 2, 3: 4, 4: 5, 5: 7, 6: 9, 7: 11, 9: 14, 11: 17, 13: 21 };

  function parseInterval(iv) {
    const m = /^(bb|b|#)?(\d+)$/.exec(iv);
    const acc = m[1] === 'bb' ? -2 : m[1] === 'b' ? -1 : m[1] === '#' ? 1 : 0;
    const degree = parseInt(m[2], 10);
    return { name: iv, degree, semis: DEGREE_BASE[degree] + acc, step: (degree - 1) % 7 };
  }

  // Order matters: earlier templates win ties (simpler names first).
  const TEMPLATE_DEFS = [
    ['', '1 3 5'],
    ['m', '1 b3 5'],
    ['5', '1 5'],
    ['sus4', '1 4 5'],
    ['sus2', '1 2 5'],
    ['dim', '1 b3 b5'],
    ['aug', '1 3 #5'],
    ['7', '1 3 5 b7'],
    ['maj7', '1 3 5 7'],
    ['m7', '1 b3 5 b7'],
    ['6', '1 3 5 6'],
    ['m6', '1 b3 5 6'],
    ['dim7', '1 b3 b5 bb7'],
    ['m7b5', '1 b3 b5 b7'],
    ['mMaj7', '1 b3 5 7'],
    ['7sus4', '1 4 5 b7'],
    ['add9', '1 3 5 9'],
    ['madd9', '1 b3 5 9'],
    ['aug7', '1 3 #5 b7'],
    ['7b5', '1 3 b5 b7'],
    ['maj7#5', '1 3 #5 7'],
    ['add11', '1 3 5 11'],
    ['6/9', '1 3 5 6 9'],
    ['m6/9', '1 b3 5 6 9'],
    ['9', '1 3 5 b7 9'],
    ['maj9', '1 3 5 7 9'],
    ['m9', '1 b3 5 b7 9'],
    ['7b9', '1 3 5 b7 b9'],
    ['7#9', '1 3 5 b7 #9'],
    ['9sus4', '1 4 5 b7 9'],
    ['7#11', '1 3 5 b7 #11'],
    ['maj7#11', '1 3 5 7 #11'],
    ['11', '1 3 5 b7 9 11'],
    ['m11', '1 b3 5 b7 9 11'],
    ['13', '1 3 5 b7 9 13'],
    ['maj13', '1 3 5 7 9 13'],
    ['m13', '1 b3 5 b7 9 13'],
  ];

  const TEMPLATES = TEMPLATE_DEFS.map(([suffix, ivs], index) => {
    const intervals = ivs.split(' ').map(parseInterval);
    const pcs = intervals.map((i) => i.semis % 12);
    return { suffix, index, intervals, pcs, pcKey: [...pcs].sort((a, b) => a - b).join(',') };
  });
  const TEMPLATE_BY_SUFFIX = {};
  TEMPLATES.forEach((t) => { TEMPLATE_BY_SUFFIX[t.suffix] = t; });

  // Alternative spellings of chord suffixes -> canonical suffix.
  const SUFFIX_ALIASES = {
    '': '', M: '', maj: '', Maj: '', major: '',
    m: 'm', min: 'm', mi: 'm', '-': 'm', minor: 'm',
    '5': '5', 'no3': '5',
    sus: 'sus4', sus4: 'sus4', sus2: 'sus2', '2': 'sus2',
    dim: 'dim', '°': 'dim', o: 'dim',
    aug: 'aug', '+': 'aug', '#5': 'aug', '(#5)': 'aug',
    '7': '7', dom7: '7',
    maj7: 'maj7', M7: 'maj7', Maj7: 'maj7', ma7: 'maj7', 'Δ': 'maj7', 'Δ7': 'maj7', j7: 'maj7',
    m7: 'm7', min7: 'm7', mi7: 'm7', '-7': 'm7',
    '6': '6', maj6: '6', M6: '6', add6: '6',
    m6: 'm6', min6: 'm6', '-6': 'm6',
    dim7: 'dim7', '°7': 'dim7', o7: 'dim7',
    m7b5: 'm7b5', 'm7(b5)': 'm7b5', 'ø': 'm7b5', 'ø7': 'm7b5', min7b5: 'm7b5', '-7b5': 'm7b5',
    mMaj7: 'mMaj7', mmaj7: 'mMaj7', mM7: 'mMaj7', 'm(maj7)': 'mMaj7', minmaj7: 'mMaj7', '-maj7': 'mMaj7', 'm/maj7': 'mMaj7',
    '7sus4': '7sus4', '7sus': '7sus4', sus7: '7sus4',
    add9: 'add9', add2: 'add9', '(add9)': 'add9',
    madd9: 'madd9', madd2: 'madd9', 'm(add9)': 'madd9',
    aug7: 'aug7', '7#5': 'aug7', '+7': 'aug7', '7+': 'aug7', '7(#5)': 'aug7',
    '7b5': '7b5', '7(b5)': '7b5',
    'maj7#5': 'maj7#5', '+maj7': 'maj7#5', 'maj7+': 'maj7#5',
    add11: 'add11', add4: 'add11',
    '69': '6/9', '6add9': '6/9', '6/9': '6/9',
    m69: 'm6/9', 'm6/9': 'm6/9', m6add9: 'm6/9',
    '9': '9', maj9: 'maj9', M9: 'maj9', m9: 'm9', min9: 'm9', '-9': 'm9',
    '7b9': '7b9', '7(b9)': '7b9', '7#9': '7#9', '7(#9)': '7#9',
    '9sus4': '9sus4', '9sus': '9sus4',
    '7#11': '7#11', '7(#11)': '7#11', 'maj7#11': 'maj7#11', 'M7#11': 'maj7#11',
    '11': '11', m11: 'm11', min11: 'm11', '-11': 'm11',
    '13': '13', maj13: 'maj13', M13: 'maj13', m13: 'm13', min13: 'm13', '-13': 'm13',
  };

  function mod12(n) { return ((n % 12) + 12) % 12; }

  function setAccidentalPref(p) { accidentalPref = p; }
  function getAccidentalPref() { return accidentalPref; }

  function isMinorSuffix(suffix) {
    return /^m(?!aj)/.test(suffix) || suffix.startsWith('dim');
  }

  /** Name for a root pitch class, respecting the user's preference. */
  function rootName(pc, suffix) {
    if (accidentalPref === 'sharps') return SHARP_NAMES[pc];
    if (accidentalPref === 'flats') return FLAT_NAMES[pc];
    return (isMinorSuffix(suffix || '') ? AUTO_MINOR : AUTO_MAJOR)[pc];
  }

  function accidentalString(acc) {
    return acc > 0 ? '#'.repeat(acc) : 'b'.repeat(-acc);
  }

  function parseNoteName(name) {
    const m = /^([A-G])(##|bb|#|b|♯|♭)?$/.exec(name);
    if (!m) return null;
    const letterIdx = LETTERS.indexOf(m[1]);
    const accStr = (m[2] || '').replace('♯', '#').replace('♭', 'b');
    const acc = accStr === '##' ? 2 : accStr === '#' ? 1 : accStr === 'bb' ? -2 : accStr === 'b' ? -1 : 0;
    return { letterIdx, acc, pc: mod12(LETTER_PC[letterIdx] + acc), name: m[1] + accStr };
  }

  /** Spell an interval above a named root, e.g. (Eb, b7) -> Db. */
  function spellInterval(root, interval) {
    const letterIdx = (root.letterIdx + interval.step) % 7;
    const targetPc = mod12(root.pc + interval.semis);
    let acc = mod12(targetPc - LETTER_PC[letterIdx]);
    if (acc > 6) acc -= 12;
    return { name: LETTERS[letterIdx] + accidentalString(acc), acc, pc: targetPc };
  }

  /** Plain note name with octave (C4 = MIDI 60). */
  function midiName(midi, preferFlats) {
    const pc = mod12(midi);
    const names = preferFlats === undefined
      ? (accidentalPref === 'flats' ? FLAT_NAMES : accidentalPref === 'sharps' ? SHARP_NAMES : AUTO_MAJOR)
      : (preferFlats ? FLAT_NAMES : SHARP_NAMES);
    return names[pc] + (Math.floor(midi / 12) - 1);
  }

  function octaveFor(midi, acc) {
    return Math.floor((midi - acc) / 12) - 1;
  }

  /**
   * Label each MIDI note of a chord with a correctly spelled name + octave.
   * chord: parsed/detected chord object (may be null).
   */
  function labelNotes(notes, chord) {
    const sorted = [...notes].sort((a, b) => a - b);
    if (!chord || !chord.template) return sorted.map((n) => midiName(n));
    const root = parseNoteName(chord.rootName);
    const spelled = {};
    chord.template.intervals.forEach((iv) => {
      const s = spellInterval(root, iv);
      spelled[s.pc] = s;
    });
    if (chord.bassName) {
      const b = parseNoteName(chord.bassName);
      if (b && !spelled[b.pc]) spelled[b.pc] = { name: b.name, acc: b.acc, pc: b.pc };
    }
    return sorted.map((n) => {
      const s = spelled[mod12(n)];
      if (!s) return midiName(n);
      return s.name + octaveFor(n, s.acc);
    });
  }

  function chordName(chord) {
    if (!chord) return '';
    return chord.rootName + chord.suffix + (chord.bassName ? '/' + chord.bassName : '');
  }

  function buildChord(rootPc, template, bassPc, rootNm) {
    const rn = rootNm || rootName(rootPc, template.suffix);
    let bassName = null;
    if (bassPc !== null && bassPc !== undefined && bassPc !== rootPc) {
      const root = parseNoteName(rn);
      const iv = template.intervals.find((i) => i.semis % 12 === mod12(bassPc - rootPc));
      const spelled = iv ? spellInterval(root, iv) : null;
      // Keep the theoretically correct spelling unless it needs a double accidental.
      bassName = spelled && Math.abs(spelled.acc) < 2 ? spelled.name : rootName(bassPc, '');
    }
    const chord = {
      rootPc, rootName: rn, suffix: template.suffix, template,
      bassPc: bassName ? bassPc : null, bassName,
    };
    chord.name = chordName(chord);
    return chord;
  }

  /**
   * Detect chords from a set of MIDI notes.
   * Returns { best, alternatives[], pcs } where best may be null.
   */
  function detect(notes) {
    const uniq = [...new Set(notes)].sort((a, b) => a - b);
    if (!uniq.length) return { best: null, alternatives: [], pcs: [] };
    const pcs = [...new Set(uniq.map(mod12))].sort((a, b) => a - b);
    const bassPc = mod12(uniq[0]);

    if (pcs.length === 1) {
      return { best: null, single: rootName(pcs[0], ''), alternatives: [], pcs };
    }

    const candidates = [];
    pcs.forEach((root) => {
      const rel = pcs.map((p) => mod12(p - root)).sort((a, b) => a - b);
      const key = rel.join(',');
      TEMPLATES.forEach((t) => {
        let score = null;
        if (t.pcKey === key) {
          score = 100;
        } else if (t.pcs.length >= 4 && t.pcs.includes(7) && !rel.includes(7)) {
          // Same chord with the (perfect) fifth omitted.
          const without5 = t.pcs.filter((p) => p !== 7).sort((a, b) => a - b).join(',');
          if (without5 === key) score = 70;
        }
        if (score === null) return;
        score -= t.index * 0.1;
        if (root === bassPc) score += 20;
        candidates.push({ score, chord: buildChord(root, t, bassPc) });
      });
    });

    candidates.sort((a, b) => b.score - a.score);
    const seen = new Set();
    const list = [];
    candidates.forEach((c) => {
      if (seen.has(c.chord.name)) return;
      seen.add(c.chord.name);
      list.push(c.chord);
    });
    return { best: list[0] || null, alternatives: list.slice(1, 6), pcs };
  }

  /** Parse a chord symbol such as "F#m7b5", "Bb/D", "C6/9". */
  function parse(symbol) {
    if (!symbol) return null;
    let s = String(symbol).trim().replace(/♯/g, '#').replace(/♭/g, 'b');
    if (!s) return null;
    const m = /^([A-G])(#|b)?(.*)$/.exec(s);
    if (!m) return null;
    const rootNm = m[1] + (m[2] || '');
    let rest = m[3];
    let bassNm = null;
    // Split off a slash bass, but keep "6/9" and "m/maj7" intact.
    const slash = /\/([A-G](#|b)?)$/.exec(rest);
    if (slash) {
      bassNm = slash[1];
      rest = rest.slice(0, slash.index);
    }
    rest = rest.replace(/\s+/g, '');
    let suffix = Object.prototype.hasOwnProperty.call(SUFFIX_ALIASES, rest) ? SUFFIX_ALIASES[rest] : undefined;
    if (suffix === undefined) {
      const stripped = rest.replace(/[()]/g, '');
      if (Object.prototype.hasOwnProperty.call(SUFFIX_ALIASES, stripped)) suffix = SUFFIX_ALIASES[stripped];
    }
    if (suffix === undefined) return null;
    const template = TEMPLATE_BY_SUFFIX[suffix];
    const root = parseNoteName(rootNm);
    const chord = { rootPc: root.pc, rootName: root.name, suffix, template, bassPc: null, bassName: null };
    if (bassNm) {
      const b = parseNoteName(bassNm);
      if (b.pc !== root.pc) {
        chord.bassPc = b.pc;
        chord.bassName = b.name;
      }
    }
    chord.name = chordName(chord);
    return chord;
  }

  function isChord(symbol) { return parse(symbol) !== null; }

  /** Canonical key for comparing chord names ("Amin7" == "Am7"). */
  function canonical(symbol) {
    const c = parse(symbol);
    if (!c) return String(symbol || '').trim();
    return mod12(c.rootPc) + ':' + c.suffix + (c.bassPc !== null ? '/' + c.bassPc : '');
  }

  /**
   * Default two-hand voicing: bass note (left hand) + close-position chord
   * (right hand) around middle C, as MIDI note numbers.
   */
  function voicing(chord, opts) {
    const o = Object.assign({ bass: true }, opts);
    const pc = chord.rootPc;
    const rhRoot = 60 + pc - (pc >= 6 ? 12 : 0);
    let rel = [...new Set(chord.template.intervals.map((i) => i.semis % 12))];
    if (rel.length >= 5) rel = rel.filter((r) => r !== 7); // drop the 5th in big chords
    const rh = rel.map((r) => rhRoot + r).sort((a, b) => a - b);
    const notes = rh.slice();
    if (chord.bassPc !== null) {
      // Slash chord: nearest bass note at least a fourth below the right hand.
      let b = rhRoot - 1;
      while (mod12(b) !== chord.bassPc) b--;
      if (rhRoot - b < 5) b -= 12;
      notes.unshift(b);
    } else if (o.bass) {
      notes.unshift(rhRoot - 12);
    }
    return notes.filter((n) => n >= MIDI_MIN && n <= MIDI_MAX);
  }

  function transposeSymbol(symbol, semitones) {
    const c = parse(symbol);
    if (!c) return symbol;
    const rootPc = mod12(c.rootPc + semitones);
    const useFlats = c.rootName.includes('b');
    const useSharps = c.rootName.includes('#');
    const pick = (p, suffix) => (useFlats ? FLAT_NAMES[p] : useSharps ? SHARP_NAMES[p] : rootName(p, suffix));
    let out = pick(rootPc, c.suffix) + c.suffix;
    if (c.bassPc !== null) out += '/' + pick(mod12(c.bassPc + semitones), '');
    return out;
  }

  function isBlack(midi) { return [1, 3, 6, 8, 10].includes(mod12(midi)); }

  PC.Theory = {
    MIDI_MIN, MIDI_MAX, SHARP_NAMES, FLAT_NAMES,
    mod12, isBlack, midiName, rootName, labelNotes, chordName,
    detect, parse, isChord, canonical, voicing, transposeSymbol,
    setAccidentalPref, getAccidentalPref,
    templates: TEMPLATES,
  };
})(window.PC = window.PC || {});
