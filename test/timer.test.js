// -----------------------------------------------------------------------------
// The reading timer of the container. Gladys 5.2 never polls a device
// published with should_poll: false (nor the devices created without
// should_poll, GladysAssistant/Gladys#3198): the controllers must be read by
// the hub's own timer, with no onPoll at all.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FakeRainbird,
  HOST_1,
  createAll,
  createClock,
  createWorld,
  featureId,
} from './helpers/world.js';

/** Let the timer callback and the fake network settle. */
const settle = async () => {
  for (let i = 0; i < 50; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
};

async function timedWorld(t, config = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const clock = createClock();
  const module = new FakeRainbird();
  const w = await createWorld({
    clock,
    modules: { [HOST_1]: module },
    config: { controller_1_host: HOST_1, controller_1_password: 'secret', ...config },
    timers: true,
  });
  t.after(() => w.app.stop());
  return { ...w, module, clock };
}

test('the internal timer reads the controllers without any onPoll from Gladys', async (t) => {
  const w = await timedWorld(t, { poll_interval: '120' });
  const polled = t.mock.method(w.hub, 'pollDevice');
  await createAll(w);
  assert.equal(w.fake.discoveredDevices[0].should_poll, false, 'Gladys is not asked to poll');
  const reads = () => w.module.commands.filter((command) => command === '3F00').length;
  const before = reads();

  for (const zone of [2, 5, 7]) {
    w.module.active = new Set([zone]);
    w.clock.advance(120_000);
    t.mock.timers.tick(120_000);
    await settle();
    assert.equal(w.fake.lastState(featureId(w.gladys, `zone_${zone}`)), 1);
  }
  assert.equal(reads() - before, 3, 'one reading per interval');
  assert.equal(polled.mock.callCount(), 0, 'no onPoll involved');
});

test('a command is checked a few seconds later, when the controller shows it', async (t) => {
  const w = await timedWorld(t);
  await createAll(w);
  await w.hub.runProgram(w.fake.discoveredDevices[0].external_id, 'A');
  const before = w.module.commands.length;
  t.mock.timers.tick(5_000);
  await settle();
  assert.deepEqual(w.module.commands.slice(before), ['3F00', '3E', '36']);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'zone_1')), 1);
  assert.equal(w.fake.sceneEvents.at(-1).data.origin, 'gladys');
});

test('a first failure is read again 30 seconds later', async (t) => {
  const w = await timedWorld(t);
  await createAll(w);
  w.module.online = false;
  await w.hub.pollAll();
  w.module.online = true;
  const before = w.module.commands.length;
  t.mock.timers.tick(30_000);
  await settle();
  assert.ok(w.module.commands.length > before);
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('the timer stops with the integration', async (t) => {
  const w = await timedWorld(t);
  await w.app.stop();
  const before = w.module.requests.length;
  t.mock.timers.tick(10 * 60_000);
  await settle();
  assert.equal(w.module.requests.length, before);
});
