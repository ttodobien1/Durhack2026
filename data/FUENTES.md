# Fuentes

Atribución de cada colección usada para las piezas semilla de Lineage.
Este archivo lo genera `data/scripts/10_export.py`; no editarlo a mano.

## Groove MIDI Dataset (Google Magenta)

- **Link:** https://magenta.tensorflow.org/datasets/groove
- **License:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)
- **Dataset authors:** Jon Gillick, Adam Roberts, Jesse Engel, Douglas Eck, David Bamman
- **Performers:** 10 drummers, credited as drummer1 ... drummer10 (as in the dataset)
- **Cite as:** Gillick, J., Roberts, A., Engel, J., Eck, D., & Bamman, D. (2019). Learning to Groove with Inverse Sequence Transformations. ICML.
- **Pieces in Lineage:** 302 (`p-101` to `p-402`), each with `autor`, `licencia` and `fuente` set
- **Changes made** (CC BY requires saying so):
  - Kept only 4/4 beats (no fills) in hip-hop, funk, soul, New Orleans and jazz, 70-110 BPM.
  - Cut into 2- and 4-bar loops.
  - Mapped the Roland TD-11 drum notes to 9 standard drum sounds.
  - Soft quantization (each hit moved halfway to the nearest 16th note).
  - Merged repeated hits of the same sound on the same 16th note.
  - Removed near-duplicate loops from the same recording.

## Excluded

- **Lakh MIDI Dataset:** not used, it contains many copyrighted works.
