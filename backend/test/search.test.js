import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describePiece } from '../src/lib/describePiece.js';
import { hybridSearch, rrf } from '../src/lib/hybrid.js';
import { embedQuery, normalize } from '../src/copilot/embeddings.js';

const n = (tono, inicio, duracion = 0.5) => ({ tono, inicio, duracion, velocidad: 0.8 });

test('describePiece gives stable text with musical traits for a fixture', () => {
  const pieza = {
    nombre: 'Rainy keys',
    tipo: 'acordes',
    tempo: 72,
    tonalidad: 'Am',
    estilo: ['rap', 'lofi'],
    compases: 2,
    notas: [n(57, 0, 2), n(60, 0, 2), n(64, 0, 2), n(53, 4, 2), n(57, 4, 2), n(60, 4, 2)],
  };
  assert.equal(describePiece(pieza), 'Rainy keys · chords · 72 BPM, slow · A minor, darker mood · styles: rap, lofi · sparse, mid register, straight, on the beat');
  const beat = { nombre: 'Busy hats', tipo: 'ritmo', tempo: 90, tonalidad: null, estilo: [], compases: 1, notas: [36, 38, 36, 38].map((t, i) => n(t, i)).concat(Array.from({ length: 8 }, (_, i) => n(42, i / 2))) };
  assert.match(describePiece(beat), /busy, sparse kick, busy hi-hats, backbeat snare, eighth-note groove/); // 2 kicks a bar is "sparse"
});

test('reciprocal rank fusion puts what both lists rank first on top', () => {
  assert.deepEqual(rrf([['a', 'b', 'c'], ['a', 'c', 'd']]), ['a', 'c', 'b', 'd']);
  assert.deepEqual(rrf([['x'], []]), ['x']);
});

test('hybrid search merges semantic hits and loads the missing pieces', async () => {
  const keyword = [{ id: 'p-1' }, { id: 'p-2' }];
  const out = await hybridSearch({
    keyword,
    embed: async () => [1, 0],
    semantic: async () => ['p-2', 'p-9'],
    load: async (ids) => ids.map((id) => ({ id, loaded: true })),
  });
  assert.deepEqual(out.map((p) => p.id), ['p-2', 'p-1', 'p-9']);
  assert.equal(out[2].loaded, true);
});

test('the search falls back to keyword results when the embedding call throws (mocked fetch)', async () => {
  const realFetch = globalThis.fetch;
  const realKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'test-key';
  globalThis.fetch = async () => {
    throw new Error('network down');
  };
  try {
    const keyword = [{ id: 'p-1' }, { id: 'p-2' }];
    let called = false;
    const errors = [];
    const out = await hybridSearch({
      keyword,
      embed: () => embedQuery('dark rainy night, slow (test)'),
      semantic: async () => {
        called = true;
        return [];
      },
      load: async () => [],
      onError: (e) => errors.push(e.message),
    });
    assert.deepEqual(out, keyword);
    assert.equal(called, false);
    assert.match(errors[0], /network down/);
    // A slow embedding counts as a failure too.
    const slow = await hybridSearch({ keyword, embed: () => new Promise((r) => setTimeout(() => r([1]), 200)), semantic: async () => ['p-9'], load: async () => [], timeoutMs: 20 });
    assert.deepEqual(slow, keyword);
  } finally {
    globalThis.fetch = realFetch;
    if (realKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = realKey;
  }
});

test('embedding vectors are L2-normalized', () => {
  const v = normalize([3, 4]);
  assert.ok(Math.abs(Math.hypot(...v) - 1) < 1e-12);
});
