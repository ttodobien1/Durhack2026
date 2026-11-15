// Who made each part of a song: a "git blame" for notes.
//
// A note of a fork belongs to whoever wrote it first: if the parent piece has the same note (same tono and
// inicio), the credit goes up the chain; notes the fork added or moved belong to the fork's author.
// A song credits every note each time it plays, so a beat that loops for the whole song weighs more than a
// two-bar fill.

const keyOf = (nota) => `${nota.tono}@${Math.round(nota.inicio * 1e4)}`;

// Author of each note of piece `id` (same order as its `notas`). `piezas`: Map id -> Pieza with its ancestors.
export function blame(id, piezas, memo = new Map()) {
  if (memo.has(id)) return memo.get(id);
  const pieza = piezas.get(id);
  if (!pieza) return [];
  memo.set(id, pieza.notas.map(() => pieza.autor)); // guard against cycles
  const parent = pieza.parent_id ? piezas.get(pieza.parent_id) : null;
  if (parent) {
    const parentBlame = blame(parent.id, piezas, memo);
    const pool = new Map();
    parent.notas.forEach((nota, i) => {
      const key = keyOf(nota);
      if (!pool.has(key)) pool.set(key, []);
      pool.get(key).push(parentBlame[i]);
    });
    memo.set(id, pieza.notas.map((nota) => pool.get(keyOf(nota))?.shift() ?? pieza.autor));
  }
  return memo.get(id);
}

/**
 * Blame of one piece for the piano roll: every note with its author, and each author's share.
 * `who` is blame(pieza.id, ...) (same order as pieza.notas). Shares are rounded; the largest first.
 */
export function blameSummary(pieza, who) {
  const counts = new Map();
  for (const autor of who) counts.set(autor, (counts.get(autor) ?? 0) + 1);
  const total = who.length;
  const autores = [...counts.entries()]
    .map(([autor, notas]) => ({ autor, notas, porcentaje: total ? Math.round((100 * notas) / total) : 0 }))
    .sort((a, b) => b.notas - a.notas || a.autor.localeCompare(b.autor));
  return { autores, notas: pieza.notas.map((nota, i) => ({ ...nota, autor: who[i] })) };
}

// cancion: Cancion (contract 4.2); piezas: Map with every piece used and all its ancestors;
// versiones: [{ autor, merge_de }] saved versions of the song.
export function computeCredits({ cancion, piezas, versiones = [] }) {
  const memo = new Map();
  const autores = new Map();
  const entry = (autor) => {
    if (!autores.has(autor)) autores.set(autor, { autor, notas: 0, porcentaje: 0, piezas: [], versiones: 0, merges: 0 });
    return autores.get(autor);
  };

  let total = 0;
  const used = new Set();
  for (const pista of cancion.pistas) {
    for (const bloque of pista.bloques) {
      used.add(bloque.pieza_id);
      for (const autor of blame(bloque.pieza_id, piezas, memo)) {
        entry(autor).notas++;
        total++;
      }
    }
  }

  for (const pieza of piezas.values()) {
    const who = blame(pieza.id, piezas, memo);
    entry(pieza.autor).piezas.push({
      id: pieza.id,
      nombre: pieza.nombre,
      tipo: pieza.tipo,
      parent_id: pieza.parent_id,
      // original: made from scratch and used in the song; fork: a version of someone's piece, used in the
      // song; origen: not in the song, but a piece in it descends from it.
      rol: !used.has(pieza.id) ? 'origen' : pieza.parent_id ? 'fork' : 'original',
      notas_propias: who.filter((autor) => autor === pieza.autor).length,
      notas: pieza.notas.length,
    });
  }

  for (const version of versiones) {
    const e = entry(version.autor);
    e.versiones++;
    if (version.merge_de) e.merges++;
  }

  const lista = [...autores.values()]
    .map((e) => ({ ...e, porcentaje: total ? Math.round((e.notas / total) * 1000) / 10 : 0 }))
    .sort((a, b) => b.notas - a.notas || b.piezas.length - a.piezas.length || a.autor.localeCompare(b.autor));

  const enCancion = [...used]
    .map((id) => piezas.get(id))
    .filter(Boolean)
    .map((pieza) => {
      const who = blame(pieza.id, piezas, memo);
      return {
        id: pieza.id,
        nombre: pieza.nombre,
        autor: pieza.autor,
        tipo: pieza.tipo,
        parent_id: pieza.parent_id,
        compases: pieza.compases,
        notas: pieza.notas.map((nota, i) => ({ ...nota, autor: who[i] })),
      };
    });

  return { total_notas: total, autores: lista, piezas: enCancion };
}
