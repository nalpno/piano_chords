/*
 * Standard MIDI File (SMF type 0/1) reader, plus a tiny writer used for the
 * built-in example song.
 */
(function (PC) {
  'use strict';

  function readVarLen(data, pos) {
    let value = 0;
    let b;
    do {
      b = data[pos.i++];
      value = (value << 7) | (b & 0x7f);
    } while (b & 0x80);
    return value;
  }

  function str(data, start, len) {
    let s = '';
    for (let i = start; i < start + len; i++) s += String.fromCharCode(data[i]);
    return s;
  }

  function latin(bytes) {
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch (e) {
      return Array.from(bytes, (c) => String.fromCharCode(c)).join('');
    }
  }

  /**
   * Parse an ArrayBuffer / Uint8Array.
   * Returns { format, ppq, tracks[{ name, notes[], channels[], program }], tempos[], timeSigs[], keySigs[], endTick }
   * Each note: { midi, start, end, velocity, channel, track } (ticks).
   */
  function parse(buffer) {
    const data = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    // Some files have a RIFF (RMID) wrapper.
    let offset = 0;
    if (str(data, 0, 4) === 'RIFF') {
      const idx = findChunk(data, 'MThd');
      if (idx < 0) throw new Error('Not a MIDI file');
      offset = idx;
    }
    if (str(data, offset, 4) !== 'MThd') throw new Error('Not a MIDI file');
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const headerLen = view.getUint32(offset + 4);
    const format = view.getUint16(offset + 8);
    const ntracks = view.getUint16(offset + 10);
    const division = view.getUint16(offset + 12);
    if (division & 0x8000) throw new Error('SMPTE time division is not supported');
    const ppq = division;

    const song = { format, ppq, tracks: [], tempos: [], timeSigs: [], keySigs: [], endTick: 0 };
    let pos = offset + 8 + headerLen;
    for (let t = 0; t < ntracks && pos + 8 <= data.length; t++) {
      const id = str(data, pos, 4);
      const len = view.getUint32(pos + 4);
      pos += 8;
      if (id !== 'MTrk') { pos += len; t--; continue; }
      song.tracks.push(parseTrack(data, pos, Math.min(pos + len, data.length), song, song.tracks.length));
      pos += len;
    }
    song.tempos.sort((a, b) => a.tick - b.tick);
    song.timeSigs.sort((a, b) => a.tick - b.tick);
    if (!song.tempos.length || song.tempos[0].tick > 0) song.tempos.unshift({ tick: 0, uspq: 500000 });
    if (!song.timeSigs.length || song.timeSigs[0].tick > 0) song.timeSigs.unshift({ tick: 0, num: 4, den: 4 });
    song.tracks.forEach((tr) => tr.notes.forEach((n) => { song.endTick = Math.max(song.endTick, n.end); }));
    return song;
  }

  function findChunk(data, id) {
    for (let i = 0; i < data.length - 4; i++) if (str(data, i, 4) === id) return i;
    return -1;
  }

  function parseTrack(data, start, end, song, index) {
    const track = { index, name: '', notes: [], channels: [], program: null };
    const pos = { i: start };
    let tick = 0;
    let running = 0;
    const open = {}; // key channel*128+note -> stack of {start, velocity}
    const channels = new Set();
    const pedal = new Array(16).fill(false);
    const pedalHeld = Array.from({ length: 16 }, () => []); // notes released while the pedal is down
    const finish = (n, endTick) => { if (endTick > n.start) track.notes.push(Object.assign(n, { end: endTick })); };
    while (pos.i < end) {
      tick += readVarLen(data, pos);
      let status = data[pos.i];
      if (status & 0x80) pos.i++;
      else status = running;
      if (status === 0xff) {
        const type = data[pos.i++];
        const len = readVarLen(data, pos);
        const d = data.subarray(pos.i, pos.i + len);
        if (type === 0x51 && len >= 3) song.tempos.push({ tick, uspq: (d[0] << 16) | (d[1] << 8) | d[2] });
        else if (type === 0x58 && len >= 2) song.timeSigs.push({ tick, num: d[0], den: Math.pow(2, d[1]) });
        else if (type === 0x59 && len >= 2) song.keySigs.push({ tick, sf: (d[0] << 24) >> 24, minor: d[1] === 1 });
        else if (type === 0x03 && !track.name) track.name = latin(d).trim();
        else if (type === 0x2f) { pos.i += len; break; }
        pos.i += len;
        continue;
      }
      if (status === 0xf0 || status === 0xf7) {
        pos.i += readVarLen(data, pos);
        continue;
      }
      running = status;
      const cmd = status & 0xf0;
      const ch = status & 0x0f;
      const d1 = data[pos.i++];
      const d2 = cmd === 0xc0 || cmd === 0xd0 ? 0 : data[pos.i++];
      if (cmd === 0x90 && d2 > 0) {
        const key = ch * 128 + d1;
        (open[key] = open[key] || []).push({ start: tick, velocity: d2 });
        channels.add(ch);
      } else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) {
        const stack = open[ch * 128 + d1];
        if (stack && stack.length) {
          const on = stack.shift();
          const note = { midi: d1, start: on.start, end: tick, velocity: on.velocity, channel: ch, track: index };
          // With the sustain pedal down the note keeps sounding until the pedal is released.
          if (pedal[ch]) pedalHeld[ch].push(note);
          else finish(note, tick);
        }
      } else if (cmd === 0xb0 && d1 === 64) {
        const down = d2 >= 64;
        if (pedal[ch] && !down) {
          pedalHeld[ch].forEach((n) => finish(n, tick));
          pedalHeld[ch] = [];
        }
        pedal[ch] = down;
      } else if (cmd === 0xc0 && track.program === null) {
        track.program = d1;
      }
    }
    pedalHeld.forEach((list) => list.forEach((n) => finish(n, Math.max(tick, n.end))));
    // Close notes that never received a note-off.
    Object.keys(open).forEach((key) => open[key].forEach((on) => {
      const k = Number(key);
      track.notes.push({ midi: k % 128, start: on.start, end: Math.max(tick, on.start + 1), velocity: on.velocity, channel: Math.floor(k / 128), track: index });
    }));
    track.notes.sort((a, b) => a.start - b.start || a.midi - b.midi);
    track.channels = [...channels].sort((a, b) => a - b);
    return track;
  }

  /** Build a tick -> seconds converter from the tempo map. */
  function timeMap(song) {
    const segs = [];
    let sec = 0;
    song.tempos.forEach((t, i) => {
      if (i > 0) {
        const prev = segs[segs.length - 1];
        sec = prev.sec + ((t.tick - prev.tick) * prev.uspq) / 1e6 / song.ppq;
      }
      segs.push({ tick: t.tick, uspq: t.uspq, sec });
    });
    return function toSeconds(tick) {
      let s = segs[0];
      for (let i = 1; i < segs.length && segs[i].tick <= tick; i++) s = segs[i];
      return s.sec + ((tick - s.tick) * s.uspq) / 1e6 / song.ppq;
    };
  }

  // ---------- Writer (used for the example) ----------
  function varLen(n) {
    const bytes = [n & 0x7f];
    while ((n >>= 7)) bytes.unshift((n & 0x7f) | 0x80);
    return bytes;
  }

  /**
   * tracks: [{ name, channel, notes: [{ midi, start, dur, vel }] }] (ticks).
   * Returns a Uint8Array containing a type-1 SMF.
   */
  function write(tracks, opts) {
    const o = Object.assign({ ppq: 480, bpm: 100, num: 4, den: 4 }, opts);
    const chunk = (id, bytes) => [...id].map((c) => c.charCodeAt(0))
      .concat([(bytes.length >>> 24) & 255, (bytes.length >>> 16) & 255, (bytes.length >>> 8) & 255, bytes.length & 255], bytes);
    const uspq = Math.round(60e6 / o.bpm);
    const out = chunk('MThd', [0, 1, 0, tracks.length + 1, (o.ppq >> 8) & 255, o.ppq & 255]);
    const conductor = [0, 0xff, 0x51, 3, (uspq >> 16) & 255, (uspq >> 8) & 255, uspq & 255,
      0, 0xff, 0x58, 4, o.num, Math.log2(o.den), 24, 8, 0, 0xff, 0x2f, 0];
    out.push(...chunk('MTrk', conductor));
    tracks.forEach((tr) => {
      const events = [];
      tr.notes.forEach((n) => {
        events.push({ t: n.start, b: [0x90 | tr.channel, n.midi, n.vel || 90] });
        events.push({ t: n.start + n.dur, b: [0x80 | tr.channel, n.midi, 0] });
      });
      events.sort((a, b) => a.t - b.t || (a.b[0] & 0xf0) - (b.b[0] & 0xf0));
      const name = [...(tr.name || '')].map((c) => c.charCodeAt(0) & 0x7f);
      let bytes = [0, 0xff, 0x03, name.length, ...name];
      if (tr.program != null) bytes.push(0, 0xc0 | tr.channel, tr.program);
      let last = 0;
      events.forEach((e) => {
        bytes = bytes.concat(varLen(e.t - last), e.b);
        last = e.t;
      });
      bytes.push(0, 0xff, 0x2f, 0);
      out.push(...chunk('MTrk', bytes));
    });
    return new Uint8Array(out);
  }

  PC.MidiFile = { parse, timeMap, write };
})(window.PC = window.PC || {});
