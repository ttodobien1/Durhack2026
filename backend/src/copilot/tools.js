// The copilot's two tools (CLAUDE.md 4.4): buscar_piezas and describir_estilo.
import { normalizeText } from '../lib/normalize.js';
import { TIPOS } from '../lib/validate.js';
import { searchPiezas } from '../repo/piezas.js';
import { STYLES } from './styles.js';

const MAX_RESULTS = 15;

export const TOOL_DEFINITIONS = [
  {
    name: 'buscar_piezas',
    description:
      'Search the Stemma library for existing MIDI pieces. All filters are optional and are combined with AND. ' +
      'Returns real pieces: id, nombre, tipo, autor, licencia, fuente, tonalidad, tempo, estilo, compases, ' +
      'parent_id (the piece it was forked from, or null) and the number of notes. ' +
      `At most ${MAX_RESULTS} results. If nothing comes back, retry with fewer filters (drop tonalidad or texto first).`,
    input_schema: {
      type: 'object',
      properties: {
        estilo: {
          type: 'string',
          description: 'Style tags, e.g. "salsa" or "salsa romantica". Every tag given must be present on the piece.',
        },
        tipo: {
          type: 'string',
          enum: TIPOS,
          description: 'Role of the piece: ritmo (percussion), acordes (chords / piano montuno), melodia or bajo (bass).',
        },
        tonalidad: {
          type: 'string',
          description: 'Key in short notation, e.g. "Am", "C", "F#m". Percussion pieces usually have no key.',
        },
        texto: {
          type: 'string',
          description: 'Free text matched against name, author, source and tags, e.g. "montuno", "tumbao", "clave".',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'describir_estilo',
    description:
      'Returns general musical traits of a style: tempo, meter, clave, instrumentation, typical patterns per ' +
      'instrument, harmony and song structure. Use it to turn a request (including "sound like <artist>") into ' +
      'concrete traits to search for. It never describes specific artists or songs.',
    input_schema: {
      type: 'object',
      properties: {
        nombre: {
          type: 'string',
          description: 'Style name, e.g. "salsa romantica", "salsa", "son cubano", "bolero", "cha cha cha".',
        },
      },
      required: ['nombre'],
      additionalProperties: false,
    },
  },
];

const optionalString = (value) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

async function buscarPiezas(input) {
  const tipo = optionalString(input.tipo);
  if (tipo && !TIPOS.includes(normalizeText(tipo))) {
    return { error: `Unknown tipo "${tipo}". Valid values: ${TIPOS.join(', ')}` };
  }
  const piezas = await searchPiezas({
    estilo: optionalString(input.estilo),
    tipo,
    tonalidad: optionalString(input.tonalidad),
    q: optionalString(input.texto),
    limit: MAX_RESULTS,
  });
  return {
    total: piezas.length,
    piezas: piezas.map(({ notas, ...pieza }) => ({ ...pieza, numero_de_notas: notas.length })),
  };
}

function describirEstilo(input) {
  const query = normalizeText(input.nombre).replace(/-/g, ' ');
  const entries = Object.entries(STYLES);
  const match =
    entries.find(([key, style]) => key === query || style.alias.includes(query)) ??
    entries.find(([key, style]) => [key, ...style.alias].some((name) => query.includes(name))) ??
    entries.find(([key]) => key.includes(query));

  if (!match) {
    return {
      encontrado: false,
      mensaje: `No stored traits for "${input.nombre}". Describe it from general musical knowledge (no artist imitation).`,
      estilos_disponibles: entries.map(([, style]) => style.nombre),
    };
  }
  const { alias, ...traits } = match[1];
  return { encontrado: true, ...traits };
}

// Executes a tool call and returns a JSON-serializable result.
export async function runTool(name, input = {}) {
  switch (name) {
    case 'buscar_piezas':
      return buscarPiezas(input);
    case 'describir_estilo':
      return describirEstilo(input);
    default:
      return { error: `Unknown tool: ${name}` };
  }
}
