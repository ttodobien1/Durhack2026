// Converts MIDI files into piece JSON files for /data/piezas (then run npm run db:seed).
//
// One file:
//   npm run import:midi -- ruta/archivo.mid --id p-040 --nombre "Clave 2-3" --tipo ritmo --autor "Google Magenta" \
//     --licencia "CC BY 4.0" --fuente "Groove MIDI Dataset" --estilo salsa --desde-compas 8 --compases 4
//
// Many files, described in a manifest (see data/midi/manifest.example.json):
//   npm run import:midi -- --manifest ../data/midi/manifest.json
//
// Options: --tonalidad Am  --tempo 96  --pista 0  --cuantizar 0.25  --parent-id p-001
//          --out <file.json>  --stdout (print instead of writing)
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { midiToPieza } from './lib/midi.js';
import { DATA_DIR } from './lib/paths.js';
import { formatPieza } from './lib/pieceFile.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    manifest: { type: 'string' },
    id: { type: 'string' },
    nombre: { type: 'string' },
    tipo: { type: 'string' },
    autor: { type: 'string' },
    licencia: { type: 'string' },
    fuente: { type: 'string' },
    tonalidad: { type: 'string' },
    estilo: { type: 'string' },
    tempo: { type: 'string' },
    pista: { type: 'string' },
    'desde-compas': { type: 'string' },
    compases: { type: 'string' },
    cuantizar: { type: 'string' },
    'parent-id': { type: 'string' },
    out: { type: 'string' },
    stdout: { type: 'boolean', default: false },
  },
});

const toNumber = (value, name) => {
  if (value === undefined || value === null || value === '') return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`--${name} must be a number`);
  return n;
};

// Normalizes a manifest entry or the CLI flags into midiToPieza() metadata.
function toMeta(entry) {
  return {
    id: entry.id,
    nombre: entry.nombre,
    tipo: entry.tipo,
    autor: entry.autor,
    licencia: entry.licencia,
    fuente: entry.fuente,
    tonalidad: entry.tonalidad,
    estilo: entry.estilo,
    parent_id: entry.parent_id,
    tempo: toNumber(entry.tempo, 'tempo'),
    pista: toNumber(entry.pista, 'pista'),
    desde_compas: toNumber(entry.desde_compas, 'desde-compas'),
    compases: toNumber(entry.compases, 'compases'),
    cuantizar: toNumber(entry.cuantizar, 'cuantizar'),
  };
}

async function importOne(midiPath, entry, outPath) {
  const pieza = midiToPieza(await readFile(midiPath), toMeta(entry));
  if (!pieza.id) throw new Error('an "id" is required (e.g. --id p-040)');
  const json = formatPieza(pieza);
  if (values.stdout) {
    process.stdout.write(json);
    return;
  }
  const target = outPath ?? path.join(DATA_DIR, 'piezas', `${pieza.id}.json`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, json);
  console.log(`${path.basename(midiPath)} -> ${path.relative(process.cwd(), target)} (${pieza.notas.length} notes, ${pieza.compases} bars, ${pieza.tempo} BPM)`);
}

try {
  if (values.manifest) {
    const manifestPath = path.resolve(values.manifest);
    const entries = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (!Array.isArray(entries)) throw new Error('The manifest must be a JSON array');
    for (const entry of entries) {
      if (!entry.archivo) throw new Error(`Manifest entry ${entry.id ?? '?'} has no "archivo"`);
      await importOne(path.resolve(path.dirname(manifestPath), entry.archivo), entry, undefined);
    }
  } else {
    const [midiPath] = positionals;
    if (!midiPath) throw new Error('Usage: npm run import:midi -- <file.mid> --id p-040 --nombre ... --tipo ... --autor ...');
    await importOne(
      path.resolve(midiPath),
      {
        ...values,
        desde_compas: values['desde-compas'],
        parent_id: values['parent-id'],
      },
      values.out ? path.resolve(values.out) : undefined,
    );
  }
} catch (err) {
  console.error(`Import failed: ${err.message}`);
  process.exit(1);
}
