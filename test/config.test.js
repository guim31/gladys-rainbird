import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, parseHost, parseMinutes } from '../src/config.js';

test('an address: bare IP, name with port, URL with scheme and path', () => {
  assert.deepEqual(parseHost(' 192.0.2.10 '), { host: '192.0.2.10', scheme: null });
  assert.deepEqual(parseHost('rainbird.local:8080'), { host: 'rainbird.local:8080', scheme: null });
  assert.deepEqual(parseHost('https://192.0.2.10/stick'), { host: '192.0.2.10', scheme: 'https' });
  assert.deepEqual(parseHost('HTTP://192.0.2.10'), { host: '192.0.2.10', scheme: 'http' });
});

test('an unusable address, or one with credentials, is refused', () => {
  for (const raw of [
    '',
    '   ',
    'ftp://192.0.2.10',
    'http://user:pw@192.0.2.10',
    'http://',
    42,
    null,
  ]) {
    assert.equal(parseHost(raw), null, String(raw));
  }
});

test('the defaults: no controller, 10 minutes, one minute, French', () => {
  assert.deepEqual(normalizeConfig(), {
    controllers: [],
    invalidSlots: [],
    zoneMinutes: 10,
    pollIntervalMs: 60_000,
    language: 'fr',
  });
  assert.deepEqual(normalizeConfig(DEFAULT_CONFIG), normalizeConfig());
});

test('three slots, the empty ones skipped, the invalid ones reported', () => {
  const config = normalizeConfig({
    controller_1_host: '192.0.2.10',
    controller_1_password: ' pass with spaces ',
    controller_1_name: '  Jardin  ',
    controller_2_host: 'http://user:pw@192.0.2.11',
    controller_3_host: 'https://192.0.2.12',
    controller_3_password: 'x',
    poll_interval: 300,
    zone_minutes: '7,6',
    language: 'es',
  });
  assert.deepEqual(config.controllers, [
    { slot: 1, host: '192.0.2.10', scheme: null, password: ' pass with spaces ', name: 'Jardin' },
    { slot: 3, host: '192.0.2.12', scheme: 'https', password: 'x', name: null },
  ]);
  assert.deepEqual(config.invalidSlots, [2]);
  assert.equal(config.pollIntervalMs, 300_000);
  assert.equal(config.zoneMinutes, 8);
  assert.equal(config.language, 'es');
});

test('an interval or a language outside the lists falls back to the default', () => {
  const config = normalizeConfig({ poll_interval: '5', language: 'it' });
  assert.equal(config.pollIntervalMs, 60_000);
  assert.equal(config.language, 'fr');
});

test('minutes: whole, between 1 and 240', () => {
  assert.equal(parseMinutes(0), 1);
  assert.equal(parseMinutes(1000), 240);
  assert.equal(parseMinutes('2,4'), 2);
  assert.equal(parseMinutes('abc', 5), 5);
  assert.equal(parseMinutes(undefined, 5), 5);
});
