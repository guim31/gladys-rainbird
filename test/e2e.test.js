// -----------------------------------------------------------------------------
// End to end over real HTTP: the integration, wired on the SDK's fake Gladys,
// talks through node:http (src/rainbird/http.js) to a fake module served on
// 127.0.0.1 — encryption, the HTTPS attempt refused by a plain HTTP server,
// the fallback to HTTP, and a command.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../src/app.js';
import { Store } from '../src/store.js';
import { FakeRainbird } from './helpers/fakeRainbird.js';

test('discovers, reads and waters a zone over real HTTP', async (t) => {
  const module = new FakeRainbird({ password: 'e2e-password' });
  module.active = new Set([2]);
  const server = await module.serve();
  t.after(() => server.close());

  const gladys = createFakeGladys({
    config: { controller_1_host: server.host, controller_1_password: 'e2e-password' },
  });
  const app = registerHandlers(gladys, {
    store: new Store(mkdtempSync(join(tmpdir(), 'gladys-rainbird-'))),
    clientTimings: { gapMs: 0 },
    timers: false,
  });
  t.after(() => app.stop());
  await gladys.connect();
  await app.ready;

  const [device] = gladys.fake.discoveredDevices;
  assert.equal(device.name, 'Rain Bird ESP-TM2');
  assert.equal(app.hub.records.get(1).client.scheme, 'http', 'HTTPS refused, HTTP kept');
  await gladys.fake.deviceCreated(device);
  assert.equal(gladys.fake.lastState(`${device.external_id}:zone_2`), 1);

  const zone = device.features.find((f) => f.external_id.endsWith(':zone_6'));
  assert.deepEqual(await gladys.fake.setValue(device, zone, 1), { success: true });
  assert.deepEqual(module.lastRun, { zone: 6, minutes: 10 });
  assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
});

test('a wrong password over real HTTP is reported as such', async (t) => {
  const module = new FakeRainbird({ password: 'e2e-password' });
  const server = await module.serve();
  t.after(() => server.close());
  const gladys = createFakeGladys({
    config: { controller_1_host: server.host, controller_1_password: 'not-it', language: 'en' },
  });
  const app = registerHandlers(gladys, {
    store: new Store(mkdtempSync(join(tmpdir(), 'gladys-rainbird-'))),
    clientTimings: { gapMs: 0 },
    timers: false,
  });
  t.after(() => app.stop());
  await gladys.connect();
  await app.ready;
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(gladys.fake.connectionStatus.message.en, /password refused/);
});
