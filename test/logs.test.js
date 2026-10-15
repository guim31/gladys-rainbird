// -----------------------------------------------------------------------------
// What the integration writes at the default level (info): the lifecycle
// only. A normal reading writes nothing, a failure that repeats is logged
// once, and its end once. Never a password nor the Wi-Fi settings the module
// returns.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FakeRainbird,
  HOST_1,
  createAll,
  createClock,
  createWorld,
  deviceId,
} from './helpers/world.js';

const PASSWORD = 'module-secret-pw';

/** Capture the lines of the SDK logger at LOG_LEVEL=info. */
function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  const lines = [];
  const record =
    (stream) =>
    (...args) =>
      lines.push({
        stream,
        text: args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' '),
      });
  t.mock.method(console, 'log', record('out'));
  t.mock.method(console, 'error', record('err'));
  t.mock.method(console, 'warn', record('err'));
  t.mock.method(console, 'info', record('out'));
  t.mock.method(console, 'debug', record('out'));
  return {
    lines,
    clear: () => lines.splice(0),
    texts: () => lines.map((line) => line.text),
  };
}

async function world(t, options = {}) {
  const clock = createClock();
  const module = new FakeRainbird({ password: PASSWORD });
  const w = await createWorld({
    clock,
    modules: { [HOST_1]: module },
    config: { controller_1_host: HOST_1, controller_1_password: PASSWORD, language: 'en' },
    ...options,
  });
  t.after(() => w.app.stop());
  return { ...w, module };
}

test('a normal reading cycle writes nothing at info', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  assert.ok(
    logs.texts().some((text) => text.includes('connected, ESP-TM2, 7 zone(s)')),
    'the start is logged',
  );
  await createAll(w);
  logs.clear();

  for (const zones of [[1], [1], [2], [], []]) {
    w.module.active = new Set(zones);
    w.module.raining = !w.module.raining;
    w.clock.advance(7 * 60 * 60_000); // the identity is read again too
    await w.hub.pollAll();
  }
  assert.deepEqual(logs.texts(), []);
});

test('one line per user command', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  logs.clear();
  await w.hub.waterZone(deviceId(w.gladys), 3, 5);
  await w.hub.stopWatering(deviceId(w.gladys));
  assert.equal(logs.lines.length, 2, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /zone 3 watering for 5 min/);
  assert.match(logs.lines[1].text, /watering stopped/);
});

test('a controller that stays down is logged once, and once when it is back', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  await createAll(w);
  logs.clear();

  w.module.online = false;
  for (let i = 0; i < 6; i += 1) {
    w.clock.advance(60_000);
    await w.hub.pollAll();
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.equal(logs.lines[0].stream, 'err');

  logs.clear();
  w.module.online = true;
  await w.hub.pollAll();
  await w.hub.pollAll();
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /answers again after 5 min/);
});

test('a busy module (the app talking to it) is logged once', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t, { clientTimings: { gapMs: 0, busyDelayMs: 0, busyRetries: 1 } });
  await createAll(w);
  logs.clear();
  for (let i = 0; i < 4; i += 1) {
    w.module.busy = 5;
    await w.hub.pollAll();
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /busy/);
});

test('a refused password is logged once, never the password', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t, {
    config: { controller_1_host: HOST_1, controller_1_password: 'wrong-password-123' },
  });
  for (let i = 0; i < 5; i += 1) {
    await w.hub.pollAll();
  }
  const warnings = logs.lines.filter((line) => line.stream === 'err');
  assert.equal(warnings.length, 1, logs.texts().join('\n'));
  assert.ok(!logs.texts().join('\n').includes('wrong-password-123'));
});

test('Gladys refusing the states is logged once', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  await createAll(w);
  logs.clear();
  w.gladys.publishStates = async () => {
    throw new Error('HTTP 500');
  };
  for (const zone of [1, 2, 3, 4]) {
    w.module.active = new Set([zone]);
    await w.hub.pollAll();
  }
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /States of .* refused/);
});

test('LOG_LEVEL=debug shows each reading; never a secret of the configuration or the module', async (t) => {
  const logs = captureLogs(t, 'debug');
  const w = await world(t);
  await createAll(w);
  await w.hub.pollAll();
  w.module.online = false;
  await w.hub.pollAll();
  await w.hub.pollAll();
  await w.fake.action('test_connection', {});
  const text = logs.texts().join('\n');
  assert.match(text, /\[DEBUG\].*watering \[\]/);
  assert.match(text, /\[DEBUG\].*again/);
  for (const secret of [PASSWORD, 'fixture-wifi-password', 'fixture-ssid']) {
    assert.ok(!text.includes(secret), `never "${secret}"`);
  }
});
