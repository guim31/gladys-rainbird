#!/usr/bin/env node
// -----------------------------------------------------------------------------
// Read-only probe of a real Rain Bird LNK / LNK2 module, with the client of
// the integration (src/rainbird/client.js). It sends no command: model,
// firmware, zones, zones watering, rain sensor, rain delay, and how the module
// answers a wrong password. Nothing sensitive is printed: no password, no
// Wi-Fi setting, the MAC address and the serial number shortened.
//
//   RAINBIRD_PASSWORD='…' node scripts/probe.mjs 192.168.1.20
//   node scripts/probe.mjs 192.168.1.20          # wrong-password check only
//
// The password goes through the environment, not the command line (shell
// history, process list). `--raw` also prints the hex answers of the
// controller (no secret in them), to turn into test fixtures.
// -----------------------------------------------------------------------------

import { parseHost } from '../src/config.js';
import { RainbirdClient } from '../src/rainbird/client.js';
import { httpRequest } from '../src/rainbird/http.js';
import { encodeCommand } from '../src/rainbird/sip.js';

const args = process.argv.slice(2);
const raw = args.includes('--raw');
const address = parseHost(args.find((arg) => !arg.startsWith('--')) ?? '');
if (!address) {
  console.error('Usage: RAINBIRD_PASSWORD=… node scripts/probe.mjs <ip[:port]> [--raw]');
  process.exit(2);
}

const shorten = (value) =>
  typeof value === 'string' && value.length > 4 ? `…${value.slice(-4)}` : '(none)';

/** A request seam that also notes what the module answered (status, size). */
function tracingRequest(trace) {
  return async (url, options) => {
    const scheme = new URL(url).protocol.slice(0, -1);
    try {
      const response = await httpRequest(url, options);
      trace.push(`${scheme}: HTTP ${response.status}, ${response.body.length} bytes`);
      return response;
    } catch (err) {
      trace.push(`${scheme}: ${err.code ?? err.message}`);
      throw err;
    }
  };
}

async function step(label, run) {
  try {
    const value = await run();
    console.log(`  ${label}: ${value}`);
    return value;
  } catch (err) {
    console.log(`  ${label}: FAILED (${err.kind ?? 'error'}) ${err.message}`);
    return undefined;
  }
}

async function wrongPassword() {
  console.log('\nWrong password (expected: refused):');
  const trace = [];
  const client = new RainbirdClient({
    ...address,
    password: 'gladys-probe-not-the-password',
    request: tracingRequest(trace),
  });
  await step('model', async () => (await client.getModel()).name);
  console.log(`  transport: ${trace.join(' | ')}`);
}

async function realPassword(password) {
  console.log('\nWith RAINBIRD_PASSWORD:');
  const trace = [];
  const client = new RainbirdClient({ ...address, password, request: tracingRequest(trace) });
  const sip = async (name, ...commandArgs) => {
    const { data, length } = encodeCommand(name, ...commandArgs);
    const result = await client.call('tunnelSip', { data, length });
    return `${data} -> ${result?.data}`;
  };
  const model = await step('model', async () => {
    const info = await client.getModel();
    return `${info.name || 'unknown'} (id ${info.id}, protocol ${info.protocol})`;
  });
  console.log(`  scheme kept: ${client.scheme ?? '(none)'}`);
  if (model === undefined) {
    console.log(`  transport: ${trace.join(' | ')}`);
    return;
  }
  const info = await client.getModel();
  await step('firmware', () => client.getFirmwareVersion());
  await step('MAC address (shortened)', async () => shorten((await client.getWifiParams()).mac));
  await step('module version', async () => (await client.getWifiParams()).stickVersion);
  await step('serial number (shortened)', async () => shorten(await client.getSerialNumber()));
  await step('zones wired', async () =>
    (await client.getAvailableZones(info.maxStations)).join(', '),
  );
  await step(
    'zones watering',
    async () => (await client.getActiveZones(info.maxStations)).join(', ') || 'none',
  );
  await step('rain sensor', async () => ((await client.getRainSensor()) ? 'rain' : 'dry'));
  await step('rain delay (days)', () => client.getRainDelay());
  if (raw) {
    console.log('\nRaw answers (hex, no secret):');
    for (const [name, ...commandArgs] of [
      ['modelAndVersion'],
      ['firmwareVersion'],
      ['availableStations', 0],
      ['activeStations', 0],
      ['rainSensor'],
      ['rainDelay'],
    ]) {
      await step(name, () => sip(name, ...commandArgs));
    }
  }
}

console.log(`Rain Bird probe of ${address.host} (read only, no command sent)`);
await wrongPassword();
if (process.env.RAINBIRD_PASSWORD) {
  await realPassword(process.env.RAINBIRD_PASSWORD);
} else {
  console.log('\nSet RAINBIRD_PASSWORD to read the controller.');
}
