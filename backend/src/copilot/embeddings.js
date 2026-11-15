// Gemini text embeddings for semantic search (plain fetch, no SDK). Vectors are L2-normalized here: at 768
// dimensions the API does not normalize them (checked: norms ~0.59), and pgvector's cosine index expects comparable
// lengths. Pieces are embedded as RETRIEVAL_DOCUMENT, searches as RETRIEVAL_QUERY.
const MODEL = process.env.GEMINI_EMBED_MODEL || 'gemini-embedding-001';
export const EMBED_DIMS = 768;
const BATCH = 100; // texts per batchEmbedContents call

export const normalize = (v) => {
  const n = Math.hypot(...v) || 1;
  return v.map((x) => x / n);
};
export const vectorLiteral = (v) => `[${v.map((x) => +x.toFixed(7)).join(',')}]`;

/** Embeds texts in batches. Throws on any API error (callers decide whether to fall back). */
export async function embedTexts(texts, taskType, { timeoutMs = 30_000 } = {}) {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:batchEmbedContents`;
  const out = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const requests = texts.slice(i, i + BATCH).map((text) => ({ model: `models/${MODEL}`, content: { parts: [{ text }] }, taskType, outputDimensionality: EMBED_DIMS }));
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({ requests }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(`Gemini embeddings ${res.status}: ${data.error?.message ?? 'error'}`);
      err.status = res.status;
      // 429 carries a retry hint ("Please retry in 21.3s" / RetryInfo.retryDelay "21s"); the free tier allows 100 texts a minute.
      const hint = data.error?.details?.find((d) => d.retryDelay)?.retryDelay ?? /retry in ([\d.]+)s/.exec(data.error?.message ?? '')?.[1];
      err.retryAfter = hint ? Number.parseFloat(hint) : null;
      throw err;
    }
    for (const e of data.embeddings ?? []) out.push(normalize(e.values));
  }
  if (out.length !== texts.length) throw new Error('Gemini returned fewer embeddings than texts');
  return out;
}

// Searches repeat (typing, the copilot): keep the last query vectors for this server instance.
const queryCache = new Map();
/** One search query as a normalized vector; cached. */
export async function embedQuery(text, { timeoutMs = 1500 } = {}) {
  const key = text.trim().toLowerCase();
  if (queryCache.has(key)) return queryCache.get(key);
  const [v] = await embedTexts([key], 'RETRIEVAL_QUERY', { timeoutMs });
  if (queryCache.size > 200) queryCache.delete(queryCache.keys().next().value);
  queryCache.set(key, v);
  return v;
}
