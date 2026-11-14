import { db } from '../db/client.js';

// Next sequential id for a table: "p-017" -> "p-018". Ids are zero-padded to 3 digits.
// `table` and `prefix` are constants from our code, never user input.
async function nextId(table, prefix) {
  const result = await db.query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(id FROM ${prefix.length + 2}) AS INTEGER)), 0) AS n
     FROM ${table} WHERE id ~ $1`,
    [`^${prefix}-[0-9]+$`],
  );
  const n = Number(result.rows[0].n) + 1;
  return `${prefix}-${String(n).padStart(3, '0')}`;
}

// Postgres unique_violation
const isDuplicateKey = (err) => err?.code === '23505' || /duplicate key/i.test(String(err?.message));

// Runs `insert(id)` with a fresh id. If two requests grab the same id at the same time,
// the loser gets a duplicate-key error and simply retries with the next one.
export async function insertWithNewId(table, prefix, insert) {
  const attempts = 5;
  for (let attempt = 1; ; attempt++) {
    const id = await nextId(table, prefix);
    try {
      await insert(id);
      return id;
    } catch (err) {
      if (!isDuplicateKey(err) || attempt >= attempts) throw err;
    }
  }
}
