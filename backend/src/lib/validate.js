import { badRequest } from './errors.js';
import { normalizeKey, normalizeText, splitTags } from './normalize.js';

export const TIPOS = ['ritmo', 'acordes', 'melodia', 'bajo'];
const MAX_NOTAS = 4000;

const round = (n, decimals = 4) => Math.round(n * 10 ** decimals) / 10 ** decimals;
const isNumber = (n) => typeof n === 'number' && Number.isFinite(n);

function requiredString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw badRequest(`"${field}" is required (non-empty string)`);
  return value.trim();
}

function optionalString(value, field, fallback = '') {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') throw badRequest(`"${field}" must be a string`);
  return value.trim();
}

export function validateTipo(value) {
  const tipo = normalizeText(value);
  if (!TIPOS.includes(tipo)) throw badRequest(`"tipo" must be one of: ${TIPOS.join(', ')}`);
  return tipo;
}

function validateTempo(value, fallback = 96) {
  if (value === undefined || value === null) return fallback;
  if (!isNumber(value) || value < 20 || value > 400) throw badRequest('"tempo" must be a number between 20 and 400');
  return value;
}

function validateCompases(value, fallback = 4) {
  if (value === undefined || value === null) return fallback;
  if (!Number.isInteger(value) || value < 1 || value > 256) throw badRequest('"compases" must be an integer between 1 and 256');
  return value;
}

// Notes: { tono: 0-127, inicio: beats >= 0, duracion: beats > 0, velocidad: 0-1 }.
// Returns a clean copy (only contract fields), sorted by inicio then tono.
export function validateNotas(notas) {
  if (!Array.isArray(notas)) throw badRequest('"notas" must be an array');
  if (notas.length > MAX_NOTAS) throw badRequest(`"notas" can have at most ${MAX_NOTAS} notes`);

  return notas
    .map((nota, i) => {
      const where = `notas[${i}]`;
      if (!nota || typeof nota !== 'object') throw badRequest(`${where} must be an object`);
      const { tono, inicio, duracion } = nota;
      const velocidad = nota.velocidad ?? 0.8;
      if (!Number.isInteger(tono) || tono < 0 || tono > 127) throw badRequest(`${where}.tono must be an integer 0-127`);
      if (!isNumber(inicio) || inicio < 0) throw badRequest(`${where}.inicio must be a number >= 0 (beats)`);
      if (!isNumber(duracion) || duracion <= 0) throw badRequest(`${where}.duracion must be a number > 0 (beats)`);
      if (!isNumber(velocidad) || velocidad < 0 || velocidad > 1) throw badRequest(`${where}.velocidad must be a number 0-1`);
      return { tono, inicio: round(inicio), duracion: round(duracion), velocidad: round(velocidad, 3) };
    })
    .sort((a, b) => a.inicio - b.inicio || a.tono - b.tono);
}

function validateEstilo(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) && typeof value !== 'string') throw badRequest('"estilo" must be an array of strings');
  return [...new Set(splitTags(value))];
}

// Full piece (POST /piezas, seed data). `id` and `parent_id` are passed through when present.
export function validateNewPieza(body) {
  if (!body || typeof body !== 'object') throw badRequest('Body must be a JSON object');
  return {
    id: body.id === undefined || body.id === null ? undefined : requiredString(body.id, 'id'),
    nombre: requiredString(body.nombre, 'nombre'),
    tipo: validateTipo(body.tipo),
    autor: requiredString(body.autor, 'autor'),
    licencia: optionalString(body.licencia, 'licencia', 'CC BY 4.0') || 'CC BY 4.0',
    fuente: optionalString(body.fuente, 'fuente'),
    tonalidad: normalizeKey(optionalString(body.tonalidad, 'tonalidad', null)),
    tempo: validateTempo(body.tempo),
    estilo: validateEstilo(body.estilo),
    compases: validateCompases(body.compases),
    parent_id: body.parent_id === undefined || body.parent_id === null ? null : requiredString(body.parent_id, 'parent_id'),
    notas: validateNotas(body.notas ?? []),
  };
}

// Partial update (PUT /piezas/:id). Lineage fields (autor, tipo, licencia, parent_id) are not editable.
export function validatePiezaUpdate(body) {
  if (!body || typeof body !== 'object') throw badRequest('Body must be a JSON object');
  const changes = {};
  if (body.notas !== undefined) changes.notas = validateNotas(body.notas);
  if (body.nombre !== undefined) changes.nombre = requiredString(body.nombre, 'nombre');
  if (body.tonalidad !== undefined) changes.tonalidad = normalizeKey(optionalString(body.tonalidad, 'tonalidad', null));
  if (body.tempo !== undefined) changes.tempo = validateTempo(body.tempo);
  if (body.estilo !== undefined) changes.estilo = validateEstilo(body.estilo);
  if (body.compases !== undefined) changes.compases = validateCompases(body.compases);
  if (Object.keys(changes).length === 0) {
    throw badRequest('Nothing to update: send "notas" (and optionally nombre, tonalidad, tempo, estilo, compases)');
  }
  return changes;
}

// Optional song description. null = not sent (a PUT keeps the stored one); "" clears it.
const MAX_DESCRIPCION = 300;
function validateDescripcion(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw badRequest('"descripcion" must be a string');
  const text = value.trim();
  if (text.length > MAX_DESCRIPCION) throw badRequest(`"descripcion" must be at most ${MAX_DESCRIPCION} characters`);
  return text;
}

// Optional song visibility: public unless the client sends false.
function validatePublica(value) {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'boolean') throw badRequest('"publica" must be true or false');
  return value;
}

// --- Accounts ---------------------------------------------------------------------------------------

export const NOMBRE_USUARIO = /^[\w-]{2,24}$/; // same rule as the frontend sign-up form
const RESERVED_NOMBRES = ['you', 'yours', 'anonymous'];

export function validateRegistro(body) {
  if (!body || typeof body !== 'object') throw badRequest('Body must be a JSON object');
  const nombre = typeof body.nombre === 'string' ? body.nombre.trim() : '';
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const { password } = body;
  if (!NOMBRE_USUARIO.test(nombre)) throw badRequest('"nombre": use 2-24 letters, numbers, dashes or underscores');
  if (RESERVED_NOMBRES.includes(nombre.toLowerCase())) throw badRequest(`"nombre": "${nombre}" is reserved`);
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest('"email" is not a valid email address');
  if (typeof password !== 'string' || password.length < 6 || password.length > 200) {
    throw badRequest('"password" must be 6-200 characters');
  }
  return { nombre, email, password };
}

export function validateLogin(body) {
  if (!body || typeof body !== 'object') throw badRequest('Body must be a JSON object');
  const usuario = typeof body.usuario === 'string' ? body.usuario.trim() : '';
  if (!usuario) throw badRequest('"usuario" (username or email) is required');
  if (typeof body.password !== 'string' || !body.password) throw badRequest('"password" is required');
  return { usuario, password: body.password };
}

// Public profile edited in the frontend settings page. Only known fields are kept.
const PERFIL_TEXTS = { displayName: 60, bio: 300, location: 60, website: 200, readme: 20000, accent: 20 };
const MAX_AVATAR = 300_000; // characters of a data: URL (the frontend sends a 256x256 JPEG, ~30 KB)

export function validatePerfil(body) {
  const perfil = body?.perfil;
  if (!perfil || typeof perfil !== 'object' || Array.isArray(perfil)) throw badRequest('"perfil" must be an object');
  const clean = {};
  for (const [key, max] of Object.entries(PERFIL_TEXTS)) {
    if (perfil[key] === undefined || perfil[key] === null) continue;
    if (typeof perfil[key] !== 'string' || perfil[key].length > max) throw badRequest(`"perfil.${key}" must be text up to ${max} characters`);
    clean[key] = perfil[key];
  }
  if (perfil.avatar !== undefined && perfil.avatar !== null) {
    if (typeof perfil.avatar !== 'string' || !perfil.avatar.startsWith('data:image/') || perfil.avatar.length > MAX_AVATAR) {
      throw badRequest('"perfil.avatar" must be an image data URL under 300 KB');
    }
  }
  clean.avatar = perfil.avatar ?? null;
  if (perfil.pinned !== undefined && perfil.pinned !== null) {
    if (!Array.isArray(perfil.pinned) || perfil.pinned.length > 12 || perfil.pinned.some((id) => typeof id !== 'string' || id.length > 40)) {
      throw badRequest('"perfil.pinned" must be a list of up to 12 ids');
    }
    clean.pinned = perfil.pinned;
  }
  return clean;
}

// Song (POST/PUT /canciones). Checking that pieza_id values exist is done by the repository.
export function validateCancion(body) {
  if (!body || typeof body !== 'object') throw badRequest('Body must be a JSON object');
  const pistas = body.pistas ?? [];
  if (!Array.isArray(pistas)) throw badRequest('"pistas" must be an array');

  return {
    id: body.id === undefined || body.id === null ? undefined : requiredString(body.id, 'id'),
    nombre: requiredString(body.nombre, 'nombre'),
    autor: requiredString(body.autor, 'autor'),
    tempo: validateTempo(body.tempo),
    publica: validatePublica(body.publica),
    descripcion: validateDescripcion(body.descripcion),
    pistas: pistas.map((pista, i) => {
      if (!pista || typeof pista !== 'object') throw badRequest(`pistas[${i}] must be an object`);
      const bloques = pista.bloques ?? [];
      if (!Array.isArray(bloques)) throw badRequest(`pistas[${i}].bloques must be an array`);
      return {
        instrumento: requiredString(pista.instrumento, `pistas[${i}].instrumento`),
        bloques: bloques.map((bloque, j) => {
          const where = `pistas[${i}].bloques[${j}]`;
          if (!bloque || typeof bloque !== 'object') throw badRequest(`${where} must be an object`);
          if (!Number.isInteger(bloque.compas) || bloque.compas < 0) throw badRequest(`${where}.compas must be an integer >= 0`);
          return { pieza_id: requiredString(bloque.pieza_id, `${where}.pieza_id`), compas: bloque.compas };
        }),
      };
    }),
  };
}
