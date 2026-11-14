# Fuentes

Atribución de cada colección usada para las piezas semilla de Stemma.
Este archivo lo genera `data/scripts/10_export.py`; no editarlo a mano.

## Groove MIDI Dataset (Google Magenta)

- **Link:** https://magenta.tensorflow.org/datasets/groove
- **License:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Authors:** Jon Gillick, Adam Roberts, Jesse Engel, Douglas Eck, David Bamman
- **Performers:** 10 drummers, credited as drummer1 ... drummer10 (as in the dataset)
- **Cite as:** Gillick, J., Roberts, A., Engel, J., Eck, D., & Bamman, D. (2019). Learning to Groove with Inverse Sequence Transformations. ICML.
- **Pieces in Stemma:** 302 (`p-101` to `p-402`) in `data/piezas/groove.json`; exact origin of each id in `data/provenance/groove.json`
- **License text:** `data/licenses/groove-midi-dataset.LICENSE.txt`
- **Changes made:**
  - Kept only 4/4 beats (no fills) in hip-hop, funk, soul, New Orleans and jazz, 70-110 BPM.
  - Cut into 2- and 4-bar loops.
  - Mapped the Roland TD-11 drum notes to 9 standard drum sounds.
  - Soft quantization (each hit moved halfway to the nearest 16th note).
  - Merged repeated hits of the same sound on the same 16th note.
  - Removed near-duplicate loops from the same recording.

## free-midi-chords (Ludovic Drolez)

- **Link:** https://github.com/ldrolez/free-midi-chords
- **License:** [MIT](https://github.com/ldrolez/free-midi-chords/blob/v0.20260914/LICENSE)
- **Authors:** Ludovic Drolez and the project's contributors (Copyright (c) 2019 Ludovic Drolez)
- **Performers:** Programmed chord progressions (no performer)
- **Cite as:** free-midi-chords, release v0.20260914, https://github.com/ldrolez/free-midi-chords
- **Pieces in Stemma:** 431 (`p-1001` to `p-1431`) in `data/piezas/free-midi-chords.json`; exact origin of each id in `data/provenance/fmc.json`
- **License text:** `data/licenses/free-midi-chords.LICENSE.txt`
- **Changes made:**
  - Kept the 4-chord minor progressions in the "hiphop2 style" rhythm, keys Am, Cm, Dm, Em and Gm.
  - Split the low root note under each chord (always below C3) into its own bass-line piece; the chord tones stay as the chords piece. No notes were added or changed.
  - Soft quantization (no audible change: the files are already on the grid).
  - Key taken from the file name (the detector's agreement is reported by stage 6).
  - The MIT license text is kept in data/licenses/free-midi-chords.LICENSE.txt.

## Sounds: FluidR3_GM (pre-rendered by gleitz/midi-js-soundfonts)

- **Author:** Frank Wen
- **License:** [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/us/) (evidence: https://github.com/gleitz/midi-js-soundfonts#readme (Fluid Soundfont section))
- **Repository:** https://github.com/gleitz/midi-js-soundfonts
- **Used for:** `rhodes` (electric_piano_1), `bajo_electrico` (electric_bass_finger), `bajo_synth` (synth_bass_1), `pad` (pad_2_warm), `vibrafono` (vibraphone)
- **Files:** 150 mp3, each with its URL and sha256 in `frontend/public/samples/fluidr3/manifest.json`
- **Changes:** None. Files are copied byte for byte from the repository's GitHub Pages site.
- Full sound credits (including the Salamander piano): `frontend/public/samples/CREDITS.md`

## Excluded

- **Lakh MIDI Dataset:** not used, it contains many copyrighted works.
- **MusyngKite / FatBoy soundfonts:** not used, they are CC BY-SA (share-alike).
