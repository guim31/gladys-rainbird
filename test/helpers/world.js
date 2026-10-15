// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, fake Rain Bird modules on a
// fake network, a temporary /data and a manual clock, with the integration
// wired on top through registerHandlers. No timer runs unless `timers: true`
// (with node:test mock timers): the tests read the controllers with
// `world.hub.pollAll()`.
// -----------------------------------------------------------------------------

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { Store } from '../../src/store.js';
import { platformIdOf } from '../../src/devices.js';
import { FakeRainbird, createNetwork } from './fakeRainbird.js';

// The integration logs every change; keep the test output readable.
process.env.LOG_LEVEL ??= 'silent';

export const HOST_1 = '192.0.2.10';
export const HOST_2 = '192.0.2.11';
export const MAC_1 = '02:00:5E:10:00:01';
export const MAC_2 = '02:00:5E:10:00:02';

// No waiting between requests nor before a retry: the fake answers at once.
export const FAST_CLIENT = { gapMs: 0, busyDelayMs: 0 };

/** A manual clock. */
export function createClock(start = Date.UTC(2026, 9, 14, 6, 0, 0)) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

/**
 * @param {object} [options]
 * @param {Record<string, FakeRainbird>} [options.modules] by host
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {boolean} [options.connect]
 */
export async function createWorld({
  clock = createClock(),
  modules,
  config = {
    controller_1_host: HOST_1,
    controller_1_password: 'secret',
    language: 'en',
  },
  devices = [],
  connect = true,
  dataDir = mkdtempSync(join(tmpdir(), 'gladys-rainbird-')),
  timings = {},
  clientTimings = FAST_CLIENT,
  timers = false,
} = {}) {
  const network = createNetwork(modules ?? { [HOST_1]: new FakeRainbird() });
  const gladys = createFakeGladys({ config, devices });
  const app = registerHandlers(gladys, {
    store: new Store(dataDir),
    request: network.request,
    clientTimings,
    timers,
    timings,
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
  }
  return {
    gladys,
    fake: gladys.fake,
    network,
    module: network.modules.get(HOST_1),
    app,
    hub: app.hub,
    clock,
    dataDir,
  };
}

/** External ids of the device of a module, by its MAC address. */
export const idsOf = (gladys, mac = MAC_1) =>
  gladys.externalIds('controller', platformIdOf({ mac, slot: 1 }));
export const deviceId = (gladys, mac = MAC_1) => idsOf(gladys, mac).device;
export const featureId = (gladys, key, mac = MAC_1) => idsOf(gladys, mac).feature(key);

/** Add every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
}

export { FakeRainbird };
