import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { validateCancion, validateNewPieza } from '../../src/lib/validate.js';
import { saveCancion } from '../../src/repo/canciones.js';
import { getPieza, upsertPieza } from '../../src/repo/piezas.js';
import { DATA_DIR } from './paths.js';

// Reads every *.json in a folder. A file may hold one object or an array of objects.
async function readJsonFolder(folder) {
  let files;
  try {
    files = (await readdir(folder)).filter((file) => file.endsWith('.json')).sort();
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  const items = [];
  for (const file of files) {
    const fullPath = path.join(folder, file);
    let parsed;
    try {
      parsed = JSON.parse(await readFile(fullPath, 'utf8'));
    } catch (err) {
      throw new Error(`${fullPath}: invalid JSON (${err.message})`);
    }
    for (const item of Array.isArray(parsed) ? parsed : [parsed]) items.push({ file, item });
  }
  return items;
}

// Orders pieces so that every parent is inserted before its forks.
function parentsFirst(piezas) {
  const byId = new Map(piezas.map((pieza) => [pieza.id, pieza]));
  const ordered = [];
  const visited = new Set();
  const visit = (pieza, chain = new Set()) => {
    if (visited.has(pieza.id)) return;
    if (chain.has(pieza.id)) throw new Error(`Cycle in parent_id chain at ${pieza.id}`);
    chain.add(pieza.id);
    const parent = pieza.parent_id && byId.get(pieza.parent_id);
    if (parent) visit(parent, chain);
    visited.add(pieza.id);
    ordered.push(pieza);
  };
  piezas.forEach((pieza) => visit(pieza));
  return ordered;
}

export async function seedDatabase({ dataDir = DATA_DIR, log = console.log } = {}) {
  // Pieces
  const piezas = [];
  const seen = new Set();
  for (const { file, item } of await readJsonFolder(path.join(dataDir, 'piezas'))) {
    let pieza;
    try {
      pieza = validateNewPieza(item);
    } catch (err) {
      throw new Error(`piezas/${file}: ${err.message}`);
    }
    if (!pieza.id) throw new Error(`piezas/${file}: seed pieces need an "id"`);
    if (seen.has(pieza.id)) throw new Error(`piezas/${file}: duplicated id ${pieza.id}`);
    seen.add(pieza.id);
    piezas.push(pieza);
  }
  for (const pieza of parentsFirst(piezas)) {
    if (pieza.parent_id && !seen.has(pieza.parent_id) && !(await getPieza(pieza.parent_id))) {
      throw new Error(`Pieza ${pieza.id}: parent_id ${pieza.parent_id} does not exist`);
    }
    await upsertPieza(pieza);
  }
  log(`Seeded ${piezas.length} piezas`);

  // Songs
  let songs = 0;
  for (const { file, item } of await readJsonFolder(path.join(dataDir, 'canciones'))) {
    let cancion;
    try {
      cancion = validateCancion(item);
      if (!cancion.id) throw new Error('seed songs need an "id"');
      await saveCancion(cancion.id, cancion);
    } catch (err) {
      throw new Error(`canciones/${file}: ${err.message}`);
    }
    songs++;
  }
  log(`Seeded ${songs} canciones`);
}
