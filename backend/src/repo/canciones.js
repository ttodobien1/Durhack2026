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
  const filter = id ? 'WHERE cancion_id = ?' : '';
  const args = id ? [id] : [];
  const [canciones, pistas, bloques] = await Promise.all([
    db.execute({ sql: `SELECT id, nombre, autor, tempo FROM canciones ${id ? 'WHERE id = ?' : ''} ORDER BY id`, args }),
    db.execute({ sql: `SELECT cancion_id, posicion, instrumento FROM pistas ${filter} ORDER BY cancion_id, posicion`, args }),
    db.execute({
      sql: `SELECT cancion_id, pista_posicion, pieza_id, compas FROM bloques ${filter}
            ORDER BY cancion_id, pista_posicion, compas, id`,
      args,
    }),
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

export async function cancionExists(id) {
  const result = await db.execute({ sql: 'SELECT 1 FROM canciones WHERE id = ?', args: [id] });
  return result.rows.length > 0;
}

async function assertPiezasExist(cancion) {
  const ids = cancion.pistas.flatMap((pista) => pista.bloques.map((bloque) => bloque.pieza_id));
  const found = await existingPiezaIds(ids);
  const missing = [...new Set(ids.filter((id) => !found.has(id)))];
  if (missing.length) throw badRequest(`Unknown pieza_id: ${missing.join(', ')}`);
}

// Statements that (re)write the tracks and blocks of a song.
function trackStatements(id, cancion) {
  const statements = [
    { sql: 'DELETE FROM bloques WHERE cancion_id = ?', args: [id] },
    { sql: 'DELETE FROM pistas WHERE cancion_id = ?', args: [id] },
  ];
  cancion.pistas.forEach((pista, posicion) => {
    statements.push({
      sql: 'INSERT INTO pistas (cancion_id, posicion, instrumento) VALUES (?, ?, ?)',
      args: [id, posicion, pista.instrumento],
    });
    for (const bloque of pista.bloques) {
      statements.push({
        sql: 'INSERT INTO bloques (cancion_id, pista_posicion, pieza_id, compas) VALUES (?, ?, ?, ?)',
        args: [id, posicion, bloque.pieza_id, bloque.compas],
      });
    }
  });
  return statements;
}

// Creates a song with a new sequential id. Returns the stored Cancion.
export async function createCancion(cancion) {
  await assertPiezasExist(cancion);
  const id = await insertWithNewId('canciones', 'c', (newId) =>
    db.batch(
      [
        {
          sql: 'INSERT INTO canciones (id, nombre, autor, tempo) VALUES (?, ?, ?, ?)',
          args: [newId, cancion.nombre, cancion.autor, cancion.tempo],
        },
        ...trackStatements(newId, cancion),
      ],
      'write',
    ),
  );
  return getCancion(id);
}

// Inserts or fully replaces a song keeping its id (PUT and seed). Returns the stored Cancion.
export async function saveCancion(id, cancion) {
  await assertPiezasExist(cancion);
  await db.batch(
    [
      {
        sql: `INSERT INTO canciones (id, nombre, autor, tempo) VALUES (?, ?, ?, ?)
              ON CONFLICT(id) DO UPDATE SET nombre = excluded.nombre, autor = excluded.autor,
                tempo = excluded.tempo, updated_at = datetime('now')`,
        args: [id, cancion.nombre, cancion.autor, cancion.tempo],
      },
      ...trackStatements(id, cancion),
    ],
    'write',
  );
  return getCancion(id);
}

// Lineage tree: every piece used in the song plus its full chain of parents.
// Edges go from parent (desde) to fork (hacia).
export async function getArbol(cancionId) {
  const [cancionResult, nodesResult] = await Promise.all([
    db.execute({ sql: 'SELECT id, nombre, autor FROM canciones WHERE id = ?', args: [cancionId] }),
    db.execute({
      sql: `WITH RECURSIVE
              usadas(id) AS (SELECT DISTINCT pieza_id FROM bloques WHERE cancion_id = ?),
              linaje(id) AS (
                SELECT id FROM usadas
                UNION
                SELECT p.parent_id FROM piezas p JOIN linaje l ON p.id = l.id WHERE p.parent_id IS NOT NULL
              )
            SELECT p.id, p.nombre, p.autor, p.tipo, p.licencia, p.fuente, p.parent_id,
                   EXISTS (SELECT 1 FROM usadas u WHERE u.id = p.id) AS en_cancion
            FROM piezas p JOIN linaje l ON p.id = l.id
            ORDER BY p.id`,
      args: [cancionId],
    }),
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
