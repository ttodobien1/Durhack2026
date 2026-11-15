import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { fingerprint, huellaVector, nearest, HUELLA_DIMS } from '../src/lib/fingerprint.js';
import { nearestInSql } from '../src/repo/similares.js';

let seed = 11;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const melody = (i) => ({
  id: `m-${i}`, tipo: 'melodia', autor: 'x', publica: true,
  notas: Array.from({ length: 6 + (i % 5) }, (_, k) => ({ tono: 60 + Math.floor(rand() * 14), inicio: Math.floor(rand() * 32) / 4, duracion: 0.25 + Math.floor(rand() * 4) / 4, velocidad: 0.5 + rand() / 2 })),
});
const drums = (i) => ({
  id: `d-${i}`, tipo: 'ritmo', autor: 'x', publica: true,
  notas: Array.from({ length: 8 + (i % 7) }, () => ({ tono: [36, 38, 42, 46, 75][Math.floor(rand() * 5)], inicio: Math.floor(rand() * 32) / 4, duracion: 0.25, velocidad: 0.5 + rand() / 2 })),
});

test('huellaVector pads every fingerprint to 32 numbers without changing distances', () => {
  const a = melody(1);
  const b = melody(2);
  const pad = (p) => JSON.parse(huellaVector(p));
  assert.equal(pad(a).length, HUELLA_DIMS);
  assert.equal(pad(drums(1)).length, HUELLA_DIMS);
  const unpadded = Math.hypot(...fingerprint(a).map((x, i) => x - fingerprint(b)[i]));
  const padded = Math.hypot(...pad(a).map((x, i) => x - pad(b)[i]));
  assert.ok(Math.abs(unpadded - padded) < 1e-5);
});

test('similarity in SQL (pgvector + HNSW in PGlite) returns the same order as the in-memory scan', async () => {
  const pieces = [...Array.from({ length: 40 }, (_, i) => melody(i)), ...Array.from({ length: 30 }, (_, i) => drums(i))];
  const conn = new PGlite({ extensions: { vector } });
  await conn.exec(`CREATE EXTENSION IF NOT EXISTS vector;
    CREATE TABLE piezas (id TEXT PRIMARY KEY, tipo TEXT, publica BOOLEAN, huella vector(32));
    CREATE INDEX ON piezas USING hnsw (huella vector_l2_ops);`);
  for (const p of pieces) await conn.query('INSERT INTO piezas VALUES ($1, $2, $3, $4::vector)', [p.id, p.tipo, p.publica, huellaVector(p)]);
  for (const q of [pieces[0], pieces[7], pieces[45], pieces[60]]) {
    const entries = pieces.filter((p) => p.tipo === q.tipo).map((p) => ({ pieza: { id: p.id }, f: fingerprint(p) }));
    const inMemory = nearest(fingerprint(q), entries, { n: 5, skip: (e) => e.pieza.id === q.id }).map((p) => p.id);
    const inSql = (await nearestInSql(conn, huellaVector(q), q.tipo, q.id, 5)).map((r) => r.id);
    assert.deepEqual(inSql, inMemory, `query ${q.id}`);
  }
  await conn.close();
});
