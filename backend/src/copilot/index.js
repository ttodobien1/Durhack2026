// Copilot: Claude with tool use. It searches and explains existing pieces; it never composes.
import Anthropic from '@anthropic-ai/sdk';
import { HttpError } from '../lib/errors.js';
import { existingPiezaIds, getPiezasByIds } from '../repo/piezas.js';
import { SYSTEM_PROMPT } from './systemPrompt.js';
import { TOOL_DEFINITIONS, runTool } from './tools.js';
import { askGemini } from './gemini.js';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
const MAX_ROUNDS = 6; // model calls per request (each tool round is one call)
const MAX_SUGGESTIONS = 5;

// Final answer format, enforced with structured outputs.
const RESPONSE_FORMAT = {
  type: 'json_schema',
  schema: {
    type: 'object',
    properties: {
      texto: { type: 'string', description: 'Short answer shown to the user, in their language.' },
      piezas_sugeridas: {
        type: 'array',
        items: { type: 'string' },
        description: 'Ids of existing pieces recommended, most relevant first.',
      },
    },
    required: ['texto', 'piezas_sugeridas'],
    additionalProperties: false,
  },
};

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new HttpError(503, 'Copilot unavailable: set ANTHROPIC_API_KEY (or GEMINI_API_KEY) on the server');
  }
  client ??= new Anthropic({ timeout: 60_000 });
  return client;
}

// Plain-text summary of the user's current song so Claude knows what is already there.
async function describeSong(cancion) {
  if (!cancion) return 'The user has not started a song yet.';

  const pistas = Array.isArray(cancion.pistas) ? cancion.pistas : [];
  const ids = pistas.flatMap((pista) =>
    (Array.isArray(pista?.bloques) ? pista.bloques : []).map((bloque) => bloque?.pieza_id).filter((id) => typeof id === 'string'),
  );
  const piezas = new Map((await getPiezasByIds(ids)).map((pieza) => [pieza.id, pieza]));

  const lines = [
    `Current song: "${cancion.nombre ?? 'untitled'}" by ${cancion.autor ?? 'unknown'}, tempo ${cancion.tempo ?? '?'} BPM.`,
  ];
  if (ids.length === 0) lines.push('The song has no pieces yet.');
  for (const pista of pistas) {
    const bloques = (Array.isArray(pista?.bloques) ? pista.bloques : []).map((bloque) => {
      const pieza = piezas.get(bloque?.pieza_id);
      if (!pieza) return `${bloque?.pieza_id} (unknown piece) at bar ${bloque?.compas}`;
      const key = pieza.tonalidad ? `, ${pieza.tonalidad}` : '';
      return `${pieza.id} "${pieza.nombre}" (${pieza.tipo}${key}, by ${pieza.autor}) at bar ${bloque.compas}`;
    });
    lines.push(`- Track "${pista?.instrumento ?? '?'}": ${bloques.length ? bloques.join('; ') : 'empty'}`);
  }
  return lines.join('\n');
}

function parseFinalAnswer(text) {
  try {
    const data = JSON.parse(text);
    if (typeof data?.texto === 'string' && Array.isArray(data?.piezas_sugeridas)) return data;
  } catch {
    // Not JSON (should not happen with structured outputs): fall back to the raw text.
  }
  return { texto: text.trim(), piezas_sugeridas: text.match(/\bp-\d+\b/g) ?? [] };
}

// Keeps only ids that really exist in the database, without duplicates.
async function onlyExistingIds(ids) {
  const clean = [...new Set(ids.filter((id) => typeof id === 'string'))];
  const existing = await existingPiezaIds(clean);
  return clean.filter((id) => existing.has(id)).slice(0, MAX_SUGGESTIONS);
}

function toHttpError(err) {
  if (err instanceof Anthropic.AuthenticationError) return new HttpError(503, 'Copilot unavailable: invalid ANTHROPIC_API_KEY');
  if (err instanceof Anthropic.RateLimitError) return new HttpError(429, 'Copilot is rate limited, try again in a moment');
  if (err instanceof Anthropic.APIConnectionError) return new HttpError(502, 'Copilot could not reach the Claude API');
  if (err instanceof Anthropic.APIError) return new HttpError(502, `Copilot error: ${err.message}`);
  return err;
}

async function createMessage(anthropic, messages) {
  try {
    return await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      tools: TOOL_DEFINITIONS,
      messages,
      output_config: { effort: 'low', format: RESPONSE_FORMAT },
      // If a safety classifier declines the request, the API retries it on a fallback model.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
  } catch (err) {
    throw toHttpError(err);
  }
}

// mensaje: user text; cancion: Cancion (contract 4.2) or null.
// Returns { texto, piezas_sugeridas } (contract 4.3).
export async function runCopilot(mensaje, cancion) {
  // Claude is the agreed copilot; Gemini is used only when no Anthropic key is configured.
  if (!process.env.ANTHROPIC_API_KEY && process.env.GEMINI_API_KEY) {
    const answer = parseFinalAnswer(await askGemini(`${await describeSong(cancion)}\n\nUser message: ${mensaje}`));
    return { texto: answer.texto, piezas_sugeridas: await onlyExistingIds(answer.piezas_sugeridas) };
  }
  const anthropic = getClient();
  const messages = [
    { role: 'user', content: `${await describeSong(cancion)}\n\nUser message: ${mensaje}` },
  ];

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await createMessage(anthropic, messages);

    if (response.stop_reason === 'refusal') {
      return { texto: "Sorry, I can't help with that. I can suggest pieces from the library for your song.", piezas_sugeridas: [] };
    }

    if (response.stop_reason === 'tool_use') {
      // Keep the full assistant content (thinking + tool_use blocks) and answer every tool call.
      messages.push({ role: 'assistant', content: response.content });
      const toolCalls = response.content.filter((block) => block.type === 'tool_use');
      const results = await Promise.all(
        toolCalls.map(async (call) => {
          try {
            return { type: 'tool_result', tool_use_id: call.id, content: JSON.stringify(await runTool(call.name, call.input)) };
          } catch (err) {
            return { type: 'tool_result', tool_use_id: call.id, content: `Tool failed: ${err.message}`, is_error: true };
          }
        }),
      );
      messages.push({ role: 'user', content: results });
      continue;
    }

    if (response.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: response.content });
      continue;
    }

    // end_turn (or max_tokens): read the final JSON answer.
    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');
    const answer = parseFinalAnswer(text);
    return { texto: answer.texto, piezas_sugeridas: await onlyExistingIds(answer.piezas_sugeridas) };
  }

  throw new HttpError(502, 'Copilot did not finish (too many tool rounds)');
}
