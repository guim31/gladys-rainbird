// -----------------------------------------------------------------------------
// In-memory Rain Bird LNK module behind the `request` seam of the client
// (src/rainbird/http.js), with its encryption: it decrypts each request with
// its own password, runs the controller command and encrypts the answer. The
// answers are built like those of test/fixtures/rainbird/sip-answers.json
// (recorded on real controllers by pyrainbird and Home Assistant).
//
// The behaviors that matter: one scheme (HTTP or HTTPS), a wrong password
// (403), a busy module (503), a controller that refuses a command (NAK), an
// old module without getWifiParams, a module that does not answer. Also
// served over real HTTP by `serve()` for the end-to-end test.
// -----------------------------------------------------------------------------

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { decryptPayload, encryptPayload } from '../../src/rainbird/crypto.js';

export const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/rainbird/${name}.json`, import.meta.url), 'utf8'));

const WIFI_PARAMS = fixture('sip-answers').wifiParams.result;
const hex = (value, digits) => Number(value).toString(16).toUpperCase().padStart(digits, '0');

/** A zone mask page (4 bytes, zone 1 = lowest bit of the first byte). */
function maskOf(zones, page) {
  let mask = '';
  for (let byte = 0; byte < 4; byte += 1) {
    let value = 0;
    for (let bit = 0; bit < 8; bit += 1) {
      if (zones.has(page * 32 + byte * 8 + bit + 1)) {
        value |= 1 << bit;
      }
    }
    mask += hex(value, 2);
  }
  return mask;
}

export class FakeRainbird {
  /**
   * @param {object} [options]
   * @param {string} [options.password]
   * @param {number} [options.modelId] 5 = ESP-TM2 (12 zones, 3 programs)
   * @param {number[]} [options.zones] zones wired
   * @param {'http'|'https'} [options.scheme] the one the module serves
   * @param {string|null} [options.mac] null: no getWifiParams (old module)
   * @param {string} [options.serial] 16 hex digits
   * @param {boolean} [options.rainSensor] false: the controller refuses the reading
   */
  constructor({
    password = 'secret',
    modelId = 5,
    zones = [1, 2, 3, 4, 5, 6, 7],
    scheme = 'http',
    mac = WIFI_PARAMS.macAddress,
    serial = '0000012635436566',
    rainSensor = true,
  } = {}) {
    this.password = password;
    this.modelId = modelId;
    this.zones = new Set(zones);
    this.scheme = scheme;
    this.mac = mac;
    this.serial = serial;
    this.rainSensorSupported = rainSensor;
    this.online = true;
    this.active = new Set();
    this.raining = false;
    this.rainDelay = 0;
    this.lastRun = null; // { zone, minutes } or { program }
    this.busy = 0; // the next N requests get a 503
    this.busyFor = new Set(); // JSON-RPC methods always answered 503
    this.requests = []; // decoded JSON-RPC requests
  }

  /** Commands received (tunnelSip data), in order. */
  get commands() {
    return this.requests
      .filter((request) => request.method === 'tunnelSip')
      .map((request) => request.params.data);
  }

  /** The `request` seam: (url, { body }) → { status, body }. */
  handle(url, { body }) {
    let request;
    try {
      request = JSON.parse(decryptPayload(body, this.password));
    } catch {
      return { status: 403, body: Buffer.alloc(0) };
    }
    this.requests.push(request);
    if (this.busy > 0 || this.busyFor.has(request.method)) {
      this.busy = Math.max(0, this.busy - 1);
      return { status: 503, body: Buffer.alloc(0) };
    }
    return { status: 200, body: this.answer(request) };
  }

  answer(request) {
    const reply = (payload) =>
      encryptPayload(JSON.stringify({ jsonrpc: '2.0', id: request.id, ...payload }), this.password);
    if (request.method === 'getWifiParams') {
      if (!this.mac) {
        return reply({ error: { code: -32601, message: 'Method not found' } });
      }
      return reply({ result: { ...WIFI_PARAMS, macAddress: this.mac } });
    }
    if (request.method !== 'tunnelSip') {
      return reply({ error: { code: -32601, message: 'Method not found' } });
    }
    return reply({ result: { data: this.sip(request.params.data), length: 0 } });
  }

  sip(data) {
    const code = data.slice(0, 2);
    const ack = `01${code}`;
    switch (code) {
      case '02':
        return `82${hex(this.modelId, 4)}090C`;
      case '03':
        return `83${data.slice(2, 4)}${maskOf(this.zones, parseInt(data.slice(2, 4), 16))}`;
      case '05':
        return `85${this.serial}`;
      case '0B':
        return '8B012F0000';
      case '36':
        return `B6${hex(this.rainDelay, 4)}`;
      case '37':
        this.rainDelay = parseInt(data.slice(2, 6), 16);
        return ack;
      case '38':
        this.lastRun = { program: parseInt(data.slice(2, 4), 16) };
        this.active = new Set([Math.min(...this.zones)]);
        return ack;
      case '39': {
        const zone = parseInt(data.slice(2, 6), 16);
        if (!this.zones.has(zone)) {
          return `00${code}04`;
        }
        this.lastRun = { zone, minutes: parseInt(data.slice(6, 8), 16) };
        this.active = new Set([zone]);
        return ack;
      }
      case '3E':
        return this.rainSensorSupported ? `BE${this.raining ? '01' : '00'}` : `00${code}00`;
      case '3F':
        return `BF${data.slice(2, 4)}${maskOf(this.active, parseInt(data.slice(2, 4), 16))}`;
      case '40':
        this.active = new Set();
        return ack;
      default:
        return `00${code}00`;
    }
  }

  /**
   * Serve this module over real HTTP on 127.0.0.1 (end-to-end test).
   * @returns {Promise<{ host: string, close: () => Promise<void> }>}
   */
  async serve() {
    const server = createServer((req, res) => {
      const chunks = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => {
        if (req.method !== 'POST' || req.url !== '/stick') {
          res.writeHead(404).end();
          return;
        }
        const { status, body } = this.handle(req.url, { body: Buffer.concat(chunks) });
        res.writeHead(status, { 'content-type': 'application/octet-stream' }).end(body);
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    return {
      host: `127.0.0.1:${server.address().port}`,
      close: () =>
        new Promise((resolve) => {
          server.closeAllConnections?.();
          server.close(() => resolve());
        }),
    };
  }
}

const networkError = (code) => Object.assign(new Error(`connect ${code}`), { code });

/**
 * A network of fake modules, by host (`192.0.2.10`, `192.0.2.11:8080`).
 * A host without module does not answer; a module answers on its scheme only.
 */
export function createNetwork(modules = {}) {
  const byHost = new Map(Object.entries(modules));
  const calls = [];
  return {
    modules: byHost,
    calls,
    async request(url, options) {
      const target = new URL(url);
      calls.push(`${target.protocol}//${target.host}`);
      const module = byHost.get(target.host);
      if (!module || !module.online) {
        throw networkError('ETIMEDOUT');
      }
      if (target.protocol !== `${module.scheme}:`) {
        // HTTPS to an HTTP-only module: the TLS handshake fails; HTTP to an
        // HTTPS-only module: nothing listens on port 80.
        throw networkError(module.scheme === 'http' ? 'EPROTO' : 'ECONNREFUSED');
      }
      return module.handle(url, options);
    },
  };
}
