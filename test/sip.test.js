// -----------------------------------------------------------------------------
// The controller commands, against the answers recorded on real controllers by
// pyrainbird and Home Assistant (test/fixtures/rainbird/sip-answers.json).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeAnswer, encodeCommand, pagesFor, zonesOfMask } from '../src/rainbird/sip.js';
import { modelInfo } from '../src/rainbird/models.js';
import { fixture } from './helpers/fakeRainbird.js';

const answers = fixture('sip-answers');

test('encodes the requests exactly as pyrainbird does', () => {
  for (const { command, args, data, length } of answers.requests) {
    assert.deepEqual(encodeCommand(command, ...args), { data, length }, command);
  }
});

test('decodes the recorded answers', () => {
  for (const name of [
    'modelAndVersion',
    'rainSensor',
    'rainDelay',
    'serialNumber',
    'firmwareVersion',
  ]) {
    for (const { data, expected } of answers[name]) {
      assert.deepEqual(decodeAnswer(name, data), expected, `${name} ${data}`);
    }
  }
  for (const data of answers.acknowledge) {
    assert.deepEqual(decodeAnswer('stopIrrigation', data), {});
  }
});

test('reads the zone masks: available zones and zones watering', () => {
  for (const name of ['availableStations', 'activeStations']) {
    for (const { data, page, zones } of answers[name]) {
      assert.deepEqual(zonesOfMask(decodeAnswer(name, data).mask, page), zones, `${name} ${data}`);
    }
  }
  // Second page, and the last bit of the first byte.
  assert.deepEqual(zonesOfMask('80000001', 1), [40, 57]);
  assert.equal(pagesFor(12), 1);
  assert.equal(pagesFor(48), 2);
  assert.equal(pagesFor(0), 1);
});

test('a refused command (NAK) and an unexpected answer are errors', () => {
  const [{ data }] = answers.nack;
  assert.throws(
    () => decodeAnswer('modelAndVersion', data),
    (err) => err.nack === true && /refused/.test(err.message),
  );
  assert.throws(
    () => decodeAnswer('rainDelay', 'BE01'),
    (err) => err.nack === false && /unexpected answer BE/.test(err.message),
  );
  assert.throws(() => decodeAnswer('rainDelay', 'not hex'), /not hex/);
  assert.throws(() => decodeAnswer('rainDelay', undefined), /not hex/);
});

test('the model table gives the limits of the known models', () => {
  assert.deepEqual(
    { ...modelInfo(5) },
    {
      id: '0005',
      known: true,
      name: 'ESP-TM2',
      maxStations: 12,
      maxPrograms: 3,
      maxRainDelayDays: 14,
      maxRunMinutes: 360,
    },
  );
  assert.equal(modelInfo(0x0103).name, 'ESP-RZXe2');
  assert.equal(modelInfo(0x16).maxRainDelayDays, 30);
  const unknown = modelInfo(0x4242);
  assert.equal(unknown.known, false);
  assert.equal(unknown.id, '4242');
  assert.equal(unknown.maxPrograms, 0);
});
