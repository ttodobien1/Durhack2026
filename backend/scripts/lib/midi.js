// MIDI file -> Pieza (contract 4.1), using @tonejs/midi.
import tonejsMidi from '@tonejs/midi';
import { validateNewPieza } from '../../src/lib/validate.js';

const { Midi } = tonejsMidi;
const EPSILON = 1e-6;

// buffer: contents of a .mid file.
// meta: { id, nombre, tipo, autor, licencia, fuente, tonalidad, estilo, parent_id,
//         tempo?, pista?, desde_compas?, compases?, cuantizar? }
//   pista        track index to import (default: all tracks merged)
//   desde_compas first bar to keep (0-based), useful to cut 2-4 bars from a long groove
//   compases     number of bars to keep (default: until the last note)
//   cuantizar    grid in beats to snap notes to, e.g. 0.25 = sixteenth notes (default: no snapping)
export function midiToPieza(buffer, meta) {
  const midi = new Midi(buffer);
  const ppq = midi.header.ppq;
  const [numerator, denominator] = midi.header.timeSignatures[0]?.timeSignature ?? [4, 4];
  const beatsPerBar = numerator * (4 / denominator); // in quarter notes
  const tempo = meta.tempo ?? Math.round(midi.header.tempos[0]?.bpm ?? 120);

  let tracks = midi.tracks;
  if (meta.pista !== undefined && meta.pista !== null) {
    if (!midi.tracks[meta.pista]) throw new Error(`Track ${meta.pista} does not exist (file has ${midi.tracks.length})`);
    tracks = [midi.tracks[meta.pista]];
  }

  let notas = tracks.flatMap((track) =>
    track.notes.map((note) => ({
      tono: note.midi,
      inicio: note.ticks / ppq,
      duracion: note.durationTicks / ppq,
      velocidad: note.velocity,
    })),
  );

  // Cut the requested bars and move them to beat 0.
  const start = (meta.desde_compas ?? 0) * beatsPerBar;
  const end = meta.compases ? start + meta.compases * beatsPerBar : Infinity;
  notas = notas
    .filter((nota) => nota.inicio >= start - EPSILON && nota.inicio < end - EPSILON)
    .map((nota) => ({
      ...nota,
      inicio: Math.max(0, nota.inicio - start),
      duracion: Math.min(nota.duracion, end - nota.inicio),
    }));

  const grid = meta.cuantizar;
  if (grid) {
    notas = notas.map((nota) => ({
      ...nota,
      inicio: Math.round(nota.inicio / grid) * grid,
      duracion: Math.max(grid, Math.round(nota.duracion / grid) * grid),
    }));
  }
  notas = notas.map((nota) => ({ ...nota, duracion: Math.max(nota.duracion, 0.01) }));

  const lastBeat = Math.max(0, ...notas.map((nota) => nota.inicio + nota.duracion));
  const compases = meta.compases ?? Math.max(1, Math.ceil(lastBeat / beatsPerBar - EPSILON));

  return validateNewPieza({
    id: meta.id,
    nombre: meta.nombre,
    tipo: meta.tipo,
    autor: meta.autor,
    licencia: meta.licencia,
    fuente: meta.fuente,
    tonalidad: meta.tonalidad,
    tempo,
    estilo: meta.estilo,
    compases,
    parent_id: meta.parent_id,
    notas,
  });
}

// Pieza -> MIDI bytes (one track). Handy for tests and a future "export MIDI" feature.
export function piezaToMidi(pieza) {
  const midi = new Midi();
  midi.header.setTempo(pieza.tempo);
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: [4, 4] });
  const ppq = midi.header.ppq;
  const track = midi.addTrack();
  if (pieza.tipo === 'ritmo') track.channel = 9; // General MIDI drums
  for (const nota of pieza.notas) {
    track.addNote({
      midi: nota.tono,
      ticks: Math.round(nota.inicio * ppq),
      durationTicks: Math.max(1, Math.round(nota.duracion * ppq)),
      velocity: nota.velocidad,
    });
  }
  return Buffer.from(midi.toArray());
}
