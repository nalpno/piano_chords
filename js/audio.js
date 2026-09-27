/*
 * Small Web Audio synthesizer (no samples required).
 */
(function (PC) {
  'use strict';

  const HARMONICS = {
    piano: [0, 1, 0.55, 0.32, 0.22, 0.14, 0.1, 0.06, 0.045, 0.03, 0.02, 0.012],
    epiano: [0, 1, 0.3, 0.08, 0.06, 0.02, 0.01],
    organ: [0, 1, 0.75, 0.5, 0.15, 0.35, 0.05, 0.25, 0.2],
  };

  let ctx = null;
  let master = null;
  let instrument = 'piano';
  let volume = 0.8;
  let sustain = false;
  const waves = {};
  const voices = new Map(); // midi -> voice (live playing)
  const sustained = new Set();

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(comp);
      comp.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function wave(kind) {
    if (!waves[kind]) {
      const h = HARMONICS[kind] || HARMONICS.piano;
      const real = new Float32Array(h.length);
      const imag = Float32Array.from(h);
      waves[kind] = ctx.createPeriodicWave(real, imag);
    }
    return waves[kind];
  }

  function freq(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  function startVoice(midi, velocity, when) {
    const t = when || ctx.currentTime;
    const f = freq(midi);
    const vel = Math.max(0.05, Math.min(1, velocity == null ? 0.8 : velocity));
    const osc = ctx.createOscillator();
    osc.setPeriodicWave(wave(instrument));
    osc.frequency.value = f;
    const osc2 = ctx.createOscillator();
    osc2.setPeriodicWave(wave(instrument));
    osc2.frequency.value = f;
    osc2.detune.value = instrument === 'organ' ? 4 : 2.5;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    const g = ctx.createGain();
    const peak = 0.16 * vel;

    g.gain.setValueAtTime(0, t);
    if (instrument === 'organ') {
      filter.frequency.setValueAtTime(Math.min(12000, f * 8), t);
      g.gain.linearRampToValueAtTime(peak * 0.7, t + 0.02);
    } else {
      const bright = Math.min(16000, f * (4 + 6 * vel) + 1200);
      filter.frequency.setValueAtTime(bright, t);
      filter.frequency.exponentialRampToValueAtTime(Math.max(f * 2, 600), t + 2.5);
      // Lower notes ring longer, like a real piano.
      const decay = (instrument === 'epiano' ? 1.6 : 0.9) + ((108 - midi) / 87) * 2.2;
      g.gain.linearRampToValueAtTime(peak, t + 0.006);
      g.gain.setTargetAtTime(peak * 0.4, t + 0.006, 0.12);
      g.gain.setTargetAtTime(0.0001, t + 0.3, decay);
    }

    osc.connect(filter);
    osc2.connect(filter);
    filter.connect(g);
    g.connect(master);
    osc.start(t);
    osc2.start(t);
    return { osc, osc2, g };
  }

  function stopVoice(v, when, fast) {
    const t = Math.max(when || 0, ctx.currentTime);
    try {
      if (t <= ctx.currentTime + 0.01) {
        // Releasing now: freeze the envelope at its current level first.
        v.g.gain.cancelScheduledValues(t);
        v.g.gain.setValueAtTime(v.g.gain.value, t);
      }
      v.g.gain.setTargetAtTime(0, t, fast ? 0.01 : 0.09);
      v.osc.stop(t + (fast ? 0.1 : 0.8));
      v.osc2.stop(t + (fast ? 0.1 : 0.8));
    } catch (e) { /* voice already stopped */ }
  }

  function noteOn(midi, velocity) {
    if (!ensure()) return;
    const old = voices.get(midi);
    if (old) stopVoice(old, 0, true);
    sustained.delete(midi);
    voices.set(midi, startVoice(midi, velocity));
  }

  function noteOff(midi) {
    if (!ctx) return;
    const v = voices.get(midi);
    if (!v) return;
    if (sustain) {
      sustained.add(midi);
      return;
    }
    stopVoice(v);
    voices.delete(midi);
  }

  function setSustain(on) {
    sustain = on;
    if (!on) {
      sustained.forEach((m) => {
        const v = voices.get(m);
        if (v) stopVoice(v);
        voices.delete(m);
      });
      sustained.clear();
    }
  }

  /** Play a chord once. opts: { arpeggio: bool, duration: seconds } */
  function playChord(notes, opts) {
    if (!ensure() || !notes || !notes.length) return;
    const o = Object.assign({ arpeggio: false, duration: 1.8, velocity: 0.75 }, opts);
    const sorted = [...notes].sort((a, b) => a - b);
    const t0 = ctx.currentTime + 0.02;
    const step = o.arpeggio ? 0.14 : 0.012;
    const end = t0 + o.duration + (o.arpeggio ? step * sorted.length : 0);
    sorted.forEach((n, i) => {
      const v = startVoice(n, o.velocity, t0 + i * step);
      stopVoice(v, end);
    });
  }

  function allOff() {
    if (!ctx) return;
    voices.forEach((v) => stopVoice(v, 0, true));
    voices.clear();
    sustained.clear();
  }

  function setInstrument(name) { if (HARMONICS[name]) instrument = name; }
  function setVolume(v) {
    volume = v;
    if (master) master.gain.value = v;
  }

  PC.Audio = { noteOn, noteOff, setSustain, playChord, allOff, setInstrument, setVolume, unlock: ensure };
})(window.PC = window.PC || {});
