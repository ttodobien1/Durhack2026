import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerAgrees, verdict } from '../src/copilot/hum.js';

const birthday = { id: 'p-504', nombre: 'Happy Birthday to You', autor: 'Mildred J. Hill and Patty Hill', licencia: 'Public Domain' };
const elise = { id: 'p-501', nombre: 'Für Elise (opening theme)', autor: 'Ludwig van Beethoven', licencia: 'Public Domain' };
const twinkle = { id: 'p-503', nombre: 'Twinkle Twinkle Little Star', autor: 'Traditional', licencia: 'Public Domain' };
const match = (pieza, similitud) => ({ pieza, similitud, transponer: 0 });
const humWith = (...coincidencias) => ({ coincidencias, veredicto: verdict(coincidencias) });

test('verdict: a clear best match is the hummed piece', () => {
  assert.equal(verdict([match(birthday, 0.71), match(twinkle, 0.4)]).tipo, 'coincide');
  assert.equal(verdict([match(elise, 0.85), match(twinkle, 0.8)]).tipo, 'coincide'); // very high: sure anyway
  assert.equal(verdict([match(birthday, 0.62)]).tipo, 'coincide');
});

test('verdict: close runners-up or a middling score only "remind of" the piece', () => {
  assert.equal(verdict([match(birthday, 0.66), match(twinkle, 0.6)]).tipo, 'parecido');
  assert.equal(verdict([match(birthday, 0.5)]).tipo, 'parecido');
});

test('verdict: low scores are no match', () => {
  assert.equal(verdict([match(birthday, 0.35)]).tipo, 'ninguno');
  assert.equal(verdict([]).tipo, 'ninguno');
});

test('an answer that denies a clear match is caught', () => {
  const hum = humWith(match(birthday, 0.71), match(twinkle, 0.4));
  const wrong =
    'The library does not have a close match for your humming, so you can build something entirely new. To get you started, here are some boom-bap style rap beats by drummer1 and drummer8 that might provide a foundation for your project.';
  assert.equal(answerAgrees(hum, wrong), false);
  assert.equal(answerAgrees(hum, "There's no close match for Happy Birthday in here."), false);
  assert.equal(answerAgrees(hum, 'Your humming sounds like Happy Birthday to You by Mildred and Patty Hill! Here are chords in C.'), true);
  assert.equal(answerAgrees(hum, '¡Tu tarareo suena a Happy Birthday! Te sugiero estos acordes.'), true);
});

test('an answer must name the melody it matched (title or composer)', () => {
  const hum = humWith(match(elise, 0.9));
  assert.equal(answerAgrees(hum, 'Here are some lo-fi chords in A minor.'), false);
  assert.equal(answerAgrees(hum, 'That is Fur Elise! Great pick.'), true);
  assert.equal(answerAgrees(hum, "That's the Beethoven classic, nice."), true);
});

test('with no match, any honest answer is fine', () => {
  const hum = humWith(match(birthday, 0.32));
  assert.equal(answerAgrees(hum, 'Nothing like that in the library yet. Here are chords in C.'), true);
});
