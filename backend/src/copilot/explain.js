// "Explain" for the diff view: the copilot (DJ Stemy) puts the musical facts of a diff into 2-3 sentences.
// It only describes what changed; it never suggests changes or new notes. One model call, no tools, and a template
// built from the same facts whenever there is no key, the call times out or fails, so the demo cannot break.
import Anthropic from '@anthropic-ai/sdk';
import { templateExplanation } from '../lib/diffFacts.js';
import { askGeminiText } from './gemini.js';

const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5';
const TIMEOUT = 15_000;
const SYSTEM =
  'You are DJ Stemy, the copilot of Stemma, a music app where people fork and edit short MIDI pieces. ' +
  'Explain in 2-3 sentences, for a music producer, what changed between the original and the fork, using only these ' +
  'facts. Do not suggest changes or new notes. Plain English, no lists, no headings, no markdown.';

let client = null;

async function askModel(userText) {
  if (process.env.ANTHROPIC_API_KEY) {
    client ??= new Anthropic({ timeout: TIMEOUT });
    const res = await client.messages.create({ model: MODEL, max_tokens: 400, system: SYSTEM, messages: [{ role: 'user', content: userText }] });
    const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
    if (!text || res.stop_reason === 'refusal') throw new Error('no answer');
    return text;
  }
  if (process.env.GEMINI_API_KEY) return askGeminiText(SYSTEM, userText, { timeoutMs: TIMEOUT });
  throw new Error('no model key');
}

/** facts: diffFacts(...). Returns { texto, fuente: 'modelo' | 'plantilla' }. Never throws. */
export async function explainDiff(facts) {
  const template = templateExplanation(facts);
  if (!facts.conteo.nuevas && !facts.conteo.borradas && !facts.conteo.movidas) return { texto: template, fuente: 'plantilla' };
  try {
    const texto = await askModel(`Facts about the diff (JSON):\n${JSON.stringify(facts)}\n\nA correct plain summary of the same facts, for reference:\n${template}`);
    return { texto, fuente: 'modelo' };
  } catch {
    return { texto: template, fuente: 'plantilla' };
  }
}
