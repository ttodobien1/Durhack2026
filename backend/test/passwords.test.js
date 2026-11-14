import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hashPassword, verifyPassword } from '../src/lib/passwords.js';

test('a hashed password verifies, a wrong one does not', async () => {
  const stored = await hashPassword('beats-at-night');
  assert.match(stored, /^scrypt\$16384\$8\$1\$/);
  assert.equal(await verifyPassword('beats-at-night', stored), true);
  assert.equal(await verifyPassword('beats-at-noon', stored), false);
});

test('the same password gives a different hash each time (random salt)', async () => {
  assert.notEqual(await hashPassword('same'), await hashPassword('same'));
});

test('garbage in the stored hash is rejected, not thrown', async () => {
  assert.equal(await verifyPassword('x', 'not-a-hash'), false);
  assert.equal(await verifyPassword('x', null), false);
});
