// -----------------------------------------------------------------------------
// The hub, end to end through the SDK's fake Gladys and fake Rain Bird modules:
// discovery, identity, states, commands, scene events, offline controllers,
// several controllers, configuration changes.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { platformIdOf } from '../src/devices.js';
import { ORIGINS, TRIGGERS } from '../src/hub.js';
import {
  FakeRainbird,
  HOST_1,
  HOST_2,
  MAC_2,
  createAll,
  createClock,
  createWorld,
  deviceId,
  featureId,
  idsOf,
} from './helpers/world.js';

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

const feature = (w, key) =>
  w.fake.discoveredDevices[0].features.find((f) => f.external_id === featureId(w.gladys, key));

test('one device per controller, identified by the MAC address of its module', async (t) => {
  const w = await world(t);
  const [device] = w.fake.discoveredDevices;
  assert.equal(device.external_id, 'ext:test-integration:controller:02005e100001');
  assert.equal(device.name, 'Rain Bird ESP-TM2');
  assert.equal(device.should_poll, false);
  assert.deepEqual(
    device.features.map((f) => f.external_id.split(':').pop()),
    [
      'zone_1',
      'zone_2',
      'zone_3',
      'zone_4',
      'zone_5',
      'zone_6',
      'zone_7',
      'rain_sensor',
      'rain_delay',
      'online',
      'stop',
      'program_a',
      'program_b',
      'program_c',
    ],
  );
  assert.deepEqual(device.params, [
    { name: 'RAINBIRD_HOST', value: HOST_1 },
    { name: 'RAINBIRD_MODEL', value: 'ESP-TM2' },
  ]);
  assert.equal(feature(w, 'rain_delay').max, 14);
  assert.equal(feature(w, 'rain_delay').unit, 'days');
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('identity: the serial number on an old module, else the slot', () => {
  assert.equal(platformIdOf({ mac: '4C:A1:61:00:11:22', slot: 1 }), '4ca161001122');
  assert.equal(
    platformIdOf({ mac: null, serial: '0000012635436566', slot: 1 }),
    'sn0000012635436566',
  );
  assert.equal(platformIdOf({ mac: null, serial: '0000000000000000', slot: 2 }), 'slot2');
  assert.equal(platformIdOf({ mac: '00:00:00:00:00:00', serial: null, slot: 3 }), 'slot3');
});

test('an old module without getWifiParams is identified by its serial number', async (t) => {
  const w = await world(t, { modules: { [HOST_1]: new FakeRainbird({ mac: null }) } });
  assert.equal(
    w.fake.discoveredDevices[0].external_id,
    'ext:test-integration:controller:sn0000012635436566',
  );
});

test('a busy module during identification never falls back to another identity', async (t) => {
  const module = new FakeRainbird();
  const w = await world(t, { modules: { [HOST_1]: module } });
  const id = w.fake.discoveredDevices[0].external_id;
  // Busy on getWifiParams, and on its retries.
  module.busyFor.add('getWifiParams');
  await w.hub.rediscover();
  assert.deepEqual(
    w.fake.discoveredDevices.map((d) => d.external_id),
    [id],
  );
  assert.equal(w.hub.records.get(1).error.kind, 'busy');
});

test('states: zones watering, rain sensor, rain delay, online; buttons have none', async (t) => {
  const module = new FakeRainbird();
  module.active = new Set([3]);
  module.raining = true;
  module.rainDelay = 2;
  const w = await world(t, { modules: { [HOST_1]: module } });
  await createAll(w);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'zone_3')), 1);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'zone_1')), 0);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'rain_sensor')), 1);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'rain_delay')), 2);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'online')), 1);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'stop')), undefined);
});

test('only the changes are published; everything again when the device is added', async (t) => {
  const w = await world(t);
  await createAll(w);
  const count = w.fake.states.length;
  await w.hub.pollAll();
  await w.hub.pollAll();
  assert.equal(w.fake.states.length, count, 'nothing changed, nothing sent');
  w.module.active = new Set([5]);
  await w.hub.pollAll();
  assert.equal(w.fake.states.length, count + 1);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'zone_5')), 1);

  const before = w.fake.states.length;
  await w.fake.deviceCreated(w.fake.discoveredDevices[0]);
  assert.equal(w.fake.states.length - before, 10, 'the 10 stateful features sent again');
  assert.ok(w.fake.widgetRefreshes.length > 0);
});

test('a state the device was not added for yet is sent again once it is', async (t) => {
  const w = await world(t);
  // Published at start, before the device exists: Gladys dropped them.
  assert.ok(w.fake.states.length > 0);
  w.fake.states.length = 0;
  await createAll(w);
  assert.equal(w.fake.lastState(featureId(w.gladys, 'online')), 1);
});

test('the heartbeat sends an unchanged value again after 6 hours', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const w = await world(t);
  await createAll(w);
  const count = w.fake.states.length;
  await w.hub.pollAll();
  assert.equal(w.fake.states.length, count);
  t.mock.timers.tick(6 * 60 * 60_000 + 1);
  await w.hub.pollAll();
  assert.equal(w.fake.states.length - count, 10);
});

test('the timer reads only the controllers added to Gladys', async (t) => {
  const w = await world(t);
  const before = w.module.commands.length;
  await w.hub.pollAll();
  assert.equal(w.module.commands.length, before, 'not added: not read');
  await createAll(w);
  const added = w.module.commands.length;
  await w.hub.pollAll();
  assert.deepEqual(w.module.commands.slice(added), ['3F00', '3E', '36']);
});

test('a zone switch waters for the configured minutes; off stops everything', async (t) => {
  const w = await world(t, {
    config: { controller_1_host: HOST_1, controller_1_password: 'secret', zone_minutes: 15 },
  });
  await createAll(w);
  const device = w.fake.discoveredDevices[0];
  assert.deepEqual(await w.fake.setValue(device, feature(w, 'zone_4'), 1), { success: true });
  assert.deepEqual(w.module.lastRun, { zone: 4, minutes: 15 });
  // Shown at once, before the controller reflects it.
  assert.equal(w.fake.lastState(featureId(w.gladys, 'zone_4')), 1);

  assert.deepEqual(await w.fake.setValue(device, feature(w, 'zone_4'), 0), { success: true });
  assert.equal(w.module.commands.at(-1), '40');
  assert.equal(w.fake.lastState(featureId(w.gladys, 'zone_4')), 0);
});

test('the buttons: stop, run a program; the rain delay slider', async (t) => {
  const w = await world(t);
  await createAll(w);
  const device = w.fake.discoveredDevices[0];
  await w.fake.setValue(device, feature(w, 'stop'), 1);
  assert.equal(w.module.commands.at(-1), '40');
  await w.fake.setValue(device, feature(w, 'program_c'), 1);
  assert.equal(w.module.commands.at(-1), '3802');
  await w.fake.setValue(device, feature(w, 'rain_delay'), 3.4);
  assert.equal(w.module.commands.at(-1), '370003');
  assert.equal(w.fake.lastState(featureId(w.gladys, 'rain_delay')), 3);
  await w.fake.setValue(device, feature(w, 'rain_delay'), 99);
  assert.equal(w.module.rainDelay, 14, 'capped at the model limit');
  const online = await w.fake.setValue(device, feature(w, 'online'), 1);
  assert.equal(online.success, false);
});

test('scene events: start and end of each zone, who started it, how long', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock });
  await createAll(w);
  w.module.active = new Set([2]);
  await w.hub.pollAll();
  clock.advance(12 * 60_000);
  w.module.active = new Set([3]);
  await w.hub.pollAll();
  clock.advance(60_000);
  await w.hub.waterZone(deviceId(w.gladys), 6, 5);
  await w.hub.pollAll();
  clock.advance(5 * 60_000);
  w.module.active = new Set();
  await w.hub.pollAll();

  const device = deviceId(w.gladys);
  const controller = 'Rain Bird ESP-TM2';
  assert.deepEqual(w.fake.sceneEvents, [
    { key: TRIGGERS.STARTED, data: { device, controller, zone: 2, origin: ORIGINS.CONTROLLER } },
    {
      key: TRIGGERS.FINISHED,
      data: { device, controller, zone: 2, origin: ORIGINS.CONTROLLER, minutes: 12 },
    },
    { key: TRIGGERS.STARTED, data: { device, controller, zone: 3, origin: ORIGINS.CONTROLLER } },
    {
      key: TRIGGERS.FINISHED,
      data: { device, controller, zone: 3, origin: ORIGINS.CONTROLLER, minutes: 1 },
    },
    { key: TRIGGERS.STARTED, data: { device, controller, zone: 6, origin: ORIGINS.GLADYS } },
    {
      key: TRIGGERS.FINISHED,
      data: { device, controller, zone: 6, origin: ORIGINS.GLADYS, minutes: 5 },
    },
  ]);
});

test('no event for a watering already running at start; its length is then unknown', async (t) => {
  const module = new FakeRainbird();
  module.active = new Set([1]);
  const w = await world(t, { modules: { [HOST_1]: module } });
  await createAll(w);
  assert.deepEqual(w.fake.sceneEvents, []);
  module.active = new Set();
  await w.hub.pollAll();
  assert.equal(w.fake.sceneEvents.length, 1);
  assert.equal(w.fake.sceneEvents[0].data.minutes, null);
});

test('a zone the controller does not have, a program it does not have', async (t) => {
  const w = await world(t);
  await assert.rejects(w.hub.waterZone(deviceId(w.gladys), 9), /not wired/);
  await assert.rejects(w.hub.runProgram(deviceId(w.gladys), 'D'), /no such program/);
  await assert.rejects(w.hub.waterZone('ext:other', 1), /no longer in the configuration/);
});

test('the run length is capped by the model limit and the byte of the command', async (t) => {
  const w = await world(t);
  const { minutes } = await w.hub.waterZone(deviceId(w.gladys), 1, 9999);
  assert.equal(minutes, 240);
  assert.deepEqual(w.module.lastRun, { zone: 1, minutes: 240 });
});

test('a controller that stops answering goes offline after two readings, then back', async (t) => {
  const clock = createClock();
  const w = await world(t, { clock });
  await createAll(w);
  w.module.online = false;
  await w.hub.pollAll();
  assert.equal(w.fake.lastState(featureId(w.gladys, 'online')), 1, 'one miss is a blip');
  clock.advance(60_000);
  await w.hub.pollAll();
  assert.equal(w.fake.lastState(featureId(w.gladys, 'online')), 0);
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.fr, /Rain Bird ESP-TM2 : ne répond pas/);
  assert.deepEqual(w.fake.transports.at(-1), {
    device_external_id: deviceId(w.gladys),
    transport: 'unreachable',
  });
  w.module.online = true;
  await w.hub.pollAll();
  assert.equal(w.fake.lastState(featureId(w.gladys, 'online')), 1);
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('a command to a controller that does not answer says so in the user language', async (t) => {
  const w = await world(t, {
    config: { controller_1_host: HOST_1, controller_1_password: 'secret', language: 'de' },
  });
  w.module.online = false;
  await assert.rejects(
    w.hub.waterZone(deviceId(w.gladys), 1),
    /^Error: Rain Bird ESP-TM2: antwortet nicht$/,
  );
});

test('a wrong password is reported, and no device is published', async (t) => {
  const w = await world(t, {
    config: { controller_1_host: HOST_1, controller_1_password: 'wrong', language: 'en' },
  });
  assert.deepEqual(w.fake.discoveredDevices, []);
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /password refused/);
});

test('no controller configured, or an address not understood', async (t) => {
  const none = await world(t, { config: {} });
  assert.equal(none.fake.connectionStatus.connected, false);
  assert.match(none.fake.connectionStatus.message.en, /Enter the address/);
  const invalid = await world(t, { config: { controller_1_host: 'ftp://x' } });
  assert.match(invalid.fake.connectionStatus.message.en, /Address not understood/);
});

test('the device is published from /data while the controller does not answer', async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'gladys-rainbird-'));
  const first = await world(t, { dataDir });
  const devices = first.fake.discoveredDevices;
  await first.app.stop();

  const silent = new FakeRainbird();
  silent.online = false;
  const second = await world(t, { dataDir, modules: { [HOST_1]: silent } });
  assert.deepEqual(second.fake.discoveredDevices, devices);
});

test('/data is forgotten for a slot whose address changed', async (t) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'gladys-rainbird-'));
  const first = await world(t, { dataDir });
  await first.app.stop();
  const silent = new FakeRainbird();
  silent.online = false;
  const second = await world(t, {
    dataDir,
    modules: { [HOST_2]: silent },
    config: { controller_1_host: HOST_2, controller_1_password: 'secret' },
  });
  assert.deepEqual(second.fake.discoveredDevices, []);
});

test('the same device when the controller gets another address', async (t) => {
  const w = await world(t, {
    modules: { [HOST_1]: new FakeRainbird(), [HOST_2]: new FakeRainbird() },
  });
  const id = w.fake.discoveredDevices[0].external_id;
  await w.fake.configUpdated({ controller_1_host: HOST_2, controller_1_password: 'secret' });
  assert.equal(w.fake.discoveredDevices[0].external_id, id);
  assert.deepEqual(w.fake.discoveredDevices[0].params[0], { name: 'RAINBIRD_HOST', value: HOST_2 });
});

test('two controllers: stop all at once, one failing does not block the other', async (t) => {
  const second = new FakeRainbird({ mac: MAC_2 });
  const w = await world(t, {
    modules: { [HOST_1]: new FakeRainbird(), [HOST_2]: second },
    config: {
      controller_1_host: HOST_1,
      controller_1_password: 'secret',
      controller_1_name: 'Front',
      controller_2_host: HOST_2,
      controller_2_password: 'secret',
      controller_2_name: 'Back',
    },
  });
  assert.deepEqual(
    w.fake.discoveredDevices.map((d) => d.name),
    ['Front', 'Back'],
  );
  w.module.active = new Set([1]);
  second.active = new Set([2]);
  assert.equal(await w.hub.stopWatering(null), 2);
  assert.equal(w.module.active.size + second.active.size, 0);
  second.online = false;
  assert.equal(await w.hub.stopWatering(null), 1);
  await assert.rejects(w.hub.stopWatering(idsOf(w.gladys, MAC_2).device), /Back : ne répond pas/);
});

test('a rewired controller (a new zone) publishes its device again', async (t) => {
  const w = await world(t);
  assert.equal(
    w.fake.discoveredDevices[0].features.filter((f) => f.category === 'switch').length,
    7,
  );
  w.module.zones.add(8);
  await w.hub.rediscover();
  assert.equal(
    w.fake.discoveredDevices[0].features.filter((f) => f.category === 'switch').length,
    8,
  );
});

test('a controller without rain sensor reading has no rain sensor feature', async (t) => {
  const w = await world(t, { modules: { [HOST_1]: new FakeRainbird({ rainSensor: false }) } });
  const keys = w.fake.discoveredDevices[0].features.map((f) => f.external_id.split(':').pop());
  assert.ok(!keys.includes('rain_sensor'));
  assert.ok(keys.includes('rain_delay'));
});

test('"Test the connection" reports each controller', async (t) => {
  const w = await world(t);
  w.module.active = new Set([2]);
  w.module.rainDelay = 2;
  const ack = await w.fake.action('test_connection', {});
  assert.equal(ack.success, true);
  assert.equal(
    ack.data.message.fr,
    'Rain Bird ESP-TM2 : OK, ESP-TM2, 7 zone(s), arrosage : Zone 2, délai de pluie 2 jour(s)',
  );
  w.module.online = false;
  const down = await w.fake.action('test_connection', {});
  assert.equal(down.data.message.en, 'Rain Bird ESP-TM2: does not answer');
});

test('a reconnection to Gladys sends everything again', async (t) => {
  const w = await world(t);
  await createAll(w);
  const count = w.fake.states.length;
  await w.gladys.disconnect();
  await w.gladys.connect();
  assert.ok(w.fake.states.length > count);
});

test('a refused password is tried again ten minutes later only (the module locks out)', async (t) => {
  const clock = createClock();
  const module = new FakeRainbird();
  const w = await world(t, {
    clock,
    modules: { [HOST_1]: module },
    config: { controller_1_host: HOST_1, controller_1_password: 'wrong' },
  });
  // A request with the wrong password does not decrypt: count it on the network.
  const attempts = () => w.network.calls.length;
  const first = attempts();
  for (let i = 0; i < 5; i += 1) {
    clock.advance(60_000);
    await w.hub.pollAll();
  }
  assert.equal(attempts(), first, 'no attempt for 5 minutes');
  clock.advance(6 * 60_000);
  await w.hub.pollAll();
  assert.equal(attempts(), first + 1);
  // The right password, typed in the configuration, is tried at once.
  await w.fake.configUpdated({ controller_1_host: HOST_1, controller_1_password: 'secret' });
  assert.equal(w.fake.discoveredDevices.length, 1);
});
