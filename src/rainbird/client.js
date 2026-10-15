// -----------------------------------------------------------------------------
// Local client of a Rain Bird LNK / LNK2 Wi-Fi module: encrypted JSON-RPC 2.0
// posted to `http(s)://<address>/stick` (the protocol of pyrainbird,
// allenporter/pyrainbird, MIT, rewritten here).
//
// What the module imposes, and how this client honors it:
//   - one request at a time: the module answers 503 (busy) to a second one,
//     and may refuse the Rain Bird app while a client talks to it. Requests
//     are queued, one in flight, with a short gap between two; a busy answer
//     is retried a few times, a second apart;
//   - HTTP on the older firmwares, HTTPS with a self-signed certificate on the
//     newer ones: without a scheme in the address, HTTPS is tried first, then
//     HTTP (the order of pyrainbird's `create_controller`), and the one that
//     answers is kept;
//   - the password encrypts every payload (src/rainbird/crypto.js): a wrong
//     one gets a 403, or an answer that does not decrypt to JSON.
//
// Errors carry a `kind` (ERROR_KINDS), the integration maps each to a text.
// Never the password nor the Wi-Fi settings in a message.
// -----------------------------------------------------------------------------

import { decryptPayload, encryptPayload } from './crypto.js';
import { httpRequest } from './http.js';
import { modelInfo } from './models.js';
import { decodeAnswer, encodeCommand, pagesFor, zonesOfMask } from './sip.js';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: off, wrong address, Wi-Fi down
  AUTH: 'auth', // password refused (403, lockout, or an answer that does not decrypt)
  BUSY: 'busy', // still busy after the retries (another client is talking to it)
  REFUSED: 'refused', // the controller refused the command (NAK)
  PROTOCOL: 'protocol', // anything else unexpected
});

export class RainbirdError extends Error {
  constructor(kind, message, { unsupported = false } = {}) {
    super(message);
    this.name = 'RainbirdError';
    this.kind = kind;
    this.unsupported = unsupported;
  }
}

export const CLIENT_TIMINGS = Object.freeze({
  gapMs: 250, // between two requests
  timeoutMs: 10_000, // per HTTP request
  busyRetries: 3, // after a 503 / "controller busy"
  busyDelayMs: 1_000, // times the attempt number
});

// The headers of pyrainbird, taken from the Rain Bird app.
const HEADERS = {
  'accept-language': 'en',
  'user-agent': 'RainBird/2.0 CFNetwork/811.5.4 Darwin/16.7.0',
  accept: '*/*',
  'content-type': 'application/octet-stream',
};

// JSON-RPC error codes of the module.
const RPC_LOCKOUT = -32001;
const RPC_BUSY = -32002;
const RPC_METHOD_NOT_FOUND = -32601;

// Transport failures after which plain HTTP is worth a try: the address
// answers, but not in TLS (or not in TLS this module understands).
const TRY_HTTP_AFTER = new Set(['ECONNREFUSED', 'ECONNRESET', 'EPROTO', 'EPIPE']);
const isTlsFailure = (err) =>
  TRY_HTTP_AFTER.has(err.code) ||
  /^ERR_SSL|^ERR_TLS/.test(err.code ?? '') ||
  /socket hang up|ssl|tls/i.test(err.message ?? '');

const defaultSleep = (ms) =>
  new Promise((resolve) => {
    if (ms <= 0) {
      resolve();
      return;
    }
    setTimeout(resolve, ms);
  });

export class RainbirdClient {
  /**
   * @param {object} options
   * @param {string} options.host `host` or `host:port`, no scheme
   * @param {'http'|'https'|null} [options.scheme] null: HTTPS, then HTTP
   * @param {string} options.password the module password
   * @param {Function} [options.request] HTTP seam (src/rainbird/http.js)
   * @param {object} [options.timings] CLIENT_TIMINGS overrides
   * @param {(ms: number) => Promise<void>} [options.sleep]
   * @param {() => number} [options.now]
   */
  constructor({ host, scheme = null, password, request, timings, sleep, now }) {
    this.host = host;
    this.fixedScheme = scheme;
    this.scheme = scheme;
    this.password = password ?? '';
    this.request = request ?? httpRequest;
    this.timings = { ...CLIENT_TIMINGS, ...timings };
    this.sleep = sleep ?? defaultSleep;
    this.now = now ?? (() => Date.now());
    this.queue = Promise.resolve();
    this.lastRequestAt = -Infinity;
    this.requestId = 0;
  }

  // --- Transport ---------------------------------------------------------------

  /**
   * One JSON-RPC call, after the calls already queued.
   * @returns {Promise<object>} the `result` of the answer
   */
  call(method, params = {}) {
    const run = this.queue.then(() => this.send(method, params));
    this.queue = run.catch(() => {});
    return run;
  }

  async send(method, params) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.sendOnce(method, params);
      } catch (err) {
        if (err.kind !== ERROR_KINDS.BUSY || attempt >= this.timings.busyRetries) {
          throw err;
        }
        await this.sleep(this.timings.busyDelayMs * (attempt + 1));
      }
    }
  }

  async sendOnce(method, params) {
    const wait = this.lastRequestAt + this.timings.gapMs - this.now();
    if (wait > 0) {
      await this.sleep(wait);
    }
    this.requestId += 1;
    const payload = JSON.stringify({ id: this.requestId, jsonrpc: '2.0', method, params });
    let response;
    try {
      response = await this.post(encryptPayload(payload, this.password));
    } finally {
      this.lastRequestAt = this.now();
    }
    return this.readAnswer(method, response);
  }

  /** POST to the known scheme, or find it: HTTPS first, then HTTP. */
  async post(body) {
    if (this.scheme) {
      try {
        return await this.postTo(this.scheme, body);
      } catch (err) {
        // The firmware may have moved between HTTP and HTTPS: look again
        // next time, unless the user typed the scheme.
        if (!this.fixedScheme && isTlsFailure(err.cause ?? {})) {
          this.scheme = null;
        }
        throw err;
      }
    }
    try {
      const response = await this.postTo('https', body);
      this.scheme = 'https';
      return response;
    } catch (err) {
      if (!isTlsFailure(err.cause ?? {})) {
        throw err;
      }
    }
    const response = await this.postTo('http', body);
    this.scheme = 'http';
    return response;
  }

  async postTo(scheme, body) {
    try {
      return await this.request(`${scheme}://${this.host}/stick`, {
        headers: HEADERS,
        body,
        insecure: true,
        timeoutMs: this.timings.timeoutMs,
      });
    } catch (err) {
      const error = new RainbirdError(
        ERROR_KINDS.UNREACHABLE,
        `${this.host} does not answer (${err.code ?? err.message})`,
      );
      error.cause = err;
      throw error;
    }
  }

  readAnswer(method, { status, body }) {
    if (status === 503) {
      throw new RainbirdError(ERROR_KINDS.BUSY, `${this.host} is busy (HTTP 503)`);
    }
    if (status === 403) {
      throw new RainbirdError(ERROR_KINDS.AUTH, `${this.host} refused the password (HTTP 403)`);
    }
    if (status !== 200) {
      throw new RainbirdError(ERROR_KINDS.PROTOCOL, `${this.host} answered HTTP ${status}`);
    }
    let answer;
    try {
      answer = JSON.parse(decryptPayload(body, this.password));
    } catch {
      throw new RainbirdError(
        ERROR_KINDS.AUTH,
        `${this.host}: the answer does not decrypt (wrong password, or not a Rain Bird module)`,
      );
    }
    if (answer?.error) {
      const code = answer.error.code;
      const text = String(answer.error.message ?? '').slice(0, 100);
      if (code === RPC_BUSY) {
        throw new RainbirdError(ERROR_KINDS.BUSY, `${this.host} is busy (${text})`);
      }
      if (code === RPC_LOCKOUT) {
        throw new RainbirdError(ERROR_KINDS.AUTH, `${this.host} locked the access (${text})`);
      }
      throw new RainbirdError(ERROR_KINDS.PROTOCOL, `${method}: error ${code} (${text})`, {
        unsupported: code === RPC_METHOD_NOT_FOUND,
      });
    }
    if (!answer || typeof answer !== 'object' || !('result' in answer)) {
      throw new RainbirdError(ERROR_KINDS.PROTOCOL, `${method}: answer without result`);
    }
    return answer.result;
  }

  /** A controller command, its answer checked and decoded (src/rainbird/sip.js). */
  async sip(name, ...args) {
    const { data, length } = encodeCommand(name, ...args);
    const result = await this.call('tunnelSip', { data, length });
    if (typeof result?.data !== 'string') {
      throw new RainbirdError(ERROR_KINDS.PROTOCOL, `${name}: answer without data`);
    }
    try {
      return decodeAnswer(name, result.data);
    } catch (err) {
      throw new RainbirdError(err.nack ? ERROR_KINDS.REFUSED : ERROR_KINDS.PROTOCOL, err.message);
    }
  }

  // --- Reading -------------------------------------------------------------------

  /** Model, its limits and the protocol revision. */
  async getModel() {
    const { modelId, major, minor } = await this.sip('modelAndVersion');
    return { ...modelInfo(modelId), protocol: `${major}.${minor}` };
  }

  /** 16 hex digits; all zeros on some controllers. */
  async getSerialNumber() {
    return (await this.sip('serialNumber')).serial;
  }

  async getFirmwareVersion() {
    const { major, minor, patch } = await this.sip('firmwareVersion');
    return `${major}.${minor}.${patch}`;
  }

  /**
   * The module's MAC address (the identity Home Assistant uses) and its
   * version. The same answer holds the Wi-Fi network name and password: they
   * are dropped here and never leave this function.
   * @returns {Promise<{ mac: string|null, stickVersion: string|null }>}
   */
  async getWifiParams() {
    const result = await this.call('getWifiParams');
    return {
      mac: typeof result?.macAddress === 'string' ? result.macAddress : null,
      stickVersion: typeof result?.stickVersion === 'string' ? result.stickVersion : null,
    };
  }

  /** Zones wired on the controller. */
  async getAvailableZones(maxStations) {
    const zones = [];
    for (let page = 0; page < pagesFor(maxStations); page += 1) {
      zones.push(...zonesOfMask((await this.sip('availableStations', page)).mask, page));
    }
    return zones;
  }

  /** Zones watering now. */
  async getActiveZones(maxStations) {
    const zones = [];
    for (let page = 0; page < pagesFor(maxStations); page += 1) {
      zones.push(...zonesOfMask((await this.sip('activeStations', page)).mask, page));
    }
    return zones;
  }

  async getRainSensor() {
    return (await this.sip('rainSensor')).raining;
  }

  async getRainDelay() {
    return (await this.sip('rainDelay')).days;
  }

  // --- Commands ------------------------------------------------------------------

  /** Water one zone for `minutes` (the controller stops it by itself). */
  runZone(zone, minutes) {
    return this.sip('runStation', zone, minutes);
  }

  /** Start a program: 0 for A, 1 for B… */
  runProgram(program) {
    return this.sip('runProgram', program);
  }

  stopIrrigation() {
    return this.sip('stopIrrigation');
  }

  /** Pause the schedule for `days` (0 cancels the delay). */
  setRainDelay(days) {
    return this.sip('setRainDelay', days);
  }
}
