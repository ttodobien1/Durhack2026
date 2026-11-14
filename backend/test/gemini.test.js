import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractJson, toGeminiSchema } from '../src/copilot/gemini.js';

test('toGeminiSchema drops additionalProperties at every depth and keeps the rest', () => {
  const out = toGeminiSchema({
    type: 'object',
    additionalProperties: false,
    required: ['nombre'],
    properties: { nombre: { type: 'string' }, extra: { type: 'object', additionalProperties: false, properties: {} } },
  });
  assert.deepEqual(out, { type: 'object', required: ['nombre'], properties: { nombre: { type: 'string' }, extra: { type: 'object', properties: {} } } });
});

test('extractJson pulls the answer out of fences or trailing prose', () => {
  const json = '{ "texto": "Hi", "piezas_sugeridas": ["p-101"] }';
  assert.equal(extractJson('```json\n' + json + '\n```'), json);
  assert.equal(extractJson('Some prose first. ' + json), json);
  assert.equal(extractJson('Just text, no JSON.'), 'Just text, no JSON.');
});
