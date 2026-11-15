// "Hum to DJ Stemy": the browser transcribes the user's humming into notes; here the server finds the library melodies
// that sound like it (lib/melody.js) and tells the copilot. The copilot only recommends what this finds plus pieces
// it searches for; it never writes the melody itself.
//
// Stemma decides the verdict itself (it is a number, not a judgement call), tells the model in plain words, and checks
// the answer: a model that says "no close match" while the humming clearly is a known piece gets replaced.
import { detectKey, melodyLine, rankByMelody, relativeKey, transposeKey } from '../lib/melody.js';
import { normalizeText } from '../lib/normalize.js';
import { searchPiezas } from '../repo/piezas.js';

// Verdict thresholds. A wrong melody rarely scores above ~0.6 against a humming, while a real humming of a piece
// usually lands between 0.65 and 1 (people sing a few notes off, merge or skip some).
export const STRONG_MATCH = 0.6; // "your humming sounds like <piece>"...
const CLEAR_LEAD = 0.1; // ...when it is also clearly ahead of the second melody,
const SURE_MATCH = 0.8; // ...or this high whatever the rest scored
export const POSSIBLE_MATCH = 0.45; // "it reminds me of <piece>"
const MIN_MATCH = 0.3; // below this a melody is not worth mentioning

const percent = (similitud) => `${Math.round(similitud * 100)}%`;
const keyName = (key) => (key?.endsWith('m') ? `${key.slice(0, -1)} minor` : key ? `${key} major` : 'an unclear key');

/**
 * What the humming is: { tipo: 'coincide' | 'parecido' | 'ninguno', match } where `match` is the best melody
 * ({ pieza, similitud, transponer }) for 'coincide' (it is that piece) and 'parecido' (it reminds of it).
 */
export function verdict(coincidencias) {
  const [best, second] = coincidencias;
  if (!best) return { tipo: 'ninguno', match: null };
  const lead = best.similitud - (second?.similitud ?? 0);
  if (best.similitud >= SURE_MATCH || (best.similitud >= STRONG_MATCH && lead >= CLEAR_LEAD)) return { tipo: 'coincide', match: best };
  if (best.similitud >= POSSIBLE_MATCH) return { tipo: 'parecido', match: best };
  return { tipo: 'ninguno', match: null };
}

/** Key, length, closest library melodies and verdict of a humming ({ notas } already validated). */
export async function analyzeHum(notas) {
  const melodias = await searchPiezas({ tipo: 'melodia' }); // public pieces only
  const coincidencias = rankByMelody(notas, melodias, { limit: 5, min: MIN_MATCH });
  const veredicto = verdict(coincidencias);
  // A few hummed notes say little about the key; when the humming is a known piece, its key (moved to where the user
  // sang it) is far more reliable.
  const known = veredicto.tipo === 'coincide' && veredicto.match.pieza.tonalidad ? veredicto.match : null;
  const tonalidad = known ? transposeKey(known.pieza.tonalidad, known.transponer) : detectKey(notas);
  const beats = Math.max(...notas.map((n) => n.inicio + n.duracion));
  return {
    tonalidad,
    relativa: relativeKey(tonalidad),
    notas: melodyLine(notas).length,
    compases: Math.max(1, Math.ceil(beats / 4)),
    coincidencias,
    veredicto,
  };
}

/** What the copilot is told about the humming (added to the user's turn): the verdict first, then the details. */
export function describeHum(hum) {
  const { tipo, match } = hum.veredicto;
  const lines = [];
  if (tipo === 'coincide') {
    const p = match.pieza;
    lines.push(
      `HUMMING VERDICT (computed by Stemma, it is correct, never contradict it): the user's humming IS ${p.id} "${p.nombre}" by ${p.autor} (${percent(match.similitud)} match). ` +
        `Start your answer by telling the user, with enthusiasm, that their humming sounds like "${p.nombre}" by ${p.autor} (${p.licencia}), and put ${p.id} first in piezas_sugeridas. ` +
        'Do not say there is no match: there is one.',
    );
  } else if (tipo === 'parecido') {
    const p = match.pieza;
    lines.push(
      `HUMMING VERDICT (computed by Stemma): the user's humming resembles ${p.id} "${p.nombre}" by ${p.autor} (${percent(match.similitud)} match), not exactly. ` +
        `Tell the user it reminds you of "${p.nombre}" and offer ${p.id} as an option. Do not say the library has nothing like it.`,
    );
  } else {
    lines.push(
      'HUMMING VERDICT (computed by Stemma): no melody in the library is close to the humming. Say kindly that the library has nothing like that melody yet, ' +
        'so it can be the user\'s own idea, and do not name any library melody as a match.',
    );
  }
  lines.push(
    `The humming was transcribed to MIDI: ${hum.notas} notes, about ${hum.compases} ${hum.compases === 1 ? 'bar' : 'bars'}, most likely in ${keyName(
      hum.tonalidad,
    )}${hum.relativa ? ` (relative key: ${hum.relativa})` : ''}.`,
  );
  if (hum.coincidencias.length) {
    lines.push('Closest library melodies (pitch-interval and rhythm matching; these are real library pieces you may recommend):');
    for (const { pieza, similitud, transponer } of hum.coincidencias) {
      const shift = transponer ? `, sung ${Math.abs(transponer)} semitones ${transponer > 0 ? 'higher' : 'lower'}` : '';
      lines.push(`- ${pieza.id} "${pieza.nombre}" by ${pieza.autor} (${pieza.licencia}, key ${pieza.tonalidad ?? '?'}): ${percent(similitud)}${shift}`);
    }
  }
  lines.push(
    `Then search for pieces that would accompany the humming (chords, bass, drums) in ${hum.tonalidad ?? 'its key'}${
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
    veredicto: hum.veredicto.tipo,
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

/** The melody the humming is, or resembles: always the first suggestion. Null when nothing is close. */
export const verdictMatch = (hum) => hum.veredicto.match;

// "no close match", "does not have anything like", "nothing similar"...
const DENIAL = /\b(no|not|nothing|doesnt|does not|dont|do not|isnt|without|couldnt|could not|cant|cannot)\b[^.!?]{0,50}\b(match|matches|close|similar|like it|like that|like this)\b/;

/** true if `texto` names the piece (its title, or the composer's surname). */
function mentions(texto, pieza) {
  const text = normalizeText(texto);
  const title = normalizeText(pieza.nombre.split('(')[0]).split(' ').filter(Boolean);
  const surname = normalizeText(pieza.autor).split(' ').filter((w) => w.length > 3).pop();
  return text.includes(title.slice(0, 2).join(' ')) || Boolean(surname && text.includes(surname));
}

/**
 * Does the model's answer agree with the verdict? It must name the melody when there is a match (or a resemblance),
 * and must not deny a clear match. When there is no match there is nothing to contradict.
 */
export function answerAgrees(hum, texto) {
  const { tipo, match } = hum.veredicto;
  if (tipo === 'ninguno') return true;
  if (tipo === 'coincide' && DENIAL.test(normalizeText(texto).replace(/['’]/g, ''))) return false;
  return mentions(texto, match.pieza);
}

async function firstPiece(filters) {
  for (const f of filters) {
    const [pieza] = await searchPiezas({ ...f, limit: 1 });
    if (pieza) return pieza;
  }
  return null;
}

/**
 * Answer without a language model (no API key, the model failed, or it contradicted the verdict): what the humming
 * sounds like plus pieces in the hummed key.
 */
export async function humFallbackAnswer(hum) {
  const keys = [hum.tonalidad, hum.relativa].filter(Boolean);
  const inKey = (tipo) => [...keys.map((tonalidad) => ({ tipo, tonalidad, estilo: 'rap' })), ...keys.map((tonalidad) => ({ tipo, tonalidad }))];
  const [acordes, bajo, ritmo] = await Promise.all([
    firstPiece(inKey('acordes')),
    firstPiece(inKey('bajo')),
    firstPiece([{ tipo: 'ritmo', estilo: 'rap' }, { tipo: 'ritmo' }]),
  ]);
  const { tipo, match } = hum.veredicto;
  const accompaniment = [acordes, bajo, ritmo].filter(Boolean);
  const parts = [];
  if (tipo === 'coincide') {
    parts.push(`Nice! That sounds like "${match.pieza.nombre}" by ${match.pieza.autor} (${percent(match.similitud)} match, ${match.pieza.licencia}).`);
  } else if (tipo === 'parecido') {
    parts.push(`That reminds me of "${match.pieza.nombre}" by ${match.pieza.autor} (${percent(match.similitud)} match).`);
  } else {
    parts.push("I don't have that melody in the library yet, so it can be your own idea.");
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
    piezas_sugeridas: [...(match ? [match.pieza.id] : []), ...accompaniment.map((p) => p.id)],
  };
}
