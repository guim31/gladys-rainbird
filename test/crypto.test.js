// -----------------------------------------------------------------------------
// The payload encryption, checked against payloads encrypted by pyrainbird's
// own code (test/fixtures/rainbird/encryption-vectors.json): an independent
// implementation, not only this one against itself.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decryptPayload, encryptPayload } from '../src/rainbird/crypto.js';
import { fixture } from './helpers/fakeRainbird.js';

const { password, vectors } = fixture('encryption-vectors');

test('decrypts the payloads encrypted by pyrainbird', () => {
  for (const vector of vectors) {
    const text = decryptPayload(Buffer.from(vector.base64, 'base64'), password);
    assert.equal(text, vector.plaintext.trimEnd(), vector.direction);
    if (vector.decoded_by_pyrainbird) {
      assert.deepEqual(JSON.parse(text).result, vector.decoded_by_pyrainbird);
    }
  }
});

test('encrypts byte for byte like pyrainbird (same IV)', () => {
  for (const vector of vectors) {
    const expected = Buffer.from(vector.base64, 'base64');
    const iv = expected.subarray(32, 48);
    assert.deepEqual(encryptPayload(vector.plaintext, password, iv), expected, vector.direction);
  }
});

test('a random IV each time, and a round trip whatever the length', () => {
  const a = encryptPayload('{"a":1}', 'pw');
  const b = encryptPayload('{"a":1}', 'pw');
  assert.notDeepEqual(a.subarray(32, 48), b.subarray(32, 48));
  for (const length of [1, 15, 16, 17, 31, 32, 100]) {
    const text = 'x'.repeat(length);
    assert.equal(decryptPayload(encryptPayload(text, 'pw'), 'pw'), text);
  }
});

test('the wrong password or a truncated body does not give the JSON back', () => {
  const body = encryptPayload('{"jsonrpc":"2.0","result":{}}', 'right');
  assert.throws(() => JSON.parse(decryptPayload(body, 'wrong')));
  assert.throws(() => decryptPayload(body.subarray(0, 40), 'right'), /Not an encrypted payload/);
  assert.throws(() => decryptPayload(Buffer.from('<html>'), 'right'), /Not an encrypted payload/);
});
