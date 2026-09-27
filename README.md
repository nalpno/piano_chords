# Piano Chord Studio

A browser-based tool for pianists and keyboard players: an 88-key MIDI keyboard that recognises the chords you play, saves them as chord charts (name + voicing), plays them back, and builds chord sheets for whole songs. It's plain HTML, CSS and JavaScript with no build step and no server.

The interface is available in **English** and **Turkish** (EN / TR switch in the top-right corner).

## Features

### Keyboard
- A full **88-key keyboard** (A0–C8) on screen.
- **MIDI input** through the Web MIDI API (Chrome, Edge and Opera). It works with any USB or Bluetooth MIDI keyboard and supports the sustain pedal (CC64).
- **Mouse / touch**: in *latch* mode each click toggles a key, so you can build a chord one note at a time. With latch off, keys sound only while you hold them.
- **Computer keyboard**: `A W S E D F T G Y H U J K` play one octave. `Z` / `X` shift down or up an octave.
- **Chord detection**. Common chords are named correctly, including triads, sus, 6, 7, maj7, m7b5, dim7, add9, 6/9, 9, 11 and 13, altered dominants, and inversions and slash chords (`C/E`, `Am7/G`). Notes are spelled from the chord's root (for example Cdim7 = C Eb Gb Bbb). Other possible names are shown as clickable chips.
- The last chord stays on screen after you release the keys, so you can still save it. Notes played while the pedal is down are grouped into one chord.
- **Show a chord**: type a name such as `F#m7b5` or `Bb/D` and it appears on the keyboard.
- **Sound**: a built-in Web Audio synthesizer (piano, electric piano, organ) with *Play* and *Arpeggio* buttons.

### Chord charts
- Each chord is drawn as a small keyboard with the pressed keys highlighted. The chord name is at the top left, the notes are listed at the top right, and the note names are written under the keys.
- Two diagram styles: **filled keys** (classic) or **dots**. The highlight colour can be changed.
- Accidentals can be set to automatic, sharps (♯) or flats (♭).
- Any chord can be exported as a **PNG** image or a **PDF**.

### Chord library
- **Save** any chord with its exact voicing (the keys you pressed) and a name. You can edit the name before saving.
- Play, rename or delete saved chords, or send one back to the keyboard.
- Export the whole library as a multi-page **PDF** or a single **PNG** sheet.
- Back up or restore the library as JSON. It is also saved automatically in the browser (localStorage).

### MIDI file → chords
- Load a **MIDI file** (`.mid` / `.midi`) by dropping it on the page or choosing it. Type 0 and type 1 files are supported, including tempo and time-signature changes and the sustain pedal.
- Choose which **tracks** to analyse. Drum tracks (channel 10) are skipped automatically. Deselecting a busy melody track often gives cleaner chords.
- The **chord progression** is shown bar by bar and uses the same chord names as the rest of the app. The page also shows the estimated key, tempo, time signature and length.
- Analysis options:
  - how often chords may change (every beat, every half bar or once per bar);
  - how much detail to use (triads, with 7ths, or extended 9/11/13 chords);
  - whether to show slash chords.
- **Exact voicing mode** (on by default) keeps the keys actually played in the file for every chord and names the chord from them. Complex chords such as Cmaj9, G13 (with or without 9th and 5th), Ebmaj7#11, Am11 or D7#9/F# keep their full names. Voicings that fit no standard chord are named as a chord plus an added tension, for example `F#dim(maj7)` or `C7(b13)`. A single-note melody track is left out by default so it doesn't end up in the voicings.
- Beats with only a few notes, like arpeggios and broken chords, are read together with the rest of their bar. Short passing melody notes don't produce extra chords.
- **Play** the file with the built-in synth. The current chord is highlighted and the sounding notes are shown on a keyboard. Click any chord to hear it, or to jump to it while the file is playing.
- **Send to Song Chart** also writes a `{voicing: Cmaj9 C3 E4 G4 B4 D5}` line for each chord, so the song chart draws each chord exactly as it was played in the MIDI file. These lines can be edited by hand.
- **Send to Song Chart** turns the progression into a chord sheet (chords above empty lines, 2/4/8 bars per line). Type the lyrics on the empty lines and you have a finished chart. You can also **Copy as text**.

### Song chart
Paste lyrics with chords in either of two formats:

**ChordPro (inline)**
```
{title: Amazing Grace}
[Verse 1]
A[G]mazing [G7]grace, how [C]sweet the [G]sound
```

**Chords above lyrics**
```
      G          G7        C        G
'Twas grace that taught my heart to fear,
```

The app produces:
- a **chord chart** at the top listing every chord in the song, and
- the lyrics with each **chord diagram placed exactly where the chord changes** (either can be switched off).

Section headings (`[Chorus]`, `Verse 2:`, `{comment: Bridge}`) are recognised. A `{voicing: <chord> <notes>}` line, such as `{voicing: G13 G2 F3 B3 E4}`, sets the exact keys used for that chord in the song. Chord names with an added tension in brackets, like `C7(b13)` or `Am(add9)`, are understood as well. The song can be **transposed**. If a chord is in your library, the sheet uses your saved voicing; otherwise it builds a standard voicing (bass note plus a close-position right-hand chord). The sheet exports to **PNG** or to a paginated A4 **PDF**.

## Getting started

1. Download or clone this repository.
2. Open `index.html` in Chrome or Edge. Double-clicking the file is enough.
3. Connect a MIDI keyboard and allow MIDI access when the browser asks.

To host it online, enable **GitHub Pages** for the repository (Settings → Pages → deploy from branch, root folder) and open the published URL.

> Web MIDI is not available in Firefox or Safari. The mouse, touch and computer-keyboard inputs work in every modern browser.

## Project structure

```
index.html          Page layout
css/style.css       Styles
js/theory.js        Note spelling, chord templates, detection, parsing, voicings
js/audio.js         Web Audio synthesizer
js/keyboard.js      Interactive 88-key SVG keyboard
js/midi.js          Web MIDI input
js/diagram.js       Chord chart (SVG) renderer
js/export.js        PNG / PDF export
js/song.js          Song parser, on-screen sheet and export layout
js/midifile.js      Standard MIDI File reader (and a small writer for the example)
js/analysis.js      Key estimation and chord-progression analysis of MIDI files
js/midichords.js    MIDI → Chords tab: tracks, bar grid, playback, export to song chart
js/i18n.js          English / Turkish UI strings
js/app.js           Application wiring and state
vendor/             jsPDF 2.5.2 (MIT licence), bundled so PDF export works offline
```

## Licenses

jsPDF is © James Hall and yWorks GmbH and is distributed under the MIT licence (see `vendor/jspdf.LICENSE`).
