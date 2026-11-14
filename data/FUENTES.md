# Fuentes

Atribución de cada colección usada para las piezas semilla de Stemma.
Este archivo lo genera `data/scripts/10_export.py`; no editarlo a mano.

## Groove MIDI Dataset (Google Magenta)

- **Link:** https://magenta.tensorflow.org/datasets/groove
- **License:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Dataset authors:** Jon Gillick, Adam Roberts, Jesse Engel, Douglas Eck, David Bamman
- **Performers:** 10 drummers, credited as drummer1 ... drummer10 (as in the dataset)
- **Cite as:** Gillick, J., Roberts, A., Engel, J., Eck, D., & Bamman, D. (2019). Learning to Groove with Inverse Sequence Transformations. ICML.
- **Pieces in Stemma:** 302 (`p-101` to `p-402`), each with `autor`, `licencia` and `fuente` set
- **Changes made** (CC BY requires saying so):
  - Kept only 4/4 beats (no fills) in hip-hop, funk, soul, New Orleans and jazz, 70-110 BPM.
  - Cut into 2- and 4-bar loops.
  - Mapped the Roland TD-11 drum notes to 9 standard drum sounds.
  - Soft quantization (each hit moved halfway to the nearest 16th note).
  - Merged repeated hits of the same sound on the same 16th note.
  - Removed near-duplicate loops from the same recording.

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
