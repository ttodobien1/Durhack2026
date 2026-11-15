// One line of text describing a piece, for semantic search (Gemini embeddings of public pieces).
// Names and tags alone are thin, so the line adds musical character computed from the notes: tempo and key as
// moods, density, register, where the notes fall in the beat, and per-voice drum traits.
// That is what lets "dark rainy night, slow" find pieces whose names say none of it. Pure and deterministic.
// (Rhythm is read from onset positions, not from the strongest fingerprint magnitude: high DFT harmonics rise on any
// busy pattern, which labelled straight grooves "triplet feel".)

const TYPE_WORDS = { ritmo: 'drums', acordes: 'chords', bajo: 'bass line', melodia: 'melody' };
const NOTE = { C: 'C', 'C#': 'C sharp', Db: 'D flat', D: 'D', 'D#': 'D sharp', Eb: 'E flat', E: 'E', F: 'F', 'F#': 'F sharp', Gb: 'G flat', G: 'G', 'G#': 'G sharp', Ab: 'A flat', A: 'A', 'A#': 'A sharp', Bb: 'B flat', B: 'B' };
const KICK = new Set([35, 36]);
const SNARE = new Set([37, 38, 39, 40]);
const HAT = new Set([22, 26, 42, 44, 46]);

const tempoWord = (bpm) => (bpm < 80 ? 'slow' : bpm < 100 ? 'mid-tempo' : bpm < 125 ? 'upbeat' : 'fast, half-time feel');

function keyWords(tonalidad) {
  const m = /^([A-G][#b]?)(m?)$/.exec(tonalidad ?? '');
  if (!m) return null;
  return m[2] ? `${NOTE[m[1]] ?? m[1]} minor, darker mood` : `${NOTE[m[1]] ?? m[1]} major, brighter mood`;
}

export function describePiece(pieza) {
  const notas = pieza.notas ?? [];
  const bars = Math.max(1, pieza.compases ?? Math.ceil(Math.max(0, ...notas.map((n) => n.inicio + n.duracion)) / 4));
  const perBar = notas.length / bars;
  const traits = [perBar < 4 ? 'sparse' : perBar > 10 ? 'busy' : 'moderate density'];

  if (pieza.tipo === 'ritmo') {
    const count = (set) => notas.filter((n) => set.has(n.tono)).length / bars;
    const kick = count(KICK);
    const hats = count(HAT);
    if (kick) traits.push(kick <= 2 ? 'sparse kick' : kick >= 4 ? 'busy kick' : 'steady kick');
    if (hats) traits.push(hats >= 8 ? 'busy hi-hats' : hats <= 4 ? 'light hi-hats' : 'steady hi-hats');
    const snares = notas.filter((n) => SNARE.has(n.tono));
    if (snares.length && snares.filter((n) => [1, 3].includes(Math.round(n.inicio) % 4)).length / snares.length > 0.6) traits.push('backbeat snare');
    if (notas.some((n) => !KICK.has(n.tono) && !SNARE.has(n.tono) && !HAT.has(n.tono))) traits.push('extra percussion');
  } else if (notas.length) {
    const avg = notas.reduce((s, n) => s + n.tono, 0) / notas.length;
    traits.push(avg < 48 ? 'low register' : avg < 67 ? 'mid register' : 'high register');
  }

  // Where the notes fall within the beat.
  if (notas.length >= 4) {
    const share = (test) => notas.filter((n) => test(((n.inicio % 1) + 1) % 1)).length / notas.length;
    const near = (x, t) => Math.abs(x - t) < 0.05;
    if (share((x) => near(x, 1 / 3) || near(x, 2 / 3)) > 0.25) traits.push('swung, triplet feel');
    else if (share((x) => near(x, 0.25) || near(x, 0.75)) > 0.25) traits.push('syncopated');
    else if (share((x) => near(x, 0.5)) > 0.3) traits.push('eighth-note groove');
    else traits.push('straight, on the beat');
  }

  return [
    pieza.nombre,
    TYPE_WORDS[pieza.tipo] ?? pieza.tipo,
    `${pieza.tempo} BPM, ${tempoWord(pieza.tempo)}`,
    keyWords(pieza.tonalidad),
    pieza.estilo?.length ? `styles: ${pieza.estilo.join(', ')}` : null,
    [...new Set(traits)].join(', '),
  ]
    .filter(Boolean)
    .join(' · ');
}
