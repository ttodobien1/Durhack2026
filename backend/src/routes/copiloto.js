import { Router } from 'express';
import { runCopilot } from '../copilot/index.js';
import { badRequest } from '../lib/errors.js';
import { validateNotas } from '../lib/validate.js';

const router = Router();

const MAX_HUM_NOTES = 400;
const MAX_HISTORY = 10;
const MAX_HISTORY_TEXT = 1000;

// Optional humming (transcribed to notes in the browser): { "notas": [...] } in contract 4.1 note format.
function validateTarareo(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) throw badRequest('"tarareo" must be an object with "notas"');
  if (Array.isArray(value.notas) && value.notas.length > MAX_HUM_NOTES) {
    throw badRequest(`"tarareo.notas" can have at most ${MAX_HUM_NOTES} notes`);
  }
  const notas = validateNotas(value.notas);
  if (notas.length < 2) throw badRequest('"tarareo.notas" needs at least 2 notes');
  return { notas };
}

// Optional earlier messages of the chat, oldest first: [{ "de": "usuario" | "stemy", "texto": "..." }].
function validateHistorial(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw badRequest('"historial" must be an array of { de, texto }');
  return value.slice(-MAX_HISTORY).map((item, i) => {
    if (!item || typeof item.texto !== 'string' || !['usuario', 'stemy'].includes(item.de)) {
      throw badRequest(`historial[${i}] must be { "de": "usuario" | "stemy", "texto": "..." }`);
    }
    return { de: item.de, texto: item.texto.slice(0, MAX_HISTORY_TEXT) };
  });
}

// POST /copiloto   body: { "mensaje": "...", "cancion": Cancion | null, "tarareo"?: { notas }, "historial"?: [...] }
// -> { "texto": "...", "piezas_sugeridas": ["p-017", ...] }  (+ "tarareo": { ... } when a humming was sent)
router.post('/', async (req, res) => {
  const { mensaje, cancion = null } = req.body ?? {};
  if (typeof mensaje !== 'string' || !mensaje.trim()) throw badRequest('"mensaje" is required (non-empty string)');
  if (mensaje.length > 2000) throw badRequest('"mensaje" is too long (max 2000 characters)');
  if (cancion !== null && (typeof cancion !== 'object' || Array.isArray(cancion))) {
    throw badRequest('"cancion" must be a Cancion object or null');
  }
  const tarareo = validateTarareo(req.body.tarareo);
  const historial = validateHistorial(req.body.historial);
  res.json(await runCopilot(mensaje.trim(), cancion, { tarareo, historial }));
});

export default router;
