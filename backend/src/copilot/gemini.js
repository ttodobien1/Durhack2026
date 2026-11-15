// Gemini fallback for the copilot: same system prompt and the same two tools (CLAUDE.md 4.4),
// used when GEMINI_API_KEY is set and ANTHROPIC_API_KEY is not. Plain fetch, no extra dependency.
import { HttpError } from '../lib/errors.js';
import { SYSTEM_PROMPT } from './systemPrompt.js';
import { TOOL_DEFINITIONS, runTool } from './tools.js';

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite'; // fast enough for a 2-4 call tool loop
const URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const MAX_ROUNDS = 6;
// Flash-lite drifts into the Spanish style terms in the data; pin the reply language explicitly.
const LANGUAGE_RULE =
  '\n\nLanguage: write "texto" in the language of the text after "User message:". If that text is in English, answer in English even if piece names or tags are in Spanish.';

// Gemini function declarations take an OpenAPI-style schema without additionalProperties.
export function toGeminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const { additionalProperties, ...rest } = schema;
  return Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, toGeminiSchema(v)]));
}

const TOOLS = [
  {
    functionDeclarations: TOOL_DEFINITIONS.map((t) => ({ name: t.name, description: t.description, parameters: toGeminiSchema(t.input_schema) })),
  },
];

async function generate(contents) {
  let res;
  try {
    res = await fetch(URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM_PROMPT + LANGUAGE_RULE }] }, contents, tools: TOOLS }),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new HttpError(502, 'DJ Stemy could not reach the Gemini API');
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 || res.status === 403) throw new HttpError(503, 'DJ Stemy is unavailable: invalid GEMINI_API_KEY');
  if (res.status === 429) throw new HttpError(429, 'DJ Stemy is rate limited, try again in a moment');
  if (!res.ok) throw new HttpError(502, `DJ Stemy error: ${data.error?.message ?? res.status}`);
  return data;
}

/** Gemini may fence the JSON answer or put prose before it: return just the JSON object when there is one. */
export function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try {
      const candidate = text.slice(start, end + 1);
      JSON.parse(candidate);
      return candidate;
    } catch {
      // not valid JSON: fall through to the raw text
    }
  }
  return text.trim();
}

/** Runs the tool loop and returns the model's final text (expected to be the JSON answer). */
export async function askGemini(userText) {
  const contents = [{ role: 'user', parts: [{ text: userText }] }];
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const data = await generate(contents);
    const candidate = data.candidates?.[0];
    if (!candidate?.content?.parts) {
      return JSON.stringify({ texto: "Sorry, I can't help with that. I can suggest pieces from the library for your song.", piezas_sugeridas: [] });
    }
    const calls = candidate.content.parts.filter((p) => p.functionCall);
    if (!calls.length) {
      return extractJson(candidate.content.parts.map((p) => p.text ?? '').join(''));
    }
    contents.push(candidate.content); // keep the model turn as-is (it may carry thought signatures)
    const responses = await Promise.all(
      calls.map(async ({ functionCall: { name, args } }) => {
        try {
          return { functionResponse: { name, response: { result: await runTool(name, args ?? {}) } } };
        } catch (err) {
          return { functionResponse: { name, response: { error: `Tool failed: ${err.message}` } } };
        }
      }),
    );
    contents.push({ role: 'user', parts: responses });
  }
  throw new HttpError(502, 'DJ Stemy did not finish (too many tool rounds)');
}
