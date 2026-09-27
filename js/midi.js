/*
 * Web MIDI input: forwards note on/off and sustain pedal from every
 * connected input device.
 */
(function (PC) {
  'use strict';

  let access = null;

  /**
   * handlers: { onNoteOn(note, velocity), onNoteOff(note), onSustain(bool), onStatus(status, deviceNames[]) }
   */
  function init(handlers) {
    if (!navigator.requestMIDIAccess) {
      handlers.onStatus('unsupported', []);
      return;
    }
    navigator.requestMIDIAccess({ sysex: false }).then((a) => {
      access = a;
      bind(handlers);
      access.onstatechange = () => bind(handlers);
    }, () => handlers.onStatus('denied', []));
  }

  function bind(handlers) {
    const names = [];
    access.inputs.forEach((input) => {
      names.push(input.name);
      input.onmidimessage = (msg) => handle(msg.data, handlers);
    });
    handlers.onStatus(names.length ? 'connected' : 'none', names);
  }

  function handle(data, h) {
    const cmd = data[0] & 0xf0;
    const d1 = data[1];
    const d2 = data[2];
    if (cmd === 0x90 && d2 > 0) h.onNoteOn(d1, d2 / 127);
    else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) h.onNoteOff(d1);
    else if (cmd === 0xb0 && d1 === 64) h.onSustain(d2 >= 64);
    else if (cmd === 0xb0 && (d1 === 123 || d1 === 120)) h.onAllOff && h.onAllOff();
  }

  PC.Midi = { init };
})(window.PC = window.PC || {});
