/*
 * Interactive 88-key keyboard (A0 - C8) rendered as SVG.
 */
(function (PC) {
  'use strict';

  const T = PC.Theory;
  const NS = 'http://www.w3.org/2000/svg';
  const WW = 24;
  const WH = 150;
  const BW = 14;
  const BH = 95;

  function el(name, attrs) {
    const e = document.createElementNS(NS, name);
    Object.keys(attrs || {}).forEach((k) => e.setAttribute(k, attrs[k]));
    return e;
  }

  /**
   * Create a keyboard inside `container`.
   * handlers: { onDown(midi), onUp(midi) }
   */
  function create(container, handlers) {
    const keys = {};
    const labels = {};
    const whiteLayer = el('g');
    const blackLayer = el('g');
    const labelLayer = el('g', { 'pointer-events': 'none' });
    let wi = 0;
    for (let m = T.MIDI_MIN; m <= T.MIDI_MAX; m++) {
      const black = T.isBlack(m);
      let rect;
      let cx;
      if (black) {
        const x = wi * WW - BW / 2;
        rect = el('rect', { x, y: 0, width: BW, height: BH, rx: 2, class: 'key black' });
        blackLayer.appendChild(rect);
        cx = x + BW / 2;
      } else {
        const x = wi * WW;
        rect = el('rect', { x, y: 0, width: WW, height: WH, rx: 3, class: 'key white' });
        whiteLayer.appendChild(rect);
        cx = x + WW / 2;
        if (T.mod12(m) === 0) {
          const t = el('text', { x: cx, y: WH - 8, class: 'octave-label' });
          t.textContent = 'C' + (Math.floor(m / 12) - 1);
          labelLayer.appendChild(t);
        }
        wi++;
      }
      rect.dataset.midi = m;
      keys[m] = rect;
      const lbl = el('text', { x: cx, y: black ? BH - 10 : WH - 26, class: 'note-label' + (black ? ' on-black' : '') });
      labelLayer.appendChild(lbl);
      labels[m] = lbl;
    }
    const width = wi * WW;
    const svg = el('svg', { viewBox: `0 0 ${width} ${WH}`, class: 'piano', role: 'img', 'aria-label': '88-key piano keyboard' });
    svg.appendChild(whiteLayer);
    svg.appendChild(blackLayer);
    svg.appendChild(labelLayer);
    container.innerHTML = '';
    container.appendChild(svg);

    // Pointer handling (mouse / touch / pen), with glissando while dragging.
    const active = new Map(); // pointerId -> midi
    function keyAt(evt) {
      const t = document.elementFromPoint(evt.clientX, evt.clientY);
      return t && t.dataset && t.dataset.midi ? parseInt(t.dataset.midi, 10) : null;
    }
    svg.addEventListener('pointerdown', (evt) => {
      const m = keyAt(evt);
      if (m === null) return;
      evt.preventDefault();
      active.set(evt.pointerId, m);
      handlers.onDown(m, evt);
    });
    svg.addEventListener('pointermove', (evt) => {
      if (!active.has(evt.pointerId) || !evt.buttons) return;
      const m = keyAt(evt);
      const prev = active.get(evt.pointerId);
      if (m === null || m === prev) return;
      handlers.onUp(prev, evt);
      active.set(evt.pointerId, m);
      handlers.onDown(m, evt);
    });
    function release(evt) {
      if (!active.has(evt.pointerId)) return;
      handlers.onUp(active.get(evt.pointerId), evt);
      active.delete(evt.pointerId);
    }
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);

    /** held: Set of physically held notes; lit: Map midi -> label for chord notes. */
    function render(held, lit) {
      for (let m = T.MIDI_MIN; m <= T.MIDI_MAX; m++) {
        const k = keys[m];
        k.classList.toggle('held', held.has(m));
        k.classList.toggle('lit', lit.has(m));
        labels[m].textContent = lit.has(m) ? lit.get(m) : '';
      }
    }

    function scrollTo(midi) {
      const k = keys[midi];
      if (!k) return;
      const x = parseFloat(k.getAttribute('x'));
      const ratio = container.scrollWidth / width;
      container.scrollLeft = Math.max(0, x * ratio - container.clientWidth / 2);
    }

    return { render, scrollTo };
  }

  PC.Keyboard = { create };
})(window.PC = window.PC || {});
