import { Router } from 'express';
import { runCopilot } from '../copilot/index.js';
import { badRequest } from '../lib/errors.js';

const router = Router();

// POST /copiloto   body: { "mensaje": "...", "cancion": Cancion | null }
// -> { "texto": "...", "piezas_sugeridas": ["p-017", ...] }
router.post('/', async (req, res) => {
  const { mensaje, cancion = null } = req.body ?? {};
  if (typeof mensaje !== 'string' || !mensaje.trim()) throw badRequest('"mensaje" is required (non-empty string)');
  if (mensaje.length > 2000) throw badRequest('"mensaje" is too long (max 2000 characters)');
  if (cancion !== null && (typeof cancion !== 'object' || Array.isArray(cancion))) {
    throw badRequest('"cancion" must be a Cancion object or null');
  }
  res.json(await runCopilot(mensaje.trim(), cancion));
});

export default router;
