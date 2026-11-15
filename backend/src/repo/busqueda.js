// Library search (GET /piezas and the copilot's buscar_piezas): keyword matches as before, plus Gemini semantic
// matches over the embeddings of public pieces, merged by reciprocal rank fusion.
// Same contract ([Pieza, ...]); only the order (and semantic extras) change. Keyword-only on any failure.
import { db } from '../db/client.js';
import { features } from '../db/features.js';
import { hybridSearch } from '../lib/hybrid.js';
import { normalizeKey, splitTags } from '../lib/normalize.js';
import { embedQuery, vectorLiteral } from '../copilot/embeddings.js';
import { getPiezasByIds, searchPiezas } from './piezas.js';

const SEMANTIC_TOP = 50;
let pausedUntil = 0; // after a Gemini 429, skip semantic search for the suggested wait instead of hammering it

async function semanticIds(vec, { tipo, tonalidad, estilo, autor }) {
  const args = [vectorLiteral(vec)];
  const where = ['embedding IS NOT NULL', 'publica'];
  const param = (value) => {
    args.push(value);
    return '$' + args.length;
  };
  if (tipo) where.push('tipo = ' + param(tipo));
  if (tonalidad) where.push('tonalidad = ' + param(normalizeKey(tonalidad)));
  const tags = splitTags(estilo);
  if (tags.length) where.push('estilo @> ' + param(JSON.stringify(tags)) + '::jsonb');
  if (autor) where.push('lower(autor) = lower(' + param(String(autor).trim()) + ')');
  const sql = `SELECT id FROM piezas WHERE ${where.join(' AND ')} ORDER BY embedding <=> $1::vector LIMIT ${SEMANTIC_TOP}`;
  const { rows } = await db.query(sql, args);
  return rows.map((r) => r.id);
}

/** Same filters as searchPiezas; `limit` applies after the merge. */
export async function searchHybrid(filters = {}) {
  const { limit, ...rest } = filters;
  const keyword = await searchPiezas(rest);
  const q = typeof rest.q === 'string' ? rest.q.trim() : '';
  const usable = q.length >= 3 && features.vectores && process.env.GEMINI_API_KEY && Date.now() >= pausedUntil;
  const ranked = !usable
    ? keyword
    : await hybridSearch({
        keyword,
        embed: () => embedQuery(q),
        semantic: (vec) => semanticIds(vec, rest),
        load: async (ids) => (await getPiezasByIds(ids)).filter((p) => p.publica !== false),
        onError: (err) => {
          if (err.status === 429) pausedUntil = Date.now() + (err.retryAfter ?? 30) * 1000;
          console.warn(`semantic search skipped: ${err.message}`);
        },
      });
  return limit ? ranked.slice(0, limit) : ranked;
}
