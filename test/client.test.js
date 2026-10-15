// -----------------------------------------------------------------------------
// The local client: one request at a time, HTTPS then HTTP, a busy module
// retried, the errors sorted by kind, never a secret in a message.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ERROR_KINDS, RainbirdClient } from '../src/rainbird/client.js';
import { encryptPayload } from '../src/rainbird/crypto.js';
import { FakeRainbird, createNetwork } from './helpers/fakeRainbird.js';
import { FAST_CLIENT, HOST_1 } from './helpers/world.js';

function setup(moduleOptions = {}, clientOptions = {}) {
  const module = new FakeRainbird(moduleOptions);
  const network = createNetwork({ [HOST_1]: module });
  const client = new RainbirdClient({
    host: HOST_1,
    password: 'secret',
    request: network.request,
    timings: FAST_CLIENT,
    ...clientOptions,
  });
  return { module, network, client };
}

test('reads model, zones, watering, rain sensor and rain delay', async () => {
  const { module, client } = setup();
  module.active = new Set([3]);
  module.raining = true;
  module.rainDelay = 2;
  const model = await client.getModel();
  assert.equal(model.name, 'ESP-TM2');
  assert.equal(model.protocol, '9.12');
  assert.deepEqual(await client.getAvailableZones(model.maxStations), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(await client.getActiveZones(model.maxStations), [3]);
  assert.equal(await client.getRainSensor(), true);
  assert.equal(await client.getRainDelay(), 2);
  assert.equal(await client.getSerialNumber(), '0000012635436566');
  assert.equal(await client.getFirmwareVersion(), '1.47.0');
  assert.deepEqual(module.commands, ['02', '0300', '3F00', '3E', '36', '05', '0B']);
});

test('the commands send what the Rain Bird app sends', async () => {
  const { module, client } = setup();
  await client.runZone(5, 30);
  await client.runProgram(1);
  await client.setRainDelay(3);
  await client.stopIrrigation();
  assert.deepEqual(module.commands, ['3900051E', '3801', '370003', '40']);
  assert.equal(module.rainDelay, 3);
});

test('getWifiParams keeps the MAC address and drops the Wi-Fi settings', async () => {
  const { client } = setup();
  const params = await client.getWifiParams();
  assert.deepEqual(params, {
    mac: '02:00:5E:10:00:01',
    stickVersion: 'Rain Bird Stick Rev C/1.63',
  });
});

test('an old module without getWifiParams: an "unsupported" protocol error', async () => {
  const { client } = setup({ mac: null });
  await assert.rejects(
    client.getWifiParams(),
    (err) => err.kind === ERROR_KINDS.PROTOCOL && err.unsupported === true,
  );
});

test('without a scheme: HTTPS first, then HTTP, and the one that answers is kept', async () => {
  const { network, client } = setup({ scheme: 'http' });
  await client.getModel();
  await client.getRainDelay();
  assert.deepEqual(network.calls, [`https://${HOST_1}`, `http://${HOST_1}`, `http://${HOST_1}`]);
  assert.equal(client.scheme, 'http');
});

test('a module on HTTPS only (newer firmware) is reached in HTTPS at once', async () => {
  const { network, client } = setup({ scheme: 'https' });
  await client.getModel();
  await client.getModel();
  assert.deepEqual(network.calls, [`https://${HOST_1}`, `https://${HOST_1}`]);
});

test('a scheme typed by the user is the only one tried', async () => {
  const { network, client } = setup({ scheme: 'https' }, { scheme: 'http' });
  await assert.rejects(client.getModel(), (err) => err.kind === ERROR_KINDS.UNREACHABLE);
  await assert.rejects(client.getModel(), (err) => err.kind === ERROR_KINDS.UNREACHABLE);
  assert.deepEqual(network.calls, [`http://${HOST_1}`, `http://${HOST_1}`]);
});

test('a module that moved from HTTP to HTTPS is found again', async () => {
  const { module, network, client } = setup({ scheme: 'http' });
  await client.getModel();
  module.scheme = 'https';
  await assert.rejects(client.getModel(), (err) => err.kind === ERROR_KINDS.UNREACHABLE);
  network.calls.length = 0;
  await client.getModel();
  assert.deepEqual(network.calls, [`https://${HOST_1}`]);
});

test('a silent module: unreachable, without trying HTTP after a timeout', async () => {
  const { module, network, client } = setup();
  module.online = false;
  await assert.rejects(
    client.getModel(),
    (err) =>
      err.kind === ERROR_KINDS.UNREACHABLE && /does not answer \(ETIMEDOUT\)/.test(err.message),
  );
  assert.deepEqual(network.calls, [`https://${HOST_1}`]);
});

test('a busy module (503) is retried, then reported busy', async () => {
  const delays = [];
  const sleep = async (ms) => {
    delays.push(ms);
  };
  const { module, client } = setup(
    {},
    { timings: { gapMs: 0, busyDelayMs: 1000, busyRetries: 3 }, sleep },
  );
  module.busy = 2;
  assert.equal((await client.getModel()).name, 'ESP-TM2');
  assert.deepEqual(delays, [1000, 2000]);
  module.busy = 10;
  await assert.rejects(client.getModel(), (err) => err.kind === ERROR_KINDS.BUSY);
});

test('a wrong password: 403, or an answer that does not decrypt', async () => {
  const { client } = setup({ password: 'other' });
  await assert.rejects(client.getModel(), (err) => err.kind === ERROR_KINDS.AUTH);

  const garbage = new RainbirdClient({
    host: HOST_1,
    password: 'secret',
    timings: FAST_CLIENT,
    request: async () => ({ status: 200, body: encryptPayload('{"result":{}}', 'other') }),
  });
  await assert.rejects(
    garbage.getModel(),
    (err) => err.kind === ERROR_KINDS.AUTH && /does not decrypt/.test(err.message),
  );
});

test('JSON-RPC errors: busy, lockout, other', async () => {
  const answer = (error) => async () => ({
    status: 200,
    body: encryptPayload(JSON.stringify({ jsonrpc: '2.0', id: 1, error }), 'secret'),
  });
  const client = (error) =>
    new RainbirdClient({
      host: HOST_1,
      password: 'secret',
      timings: { ...FAST_CLIENT, busyRetries: 0 },
      request: answer(error),
    });
  await assert.rejects(
    client({ code: -32002, message: 'busy' }).getModel(),
    (err) => err.kind === ERROR_KINDS.BUSY,
  );
  await assert.rejects(
    client({ code: -32001, message: 'lockout' }).getModel(),
    (err) => err.kind === ERROR_KINDS.AUTH,
  );
  await assert.rejects(
    client({ code: 7, message: 'odd' }).getModel(),
    (err) => err.kind === ERROR_KINDS.PROTOCOL && !err.unsupported,
  );
});

test('a refused command (NAK) is a "refused" error', async () => {
  const { client } = setup({ rainSensor: false });
  await assert.rejects(client.getRainSensor(), (err) => err.kind === ERROR_KINDS.REFUSED);
  await assert.rejects(client.runZone(9, 5), (err) => err.kind === ERROR_KINDS.REFUSED);
});

test('one request in flight at a time, with a gap between two', async () => {
  let inFlight = 0;
  let most = 0;
  const module = new FakeRainbird();
  const sleeps = [];
  let clock = 0;
  const client = new RainbirdClient({
    host: HOST_1,
    scheme: 'http',
    password: 'secret',
    timings: { gapMs: 250, busyDelayMs: 0 },
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
    request: async (url, options) => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      await new Promise((resolve) => setImmediate(resolve));
      inFlight -= 1;
      return module.handle(url, options);
    },
  });
  await Promise.all([client.getModel(), client.getRainDelay(), client.getRainSensor()]);
  assert.equal(most, 1);
  assert.deepEqual(sleeps, [250, 250]);
});

test('no message carries the password or the Wi-Fi settings', async () => {
  const messages = [];
  const { module, client } = setup({ password: 'other-secret' });
  await client.getModel().catch((err) => messages.push(err.message));
  module.password = 'secret';
  module.busy = 10;
  await client.getModel().catch((err) => messages.push(err.message));
  module.busy = 0;
  messages.push(JSON.stringify(await client.getWifiParams()));
  const text = messages.join('\n');
  assert.ok(!text.includes('secret'));
  assert.ok(!text.includes('fixture-wifi-password'));
  assert.ok(!text.includes('fixture-ssid'));
});
