import { db } from '../db/client.js';
import { badRequest } from '../lib/errors.js';
import { insertWithNewId } from '../lib/ids.js';
import { existingPiezaIds } from './piezas.js';

// Builds Cancion objects (contract 4.2) from the three tables.
function assemble(cancionRows, pistaRows, bloqueRows) {
  const canciones = new Map();
  for (const row of cancionRows) {
    canciones.set(row.id, {
      id: row.id,
      nombre: row.nombre,
      autor: row.autor,
      tempo: Number(row.tempo),
      pistas: [],
    });
  }
  const pistas = new Map();
  for (const row of pistaRows) {
    const pista = { instrumento: row.instrumento, bloques: [] };
    pistas.set(`${row.cancion_id}#${row.posicion}`, pista);
    canciones.get(row.cancion_id)?.pistas.push(pista);
  }
  for (const row of bloqueRows) {
    pistas.get(`${row.cancion_id}#${row.pista_posicion}`)?.bloques.push({
      pieza_id: row.pieza_id,
      compas: Number(row.compas),
    });
  }
  return [...canciones.values()];
}

async function loadCanciones(id) {
  const filter = id ? 'WHERE cancion_id = $1' : '';
  const args = id ? [id] : [];
  const [canciones, pistas, bloques] = await Promise.all([
    db.query(`SELECT id, nombre, autor, tempo FROM canciones ${id ? 'WHERE id = $1' : ''} ORDER BY id`, args),
    db.query(`SELECT cancion_id, posicion, instrumento FROM pistas ${filter} ORDER BY cancion_id, posicion`, args),
    db.query(
      `SELECT cancion_id, pista_posicion, pieza_id, compas FROM bloques ${filter}
       ORDER BY cancion_id, pista_posicion, compas, id`,
      args,
    ),
  ]);
  return assemble(canciones.rows, pistas.rows, bloques.rows);
}

export async function listCanciones() {
  return loadCanciones();
}

export async function getCancion(id) {
  const [cancion] = await loadCanciones(id);
  return cancion ?? null;
}

// Owner of a song: { usuario_id (null when unowned), autor }, or null if the song does not exist.
export async function getCancionOwner(id) {
  const result = await db.query('SELECT usuario_id, autor FROM canciones WHERE id = $1', [id]);
  return result.rows[0] ?? null;
}

async function assertPiezasExist(cancion) {
  const ids = cancion.pistas.flatMap((pista) => pista.bloques.map((bloque) => bloque.pieza_id));
  const found = await existingPiezaIds(ids);
  const missing = [...new Set(ids.filter((id) => !found.has(id)))];
  if (missing.length) throw badRequest(`Unknown pieza_id: ${missing.join(', ')}`);
}

// (Re)writes the tracks and blocks of a song inside a transaction.
async function writeTracks(tx, id, cancion) {
  await tx.query('DELETE FROM bloques WHERE cancion_id = $1', [id]);
  await tx.query('DELETE FROM pistas WHERE cancion_id = $1', [id]);
  for (const [posicion, pista] of cancion.pistas.entries()) {
    await tx.query('INSERT INTO pistas (cancion_id, posicion, instrumento) VALUES ($1, $2, $3)', [
      id,
      posicion,
      pista.instrumento,
    ]);
    for (const bloque of pista.bloques) {
      await tx.query('INSERT INTO bloques (cancion_id, pista_posicion, pieza_id, compas) VALUES ($1, $2, $3, $4)', [
        id,
        posicion,
        bloque.pieza_id,
        bloque.compas,
      ]);
    }
  }
}

// Creates a song with a new sequential id, owned by `usuarioId` (null = anonymous). Returns the stored Cancion.
export async function createCancion(cancion, usuarioId = null) {
  await assertPiezasExist(cancion);
  const id = await insertWithNewId('canciones', 'c', (newId) =>
    db.transaction(async (tx) => {
      await tx.query('INSERT INTO canciones (id, nombre, autor, tempo, usuario_id) VALUES ($1, $2, $3, $4, $5)', [
        newId,
        cancion.nombre,
        cancion.autor,
        cancion.tempo,
        usuarioId,
      ]);
      await writeTracks(tx, newId, cancion);
    }),
  );
  return getCancion(id);
}

// Inserts or fully replaces a song keeping its id (PUT and seed). Returns the stored Cancion.
export async function saveCancion(id, cancion) {
  await assertPiezasExist(cancion);
  await db.transaction(async (tx) => {
    await tx.query(
      `INSERT INTO canciones (id, nombre, autor, tempo) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre, autor = EXCLUDED.autor,
         tempo = EXCLUDED.tempo, updated_at = now()`,
      [id, cancion.nombre, cancion.autor, cancion.tempo],
    );
    await writeTracks(tx, id, cancion);
  });
  return getCancion(id);
}

// Lineage tree: every piece used in the song plus its full chain of parents.
// Edges go from parent (desde) to fork (hacia).
export async function getArbol(cancionId) {
  const [cancionResult, nodesResult] = await Promise.all([
    db.query('SELECT id, nombre, autor FROM canciones WHERE id = $1', [cancionId]),
    db.query(
      `WITH RECURSIVE
         usadas(id) AS (SELECT DISTINCT pieza_id FROM bloques WHERE cancion_id = $1),
         linaje(id) AS (
           SELECT id FROM usadas
           UNION
           SELECT p.parent_id FROM piezas p JOIN linaje l ON p.id = l.id WHERE p.parent_id IS NOT NULL
         )
       SELECT p.id, p.nombre, p.autor, p.tipo, p.licencia, p.fuente, p.parent_id,
              EXISTS (SELECT 1 FROM usadas u WHERE u.id = p.id) AS en_cancion
       FROM piezas p JOIN linaje l ON p.id = l.id
       ORDER BY p.id`,
      [cancionId],
    ),
  ]);
  if (cancionResult.rows.length === 0) return null;

  const rows = nodesResult.rows;
  const ids = new Set(rows.map((row) => row.id));
  const nodos = rows.map((row) => ({
    id: row.id,
    nombre: row.nombre,
    autor: row.autor,
    tipo: row.tipo,
    licencia: row.licencia,
    fuente: row.fuente,
    en_cancion: Boolean(row.en_cancion),
  }));
  const aristas = rows
    .filter((row) => row.parent_id && ids.has(row.parent_id))
    .map((row) => ({ desde: row.parent_id, hacia: row.id }));

  const cancion = cancionResult.rows[0];
  return {
    cancion: { id: cancion.id, nombre: cancion.nombre, autor: cancion.autor },
    nodos,
    aristas,
    // "This song has N pieces by M authors" (authors of the whole tree, origins included).
    resumen: {
      piezas: nodos.filter((nodo) => nodo.en_cancion).length,
      autores: [...new Set(nodos.map((nodo) => nodo.autor))],
    },
  };
}
