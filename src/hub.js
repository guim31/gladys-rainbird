// -----------------------------------------------------------------------------
// The Rain Bird hub: one record per configured controller, identified once
// (model, zones, MAC address), read on a timer of the container, its states
// published to Gladys when they change, its scene events fired on watering
// transitions, and the commands of the switches, the widget and the scene
// actions.
//
// Gladys never polls these devices (should_poll: false): Gladys 5.2 does not
// poll reliably the devices of an external integration (GladysAssistant/
// Gladys#3198), and the module must be read one request at a time, which only
// the container can guarantee. The timer reads the controllers whose device
// was added to Gladys (and those not identified yet); the start, the
// "Search" of the Discovery tab and "Test the connection" read them all.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { parseMinutes } from './config.js';
import {
  PROGRAM_LETTERS,
  buildDevice,
  controllerName,
  describeFeature,
  deviceIds,
  featureValues,
  platformIdOf,
  programsOf,
  zoneKey,
  zoneName,
} from './devices.js';
import { ERROR_KINDS, RainbirdClient } from './rainbird/client.js';
import { modelInfo } from './rainbird/models.js';
import { ACTION_TEXT, CONNECTION_TEXT, ERROR_TEXT, REPORT_TEXT, labelled, pick } from './texts.js';

const logger = createLogger({ name: 'rainbird-hub' });

export const WIDGET_KEY = 'rainbird';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({
  STARTED: 'watering_started',
  FINISHED: 'watering_finished',
});

// Who started a watering (`origin` filter and variable of the triggers).
export const ORIGINS = Object.freeze({
  GLADYS: 'gladys', // a zone switch, a program button, the widget or a scene action
  CONTROLLER: 'controller', // its schedule, its dial, the Rain Bird app
});

export const HUB_TIMINGS = {
  // Model and zones change only when the controller is rewired: read again
  // every few hours, and on "Search" or "Test the connection".
  identityMs: 6 * 60 * 60_000,
  // A controller that fails once is read again this soon, to tell a blip
  // (the app talking to the module) from an outage.
  retryMs: 30_000,
  // Failures in a row before a controller counts as offline.
  downAfterFailures: 2,
  // A refused password is tried again this late only: the module has a
  // lockout (JSON-RPC -32001). A new password in the configuration is tried
  // at once.
  authRetryMs: 10 * 60_000,
  // A zone seen starting this long after a Gladys command is Gladys' own.
  ownStartMs: 2 * 60_000,
  // The controller shows a command a few seconds late: read it again then.
  confirmMs: 5_000,
  // An unchanged value is sent again this often (Gladys flags a value older
  // than 48 hours as stale).
  heartbeatMs: 6 * 60 * 60_000,
};

const emptySnapshot = () => ({
  reachable: null,
  activeZones: null,
  raining: null,
  rainDelay: null,
});

const signature = (controller) =>
  JSON.stringify([controller.host, controller.scheme, controller.password]);

const sameZones = (a, b) => a.length === b.length && a.every((zone, index) => zone === b[index]);

export class RainbirdHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {object} options.store persistence (src/store.js)
   * @param {Function} [options.request] HTTP seam (src/rainbird/http.js)
   * @param {object} [options.clientTimings] CLIENT_TIMINGS overrides
   * @param {boolean} [options.timers] periodic timers (off in most tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, store, request, clientTimings, timers = true, timings, now }) {
    this.gladys = gladys;
    this.store = store;
    this.request = request;
    this.clientTimings = clientTimings;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.now = now ?? (() => Date.now());
    this.config = null;
    /** @type {Map<number, object>} controller records, by slot */
    this.records = new Map();
    /** What is known of each slot, from /data: { [slot]: identity } */
    this.saved = { controllers: {} };
    this.transports = new Map();
    this.connection = null;
    this.pollTimer = null;
    this.stopped = false;
    /** Problems already logged, by key: repeats go to debug. */
    this.warned = new Set();
  }

  // --- Logs ------------------------------------------------------------------
  // Info keeps the lifecycle only (controllers connected, lost, back, user
  // commands). A problem that repeats every cycle is logged once at its own
  // level, then at debug until it clears. LOG_LEVEL=debug shows everything.

  /** Log a problem once (`level` warn or error), its repeats at debug. */
  problem(key, message, err, level = 'warn') {
    const args = err === undefined ? [message] : [message, err];
    if (this.warned.has(key)) {
      logger.debug(...args);
      return;
    }
    this.warned.add(key);
    logger[level](...args);
  }

  /** The problem `key` is gone: the next occurrence is logged again. */
  resolved(key, message) {
    if (this.warned.delete(key) && message) {
      logger.info(message);
    }
  }

  label(record) {
    return `${controllerName(record.controller, record.identity)} (${record.controller.host})`;
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    const saved = await this.store.load();
    this.saved = {
      controllers:
        saved.controllers && typeof saved.controllers === 'object' ? saved.controllers : {},
    };
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates();
    this.transports.clear();
    this.connection = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    this.config = config;
    const wanted = new Map(config.controllers.map((controller) => [controller.slot, controller]));
    for (const [slot, record] of this.records) {
      const controller = wanted.get(slot);
      if (!controller || record.signature !== signature(controller)) {
        this.dropRecord(record);
        this.records.delete(slot);
      }
    }
    for (const controller of config.controllers) {
      const record = this.records.get(controller.slot);
      if (record) {
        record.controller = controller; // a new name: same client
      } else {
        this.records.set(controller.slot, this.newRecord(controller));
      }
    }
    await this.publishDevices();
    await this.pollAll({ all: true });
    this.schedulePoll();
  }

  newRecord(controller) {
    const saved = this.saved.controllers[controller.slot];
    // What /data knows of this slot holds while the address is the same.
    const identity =
      saved && saved.host === controller.host && typeof saved.platformId === 'string'
        ? {
            platformId: saved.platformId,
            model: { ...modelInfo(saved.modelId ?? 0), protocol: saved.protocol ?? null },
            zones: Array.isArray(saved.zones) ? saved.zones.filter(Number.isInteger) : [],
            rainSensor: saved.rainSensor !== false,
            rainDelay: saved.rainDelay !== false,
          }
        : null;
    return {
      controller,
      signature: signature(controller),
      client: new RainbirdClient({
        host: controller.host,
        scheme: controller.scheme,
        password: controller.password,
        request: this.request,
        timings: this.clientTimings,
        now: this.now,
      }),
      identity,
      identifiedAt: 0, // read again at the first reading, even when known from /data
      snapshot: emptySnapshot(),
      error: null,
      failures: 0,
      down: false,
      downSince: null,
      lastReadAt: 0,
      /** When each zone watering was first seen (or commanded), by zone. */
      startedAt: new Map(),
      /** Who started each zone watering, by zone. */
      origins: new Map(),
      /** Zones Gladys started, until when a start counts as Gladys', by zone. */
      ownUntil: new Map(),
      polling: null,
      retryTimer: null,
      confirmTimer: null,
      dropped: false,
    };
  }

  dropRecord(record) {
    record.dropped = true;
    clearTimeout(record.retryTimer);
    clearTimeout(record.confirmTimer);
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    for (const record of this.records.values()) {
      this.dropRecord(record);
    }
    await this.store.flush();
  }

  schedulePoll() {
    clearTimeout(this.pollTimer);
    if (!this.timersEnabled || this.stopped || this.records.size === 0) {
      return;
    }
    this.pollTimer = setTimeout(async () => {
      try {
        await this.pollAll();
        this.resolved('poll');
      } catch (err) {
        this.problem('poll', 'Reading cycle failed', err, 'error');
      }
      this.schedulePoll();
    }, this.config.pollIntervalMs);
  }

  // --- Devices -----------------------------------------------------------------

  async publishDevices() {
    const devices = [...this.records.values()]
      .filter((record) => record.identity)
      .map((record) =>
        buildDevice(this.gladys, record.controller, record.identity, this.config.language),
      );
    // Even an empty list: the Discovery tab then shows no stale controller.
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.resolved('devices');
    } catch (err) {
      this.problem('devices', `Devices refused by Gladys: ${err.message}`);
    }
  }

  /** "Search" in the Discovery tab: identify and read every controller again. */
  async rediscover() {
    for (const record of this.records.values()) {
      record.identifiedAt = 0;
    }
    await this.pollAll({ all: true });
    await this.publishDevices();
  }

  /** The record of a device external id, null when it is not one of ours. */
  recordOf(deviceExternalId) {
    for (const record of this.records.values()) {
      if (
        record.identity &&
        deviceIds(this.gladys, record.identity.platformId).device === deviceExternalId
      ) {
        return record;
      }
    }
    return null;
  }

  isCreated(record) {
    if (!record.identity) {
      return false;
    }
    const id = deviceIds(this.gladys, record.identity.platformId).device;
    return (this.gladys.devices ?? []).some((device) => device.external_id === id);
  }

  /** The user added a device: its states sent before were dropped by Gladys. */
  async onDeviceCreated(device) {
    const record = this.recordOf(device.external_id);
    if (!record) {
      return;
    }
    this.gladys.forgetPublishedStates(device.external_id);
    await this.afterChanges(await this.poll(record));
    // The read may have failed: publish what is known anyway.
    await this.publishStates(record);
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  // --- Reading the controllers ----------------------------------------------------

  /**
   * Read the controllers. By default (the timer) only those whose device is
   * in Gladys, or not identified yet: the module serves one client at a time,
   * no request is spent on a controller nobody added.
   */
  async pollAll({ all = false } = {}) {
    const records = [...this.records.values()].filter(
      (record) =>
        all || ((!record.identity || this.isCreated(record)) && !this.waitingAfterRefusal(record)),
    );
    const changes = await Promise.all(records.map((record) => this.poll(record)));
    await this.afterChanges(changes.some(Boolean));
  }

  waitingAfterRefusal(record) {
    return (
      record.error?.kind === ERROR_KINDS.AUTH &&
      this.now() - record.lastReadAt < this.timings.authRetryMs
    );
  }

  /** Gladys asks for a refresh (onPoll): read that controller, unless just read. */
  async pollDevice(device) {
    const record = this.recordOf(device.external_id);
    if (
      !record ||
      this.waitingAfterRefusal(record) ||
      this.now() - record.lastReadAt < this.config.pollIntervalMs / 2
    ) {
      return;
    }
    await this.afterChanges(await this.poll(record));
  }

  /**
   * Read one controller and apply what changed. Concurrent calls share the read.
   * @returns {Promise<boolean>} whether the widget shows something new
   */
  poll(record) {
    record.polling ??= this.read(record).finally(() => {
      record.polling = null;
    });
    return record.polling;
  }

  async read(record) {
    record.lastReadAt = this.now();
    try {
      let identityChanged = false;
      if (!record.identity || this.now() - record.identifiedAt >= this.timings.identityMs) {
        identityChanged = await this.identify(record);
      }
      const { client, identity } = record;
      const activeZones = await client.getActiveZones(identity.model.maxStations);
      const raining = identity.rainSensor ? await client.getRainSensor() : null;
      const rainDelay = identity.rainDelay ? await client.getRainDelay() : null;
      if (identityChanged) {
        await this.publishDevices();
      }
      return (
        (await this.applySuccess(record, {
          activeZones: activeZones.filter((zone) => identity.zones.includes(zone)),
          raining,
          rainDelay,
        })) || identityChanged
      );
    } catch (err) {
      if (!err.kind) {
        throw err;
      }
      return this.applyFailure(record, err);
    }
  }

  /**
   * Model, identity and zones of a controller.
   * @returns {Promise<boolean>} whether the device changed (new, or rewired)
   */
  async identify(record) {
    const { client, controller } = record;
    const model = await client.getModel();
    let mac = null;
    try {
      mac = (await client.getWifiParams()).mac;
    } catch (err) {
      // An old module without the method: the serial number instead. Any
      // other failure (busy, no answer) is retried later, never a fallback
      // that would change the device identity.
      if (!err.unsupported) {
        throw err;
      }
    }
    let serial = null;
    if (!mac) {
      try {
        serial = await client.getSerialNumber();
      } catch (err) {
        if (err.kind !== ERROR_KINDS.REFUSED) {
          throw err;
        }
      }
    }
    const zones = await client.getAvailableZones(model.maxStations);
    if (zones.length === 0) {
      this.problem(
        `no-zone:${controller.slot}`,
        `${controller.host}: the controller reports no wired zone`,
      );
    } else {
      this.resolved(`no-zone:${controller.slot}`);
    }
    // Some controllers refuse a reading (NAK): no feature for it then.
    const rainSensor = await this.supports(() => client.getRainSensor());
    const rainDelay = await this.supports(() => client.getRainDelay());
    const identity = {
      platformId: platformIdOf({ mac, serial, slot: controller.slot }),
      model,
      zones,
      rainSensor,
      rainDelay,
    };
    const previous = record.identity;
    const changed =
      !previous ||
      previous.platformId !== identity.platformId ||
      previous.model.id !== model.id ||
      !sameZones(previous.zones, zones) ||
      previous.rainSensor !== rainSensor ||
      previous.rainDelay !== rainDelay;
    if (changed && previous) {
      logger.info(
        `${this.label(record)}: ${previous.platformId !== identity.platformId ? 'new identity' : 'zones or model changed'}`,
      );
    }
    record.identity = identity;
    record.identifiedAt = this.now();
    if (!model.known) {
      this.problem(
        `model:${controller.slot}`,
        `${controller.host}: unknown model ${model.id}, the common limits apply`,
      );
    }
    this.saved.controllers[controller.slot] = {
      host: controller.host,
      platformId: identity.platformId,
      modelId: parseInt(model.id, 16),
      protocol: model.protocol,
      zones,
      rainSensor,
      rainDelay,
    };
    this.store.save(this.saved);
    return changed;
  }

  /** Whether the controller accepts a reading: false when it refuses it (NAK). */
  async supports(read) {
    try {
      await read();
      return true;
    } catch (err) {
      if (err.kind !== ERROR_KINDS.REFUSED) {
        throw err;
      }
      return false;
    }
  }

  async applySuccess(record, next) {
    if (record.dropped) {
      return false;
    }
    let widgetChanged = record.snapshot.reachable !== true || record.error !== null;
    if (record.down) {
      const downMinutes = Math.round((this.now() - record.downSince) / 60_000);
      logger.info(`${this.label(record)} answers again after ${downMinutes} min`);
    } else if (record.error) {
      logger.info(`${this.label(record)}: connection restored`);
    } else if (record.snapshot.reachable === null) {
      const { model, zones } = record.identity;
      logger.info(
        `${this.label(record)}: connected, ${model.name || `model ${model.id}`}, ${zones.length} zone(s)`,
      );
    }
    record.failures = 0;
    record.down = false;
    record.downSince = null;
    record.error = null;

    const previous = record.snapshot;
    await this.wateringTransitions(record, previous.activeZones, next.activeZones);
    widgetChanged ||=
      !sameZones(previous.activeZones ?? [], next.activeZones) ||
      previous.raining !== next.raining ||
      previous.rainDelay !== next.rainDelay;
    record.snapshot = { reachable: true, ...next };
    logger.debug(
      `${this.label(record)}: watering [${next.activeZones}], rain ${next.raining}, delay ${next.rainDelay}`,
    );
    await this.publishStates(record);
    return widgetChanged;
  }

  async applyFailure(record, err) {
    if (record.dropped) {
      return false;
    }
    const wasError = record.error?.kind;
    record.error = { kind: err.kind, message: err.message };
    // One warning when the problem starts (or changes), not one per reading.
    if (wasError !== err.kind) {
      logger.warn(`${this.label(record)}: ${err.message}`);
    } else {
      logger.debug(`${this.label(record)}: ${err.message} (again)`);
    }
    if (err.kind !== ERROR_KINDS.UNREACHABLE) {
      record.failures = 0;
      return wasError !== err.kind;
    }
    record.failures += 1;
    if (record.failures === 1) {
      record.downSince = this.now();
      this.scheduleRetry(record);
    }
    if (!record.down && record.failures >= this.timings.downAfterFailures) {
      record.down = true;
      record.snapshot = { ...record.snapshot, reachable: false };
      await this.publishStates(record);
    }
    return wasError !== err.kind;
  }

  scheduleRetry(record) {
    clearTimeout(record.retryTimer);
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    record.retryTimer = setTimeout(() => {
      this.poll(record)
        .then((changed) => this.afterChanges(changed))
        .then(() => this.resolved('retry'))
        .catch((err) => this.problem('retry', 'Retry failed', err, 'error'));
    }, this.timings.retryMs);
    record.retryTimer.unref?.();
  }

  /** After a command: read the controller again once it shows the change. */
  scheduleConfirm(record) {
    clearTimeout(record.confirmTimer);
    if (!this.timersEnabled || this.stopped) {
      return;
    }
    record.confirmTimer = setTimeout(() => {
      this.poll(record)
        .then((changed) => this.afterChanges(changed))
        .then(() => this.resolved('confirm'))
        .catch((err) => this.problem('confirm', 'Reading after a command failed', err, 'error'));
    }, this.timings.confirmMs);
    record.confirmTimer.unref?.();
  }

  /** One scene event per zone that starts or stops watering. */
  async wateringTransitions(record, before, after) {
    const now = this.now();
    if (before === null) {
      // First reading: what waters now started before; no event.
      for (const zone of after) {
        record.startedAt.set(zone, null);
        record.origins.set(zone, this.ownStart(record, zone) ? ORIGINS.GLADYS : ORIGINS.CONTROLLER);
      }
      return;
    }
    for (const zone of before) {
      if (after.includes(zone)) {
        continue;
      }
      const startedAt = record.startedAt.get(zone);
      await this.fire(TRIGGERS.FINISHED, record, {
        zone,
        origin: record.origins.get(zone) ?? ORIGINS.CONTROLLER,
        minutes: typeof startedAt === 'number' ? Math.round((now - startedAt) / 60_000) : null,
      });
      record.startedAt.delete(zone);
      record.origins.delete(zone);
    }
    for (const zone of after) {
      if (before.includes(zone)) {
        continue;
      }
      const origin = this.ownStart(record, zone) ? ORIGINS.GLADYS : ORIGINS.CONTROLLER;
      record.startedAt.set(zone, now);
      record.origins.set(zone, origin);
      record.ownUntil.delete(zone);
      await this.fire(TRIGGERS.STARTED, record, { zone, origin });
    }
  }

  ownStart(record, zone) {
    return (record.ownUntil.get(zone) ?? 0) >= this.now();
  }

  async fire(key, record, data) {
    try {
      await this.gladys.publishSceneEvent(key, {
        device: deviceIds(this.gladys, record.identity.platformId).device,
        controller: controllerName(record.controller, record.identity),
        ...data,
      });
      this.resolved('scene-event');
    } catch (err) {
      this.problem('scene-event', `Scene event ${key} refused: ${err.message}`);
    }
  }

  // --- Publishing to Gladys ----------------------------------------------------------

  /**
   * Publish the states that changed (the SDK remembers what Gladys has), an
   * unchanged one again after `heartbeatMs`.
   * @param {object} record
   * @param {object} [snapshot] what to publish, the record's by default
   */
  async publishStates(record, snapshot = record.snapshot) {
    if (!record.identity) {
      return;
    }
    const states = featureValues(this.gladys, record.identity, snapshot)
      .filter(({ value }) => value !== null)
      .map(({ externalId, value }) => ({ device_feature_external_id: externalId, state: value }));
    if (states.length === 0) {
      return;
    }
    try {
      await this.gladys.publishChangedStates(states, { heartbeat: this.timings.heartbeatMs });
      this.resolved('states');
    } catch (err) {
      this.problem('states', `States of ${this.label(record)} refused: ${err.message}`);
    }
  }

  async afterChanges(widgetChanged) {
    await this.publishTransports();
    await this.publishConnectionStatus();
    if (widgetChanged) {
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }
  }

  async publishTransports() {
    const entries = [];
    for (const record of this.records.values()) {
      if (!record.identity || record.snapshot.reachable === null) {
        continue;
      }
      const externalId = deviceIds(this.gladys, record.identity.platformId).device;
      const transport = record.snapshot.reachable
        ? DEVICE_TRANSPORTS.LOCAL
        : DEVICE_TRANSPORTS.UNREACHABLE;
      if (this.transports.get(externalId) !== transport) {
        entries.push({ external_id: externalId, transport });
      }
    }
    if (entries.length === 0) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
      for (const entry of entries) {
        this.transports.set(entry.external_id, entry.transport);
      }
      this.resolved('transports');
    } catch (err) {
      this.problem('transports', `Transports refused: ${err.message}`);
    }
  }

  /** The status under the integration name: connected when every controller answers. */
  connectionStatus() {
    const { controllers, invalidSlots } = this.config;
    if (controllers.length === 0) {
      return {
        connected: false,
        message: invalidSlots.length ? CONNECTION_TEXT.invalidHost : CONNECTION_TEXT.noController,
      };
    }
    const failing = [...this.records.values()].filter((record) => record.error);
    if (failing.length === 0 && invalidSlots.length === 0) {
      return { connected: true };
    }
    const message = {};
    for (const language of Object.keys(CONNECTION_TEXT.noController)) {
      const parts = failing.map((record) =>
        labelled(
          controllerName(record.controller, record.identity),
          pick(ERROR_TEXT[record.error.kind], language),
          language,
        ),
      );
      if (invalidSlots.length) {
        parts.push(pick(CONNECTION_TEXT.invalidHost, language));
      }
      message[language] = parts.join(' · ').slice(0, 200);
    }
    // Connected while one controller of several still answers.
    return { connected: failing.length < this.records.size, message };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.resolved('connection-status');
    } catch (err) {
      this.problem('connection-status', `Connection status refused: ${err.message}`);
    }
  }

  // --- Commands --------------------------------------------------------------------------

  language() {
    return this.config?.language ?? 'en';
  }

  fail(text) {
    throw new Error(pick(text, this.language()));
  }

  /**
   * The controllers a command targets: one device, or every configured one.
   * @param {string|null|undefined} deviceExternalId
   */
  targets(deviceExternalId) {
    if (this.records.size === 0) {
      this.fail(ACTION_TEXT.noController);
    }
    if (!deviceExternalId) {
      return [...this.records.values()];
    }
    const record = this.recordOf(deviceExternalId);
    if (!record) {
      this.fail(ACTION_TEXT.unknownController);
    }
    return [record];
  }

  /** The one controller a command needs: the chosen one, else the only one. */
  target(deviceExternalId) {
    const records = this.targets(deviceExternalId);
    const record = records.find((candidate) => candidate.identity) ?? null;
    if (!record) {
      this.fail(ACTION_TEXT.notIdentified);
    }
    return record;
  }

  /** Run a command on a controller; a failure is reported in the user's language. */
  async command(record, run, description) {
    try {
      await run(record.client);
    } catch (err) {
      if (!err.kind) {
        throw err;
      }
      logger.warn(`${this.label(record)}: ${description} failed: ${err.message}`);
      if (err.kind === ERROR_KINDS.UNREACHABLE) {
        await this.applyFailure(record, err);
        await this.afterChanges(true);
      }
      throw new Error(
        labelled(
          controllerName(record.controller, record.identity),
          pick(ERROR_TEXT[err.kind], this.language()),
          this.language(),
        ),
        { cause: err },
      );
    }
    logger.info(`${this.label(record)}: ${description}`);
  }

  /**
   * Water a zone for some minutes (the configured length by default).
   * @returns {Promise<{ zone: number, minutes: number }>}
   */
  async waterZone(deviceExternalId, zone, minutes = this.config.zoneMinutes) {
    const record = this.target(deviceExternalId);
    const number = Number(zone);
    if (!record.identity.zones.includes(number)) {
      this.fail(ACTION_TEXT.unknownZone);
    }
    const length = Math.min(
      parseMinutes(minutes, this.config.zoneMinutes),
      record.identity.model.maxRunMinutes,
      255,
    );
    await this.command(
      record,
      (client) => client.runZone(number, length),
      `zone ${number} watering for ${length} min`,
    );
    record.ownUntil.set(number, this.now() + this.timings.ownStartMs);
    // The controller shows it a few seconds late: show it now, check soon.
    const ids = deviceIds(this.gladys, record.identity.platformId);
    await this.publishOptimistic(record, [{ externalId: ids.feature(zoneKey(number)), value: 1 }]);
    this.scheduleConfirm(record);
    return { zone: number, minutes: length };
  }

  /** Stop every zone, on one controller or all of them. Resolves with the number stopped. */
  async stopWatering(deviceExternalId) {
    const records = this.targets(deviceExternalId).filter((record) => record.identity);
    if (records.length === 0) {
      this.fail(ACTION_TEXT.notIdentified);
    }
    const results = await Promise.all(
      records.map(async (record) => {
        try {
          await this.command(record, (client) => client.stopIrrigation(), 'watering stopped');
        } catch (err) {
          if (records.length === 1) {
            throw err;
          }
          return false;
        }
        const ids = deviceIds(this.gladys, record.identity.platformId);
        await this.publishOptimistic(
          record,
          record.identity.zones.map((zone) => ({
            externalId: ids.feature(zoneKey(zone)),
            value: 0,
          })),
        );
        this.scheduleConfirm(record);
        return true;
      }),
    );
    const done = results.filter(Boolean).length;
    if (done === 0) {
      this.fail(ACTION_TEXT.failed);
    }
    return done;
  }

  /**
   * Start a program (0 = A).
   * @returns {Promise<string>} its letter
   */
  async runProgram(deviceExternalId, program) {
    const record = this.target(deviceExternalId);
    const index =
      typeof program === 'string'
        ? PROGRAM_LETTERS.indexOf(program.toUpperCase())
        : Number(program);
    if (!programsOf(record.identity.model).includes(index)) {
      this.fail(ACTION_TEXT.unknownProgram);
    }
    const letter = PROGRAM_LETTERS[index];
    await this.command(record, (client) => client.runProgram(index), `program ${letter} started`);
    // Its zones start under the program: they are Gladys' too.
    for (const zone of record.identity.zones) {
      record.ownUntil.set(zone, this.now() + this.timings.ownStartMs);
    }
    this.scheduleConfirm(record);
    return letter;
  }

  /**
   * Pause the schedule for some days (0 cancels the delay).
   * @returns {Promise<number>} the days set
   */
  async setRainDelay(deviceExternalId, days) {
    const record = this.target(deviceExternalId);
    const number = Number(days);
    const value = Math.min(
      record.identity.model.maxRainDelayDays,
      Math.max(0, Math.round(Number.isFinite(number) ? number : 0)),
    );
    await this.command(
      record,
      (client) => client.setRainDelay(value),
      `rain delay set to ${value} day(s)`,
    );
    record.snapshot = { ...record.snapshot, rainDelay: value };
    await this.publishStates(record);
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
    return value;
  }

  async publishOptimistic(record, values) {
    try {
      await this.gladys.publishChangedStates(
        values.map(({ externalId, value }) => ({
          device_feature_external_id: externalId,
          state: value,
        })),
      );
    } catch (err) {
      this.problem('states', `States of ${this.label(record)} refused: ${err.message}`);
    }
    this.gladys.requestWidgetRefresh(WIDGET_KEY);
  }

  /** A command on a device feature: a zone switch, a button, the rain delay. */
  async setValue(device, feature, value) {
    const record = this.recordOf(device.external_id);
    if (!record) {
      this.fail(ACTION_TEXT.unknownController);
    }
    const target = describeFeature(this.gladys, record.identity, feature.external_id);
    switch (target.kind) {
      case 'zone':
        if (Number(value) === 1) {
          await this.waterZone(device.external_id, target.zone);
        } else {
          await this.stopWatering(device.external_id);
        }
        return;
      case 'stop':
        await this.stopWatering(device.external_id);
        return;
      case 'program':
        await this.runProgram(device.external_id, target.program);
        return;
      case 'rain_delay':
        await this.setRainDelay(device.external_id, value);
        return;
      default:
        throw new Error(`Feature ${feature.external_id} cannot be controlled`);
    }
  }

  // --- Reports -------------------------------------------------------------------------------

  /** "Test the connection": identify and read every controller now, one line each. */
  async testConnection() {
    for (const record of this.records.values()) {
      record.identifiedAt = 0;
    }
    await this.pollAll({ all: true });
    await this.publishDevices();
    const message = {};
    for (const [language, text] of Object.entries(REPORT_TEXT)) {
      if (this.records.size === 0) {
        message[language] = pick(this.connectionStatus().message, language);
        continue;
      }
      const lines = [...this.records.values()].map((record) => {
        const name = controllerName(record.controller, record.identity);
        if (record.error) {
          return labelled(name, pick(ERROR_TEXT[record.error.kind], language), language);
        }
        if (!record.identity || record.snapshot.activeZones === null) {
          return labelled(name, text.waiting, language);
        }
        const { activeZones, raining, rainDelay } = record.snapshot;
        const parts = ['OK', record.identity.model.name || record.identity.model.id];
        parts.push(text.zones(record.identity.zones.length));
        parts.push(
          activeZones.length
            ? text.watering(activeZones.map((zone) => zoneName(zone, language)).join(', '))
            : text.idle,
        );
        if (raining) {
          parts.push(text.raining);
        }
        if (rainDelay) {
          parts.push(text.delay(rainDelay));
        }
        return labelled(name, parts.join(', '), language);
      });
      if (this.config.invalidSlots.length) {
        lines.push(pick(CONNECTION_TEXT.invalidHost, language));
      }
      message[language] = lines.join('\n');
    }
    return message;
  }

  /** The controller a widget shows: the one chosen, else the first configured. */
  view(deviceExternalId) {
    if (deviceExternalId) {
      return this.recordOf(deviceExternalId);
    }
    return [...this.records.values()][0] ?? null;
  }
}
