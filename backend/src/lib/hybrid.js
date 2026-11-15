// Hybrid search: keyword hits and semantic (embedding) hits merged by reciprocal rank fusion. Pure orchestration;
// the database and Gemini calls are passed in, so it is testable and every failure falls back to keyword results.

/** Reciprocal rank fusion: score(id) = Σ 1 / (k + rank), rank from 1. Ties keep first-seen order. */
export function rrf(lists, k = 60) {
  const score = new Map();
  for (const list of lists) list.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + 1 / (k + i + 1)));
  return [...score.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

const withTimeout = (promise, ms) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error(`timed out after ${ms} ms`)), ms))]);

/**
 * keyword: the keyword results (objects with id), in their usual order.
 * embed(): the query vector. semantic(vec): ids ranked by embedding distance (same filters). load(ids): full objects.
 * Returns keyword results unchanged when any step fails or takes longer than timeoutMs: the search box never breaks.
 */
export async function hybridSearch({ keyword, embed, semantic, load, timeoutMs = 1500, onError = () => {} }) {
  try {
    const vec = await withTimeout(embed(), timeoutMs);
    const semanticIds = await semantic(vec);
    if (!semanticIds.length) return keyword;
    const byId = new Map(keyword.map((p) => [p.id, p]));
    const missing = semanticIds.filter((id) => !byId.has(id));
    for (const p of missing.length ? await load(missing) : []) byId.set(p.id, p);
    return rrf([keyword.map((p) => p.id), semanticIds]).filter((id) => byId.has(id)).map((id) => byId.get(id));
  } catch (err) {
    onError(err);
    return keyword;
  }
}
