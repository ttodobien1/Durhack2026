// "Hum to DJ Stemy": the browser transcribes the user's humming into notes; here the server finds the library melodies
// that sound like it (lib/melody.js) and tells the copilot. The copilot only recommends what this finds plus pieces
// it searches for; it never writes the melody itself.
import { detectKey, melodyLine, rankByMelody, relativeKey, transposeKey } from '../lib/melody.js';
import { searchPiezas } from '../repo/piezas.js';

export const STRONG_MATCH = 0.7; // from here on, "your humming sounds like <piece>"
const MIN_MATCH = 0.3; // below this a melody is not worth mentioning

const percent = (similitud) => `${Math.round(similitud * 100)}%`;
const keyName = (key) => (key?.endsWith('m') ? `${key.slice(0, -1)} minor` : key ? `${key} major` : 'an unclear key');

/** Key, length and closest library melodies of a humming ({ notas } already validated). */
export async function analyzeHum(notas) {
  const melodias = await searchPiezas({ tipo: 'melodia' }); // public pieces only
  const coincidencias = rankByMelody(notas, melodias, { limit: 5, min: MIN_MATCH });
  // A few hummed notes say little about the key; when the humming clearly is a known piece, its key (moved to
  // where the user sang it) is far more reliable.
  const best = coincidencias[0]?.similitud >= STRONG_MATCH && coincidencias[0].pieza.tonalidad ? coincidencias[0] : null;
  const tonalidad = best ? transposeKey(best.pieza.tonalidad, best.transponer) : detectKey(notas);
  const beats = Math.max(...notas.map((n) => n.inicio + n.duracion));
  return {
    tonalidad,
    relativa: relativeKey(tonalidad),
    notas: melodyLine(notas).length,
    compases: Math.max(1, Math.ceil(beats / 4)),
    coincidencias,
  };
}

/** What the copilot is told about the humming (added to the user's turn). */
export function describeHum(hum) {
  const lines = [
    `The user hummed a melody into the microphone. Stemma transcribed it to MIDI: ${hum.notas} notes, about ${hum.compases} ${
      hum.compases === 1 ? 'bar' : 'bars'
    }, most likely in ${keyName(hum.tonalidad)}${hum.relativa ? ` (relative key: ${hum.relativa})` : ''}.`,
  ];
  if (hum.coincidencias.length) {
    lines.push('Closest melodies in the library (pitch-interval and rhythm matching, computed by Stemma):');
    for (const { pieza, similitud, transponer } of hum.coincidencias) {
      const shift = transponer ? `, the user sang it ${Math.abs(transponer)} semitones ${transponer > 0 ? 'higher' : 'lower'}` : '';
      lines.push(`- ${pieza.id} "${pieza.nombre}" by ${pieza.autor} (${pieza.licencia}, key ${pieza.tonalidad ?? '?'}): ${percent(similitud)} match${shift}`);
    }
  } else {
    lines.push('No melody in the library is close to it.');
  }
  lines.push(
    `If the best match is ${percent(STRONG_MATCH)} or more, tell the user their humming sounds like that piece, credit its author, and put it first in piezas_sugeridas. ` +
      'If no match is that close, say the library has nothing like that melody yet (do not claim a match). ' +
      `Either way, search for pieces that would accompany the humming (chords, bass, drums) in ${hum.tonalidad ?? 'its key'}${
        hum.relativa ? ` or ${hum.relativa}` : ''
      }, following the genre and instrument the user asked for in this chat. Never write the melody or new notes yourself.`,
  );
  return lines.join('\n');
}

/** The humming facts returned to the frontend next to the copilot's answer. */
export function humSummary(hum) {
  return {
    tonalidad: hum.tonalidad,
    notas: hum.notas,
    coincidencias: hum.coincidencias.map(({ pieza, similitud, transponer }) => ({
      id: pieza.id,
      nombre: pieza.nombre,
      autor: pieza.autor,
      licencia: pieza.licencia,
      similitud,
      transponer,
    })),
  };
}

/** The best match, if it is strong enough to say "it sounds like this". */
export const strongMatch = (hum) => (hum.coincidencias[0]?.similitud >= STRONG_MATCH ? hum.coincidencias[0] : null);

async function firstPiece(filters) {
  for (const f of filters) {
    const [pieza] = await searchPiezas({ ...f, limit: 1 });
    if (pieza) return pieza;
  }
  return null;
}

/** Answer without a language model (no API key, or the model failed): the matches plus pieces in the hummed key. */
export async function humFallbackAnswer(hum) {
  const keys = [hum.tonalidad, hum.relativa].filter(Boolean);
  const inKey = (tipo) => [...keys.map((tonalidad) => ({ tipo, tonalidad, estilo: 'rap' })), ...keys.map((tonalidad) => ({ tipo, tonalidad }))];
  const [acordes, bajo, ritmo] = await Promise.all([
    firstPiece(inKey('acordes')),
    firstPiece(inKey('bajo')),
    firstPiece([{ tipo: 'ritmo', estilo: 'rap' }, { tipo: 'ritmo' }]),
  ]);
  const best = strongMatch(hum);
  const accompaniment = [acordes, bajo, ritmo].filter(Boolean);
  const parts = [];
  if (best) {
    parts.push(`That sounds like "${best.pieza.nombre}" by ${best.pieza.autor} (${percent(best.similitud)} match, ${best.pieza.licencia}).`);
  } else if (hum.coincidencias.length) {
    const near = hum.coincidencias[0];
    parts.push(`I don't have that melody in the library yet (closest: "${near.pieza.nombre}", ${percent(near.similitud)}).`);
  } else {
    parts.push("I don't have that melody in the library yet.");
  }
  if (accompaniment.length) {
    parts.push(
      `Your humming sits in ${keyName(hum.tonalidad)}, so these fit around it: ${accompaniment
        .map((p) => `${p.nombre} (${p.tipo} by ${p.autor})`)
        .join(', ')}.`,
    );
  }
  parts.push('You stay the composer.');
  return {
    texto: parts.join(' '),
    piezas_sugeridas: [...(best ? [best.pieza.id] : []), ...accompaniment.map((p) => p.id)],
  };
}
