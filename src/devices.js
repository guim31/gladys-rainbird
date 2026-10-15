// -----------------------------------------------------------------------------
// One Gladys device per Rain Bird controller.
//
// Identity: the MAC address of the Wi-Fi module (as Home Assistant does), else
// the controller serial number when it is not all zeros, else the slot of the
// configuration. Changing the address of the controller keeps its device.
//
// Features (category/type couples of the core table, checked by
// test/gladys-rules.test.js):
//   - zone_<n>      switch/binary, one per zone wired on the controller (the
//                   zones of its "available stations" mask): 1 = watering. On
//                   waters the zone for the minutes of the configuration (the
//                   controller stops it by itself), off stops the watering —
//                   the controller has no "stop this zone only" command;
//   - rain_sensor   rain-sensor/binary, read only: 1 = rain detected (a sensor
//                   wired to the controller; 0 when there is none);
//   - rain_delay    duration/decimal in days, writable: the schedule is paused
//                   that many days (0: no delay), up to the model's limit;
//                   (these two only when the controller accepts their reading:
//                   some answer it with a NAK, a feature would stay empty)
//   - online        presence-sensor/binary, read only: the controller answers;
//   - stop          button/push: stop every zone;
//   - program_<a…h> button/push, one per program of the model (A to H at
//                   most): start that program as if it were its start time.
//
// The devices are published with should_poll: false: the integration reads
// the controllers on its own timer (src/hub.js), one request at a time.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

export const DEVICE_TYPE = 'controller';
export const HOST_PARAM = 'RAINBIRD_HOST';
export const MODEL_PARAM = 'RAINBIRD_MODEL';

// Programs offered at most (A to H): the residential models have 3 or 4.
export const MAX_PROGRAMS = 8;
export const PROGRAM_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  RAIN_SENSOR: 'rain_sensor',
  RAIN_DELAY: 'rain_delay',
  ONLINE: 'online',
  STOP: 'stop',
});
export const zoneKey = (zone) => `zone_${zone}`;
export const programKey = (program) => `program_${PROGRAM_LETTERS[program].toLowerCase()}`;

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language). Frozen at creation in Gladys.
export const NAMES = {
  en: {
    zone: (zone) => `Zone ${zone}`,
    [FEATURE_KEYS.RAIN_SENSOR]: 'Rain sensor',
    [FEATURE_KEYS.RAIN_DELAY]: 'Rain delay',
    [FEATURE_KEYS.ONLINE]: 'Online',
    [FEATURE_KEYS.STOP]: 'Stop watering',
    program: (letter) => `Run program ${letter}`,
  },
  fr: {
    zone: (zone) => `Zone ${zone}`,
    [FEATURE_KEYS.RAIN_SENSOR]: 'Capteur de pluie',
    [FEATURE_KEYS.RAIN_DELAY]: 'Délai de pluie',
    [FEATURE_KEYS.ONLINE]: 'En ligne',
    [FEATURE_KEYS.STOP]: "Arrêter l'arrosage",
    program: (letter) => `Lancer le programme ${letter}`,
  },
  de: {
    zone: (zone) => `Zone ${zone}`,
    [FEATURE_KEYS.RAIN_SENSOR]: 'Regensensor',
    [FEATURE_KEYS.RAIN_DELAY]: 'Regenpause',
    [FEATURE_KEYS.ONLINE]: 'Online',
    [FEATURE_KEYS.STOP]: 'Bewässerung stoppen',
    program: (letter) => `Programm ${letter} starten`,
  },
  es: {
    zone: (zone) => `Zona ${zone}`,
    [FEATURE_KEYS.RAIN_SENSOR]: 'Sensor de lluvia',
    [FEATURE_KEYS.RAIN_DELAY]: 'Retraso por lluvia',
    [FEATURE_KEYS.ONLINE]: 'En línea',
    [FEATURE_KEYS.STOP]: 'Detener el riego',
    program: (letter) => `Iniciar el programa ${letter}`,
  },
};

const names = (language) => NAMES[language] ?? NAMES.en;

/** The name of a zone in a language (widget, messages). */
export const zoneName = (zone, language) => names(language).zone(zone);

/**
 * The platform id of a controller: its MAC address, else its serial number,
 * else its configuration slot.
 * @param {{ mac?: string|null, serial?: string|null, slot: number }} identity
 */
export function platformIdOf({ mac, serial, slot }) {
  const hexMac = typeof mac === 'string' ? mac.toLowerCase().replace(/[^0-9a-f]/g, '') : '';
  if (hexMac.length === 12 && !/^0+$/.test(hexMac)) {
    return hexMac;
  }
  const hexSerial = typeof serial === 'string' ? serial.toLowerCase() : '';
  if (/^[0-9a-f]+$/.test(hexSerial) && !/^0+$/.test(hexSerial)) {
    return `sn${hexSerial}`;
  }
  return `slot${slot}`;
}

/** External ids of a controller's device and features. */
export const deviceIds = (gladys, platformId) => gladys.externalIds(DEVICE_TYPE, platformId);

/** The programs a model offers, as indexes (0 = A). */
export const programsOf = (model) =>
  Array.from({ length: Math.min(MAX_PROGRAMS, model?.maxPrograms ?? 0) }, (_, index) => index);

/** The name shown for a controller: the one typed, else "Rain Bird <model>". */
export function controllerName(controller, identity) {
  if (controller.name) {
    return controller.name;
  }
  return identity?.model?.name
    ? `Rain Bird ${identity.model.name}`
    : `Rain Bird ${controller.host}`;
}

const binary = (category, extra = {}) => ({
  category,
  type: DEVICE_FEATURE_TYPES.SENSOR.BINARY,
  read_only: true,
  has_feedback: false,
  keep_history: true,
  min: 0,
  max: 1,
  ...extra,
});

const push = () => ({
  category: DEVICE_FEATURE_CATEGORIES.BUTTON,
  type: DEVICE_FEATURE_TYPES.BUTTON.PUSH,
  read_only: false,
  has_feedback: false,
  keep_history: false,
  min: 0,
  max: 1,
});

/**
 * The features of a controller, in display order.
 * @returns {Array<{ key: string, definition: object, name: (language: string) => string }>}
 */
export function featuresOf(identity) {
  const features = identity.zones.map((zone) => ({
    key: zoneKey(zone),
    zone,
    definition: {
      category: DEVICE_FEATURE_CATEGORIES.SWITCH,
      type: DEVICE_FEATURE_TYPES.SWITCH.BINARY,
      read_only: false,
      has_feedback: true,
      keep_history: true,
      min: 0,
      max: 1,
    },
    name: (language) => names(language).zone(zone),
  }));
  if (identity.rainSensor !== false) {
    features.push({
      key: FEATURE_KEYS.RAIN_SENSOR,
      definition: binary(DEVICE_FEATURE_CATEGORIES.RAIN_SENSOR),
      name: (language) => names(language)[FEATURE_KEYS.RAIN_SENSOR],
    });
  }
  if (identity.rainDelay !== false) {
    features.push({
      key: FEATURE_KEYS.RAIN_DELAY,
      definition: {
        category: DEVICE_FEATURE_CATEGORIES.DURATION,
        type: DEVICE_FEATURE_TYPES.DURATION.DECIMAL,
        unit: DEVICE_FEATURE_UNITS.DAYS,
        read_only: false,
        has_feedback: true,
        keep_history: true,
        min: 0,
        max: identity.model.maxRainDelayDays,
      },
      name: (language) => names(language)[FEATURE_KEYS.RAIN_DELAY],
    });
  }
  features.push(
    {
      key: FEATURE_KEYS.ONLINE,
      definition: binary(DEVICE_FEATURE_CATEGORIES.PRESENCE_SENSOR),
      name: (language) => names(language)[FEATURE_KEYS.ONLINE],
    },
    {
      key: FEATURE_KEYS.STOP,
      definition: push(),
      name: (language) => names(language)[FEATURE_KEYS.STOP],
    },
    ...programsOf(identity.model).map((program) => ({
      key: programKey(program),
      program,
      definition: push(),
      name: (language) => names(language).program(PROGRAM_LETTERS[program]),
    })),
  );
  return features;
}

/**
 * The discovery payload of a controller.
 * @param {object} gladys SDK client
 * @param {{ slot: number, host: string, name: string|null }} controller
 * @param {{ platformId: string, model: object, zones: number[] }} identity
 * @param {string} language feature names language
 */
export function buildDevice(gladys, controller, identity, language = 'fr') {
  const ids = deviceIds(gladys, identity.platformId);
  return {
    name: controllerName(controller, identity),
    external_id: ids.device,
    should_poll: false,
    params: [
      { name: HOST_PARAM, value: controller.host },
      { name: MODEL_PARAM, value: identity.model.name || identity.model.id },
    ],
    features: featuresOf(identity).map(({ key, definition, name }) => ({
      ...definition,
      name: name(language),
      external_id: ids.feature(key),
    })),
  };
}

/**
 * The value of every stateful feature for a snapshot (buttons have none;
 * null: unknown, nothing to publish).
 * @param {{ reachable: boolean|null, activeZones: number[]|null, raining: boolean|null,
 *   rainDelay: number|null }} snapshot
 * @returns {Array<{ externalId: string, value: number|null }>}
 */
export function featureValues(gladys, identity, snapshot) {
  const ids = deviceIds(gladys, identity.platformId);
  const values = identity.zones.map((zone) => ({
    externalId: ids.feature(zoneKey(zone)),
    value: snapshot.activeZones ? (snapshot.activeZones.includes(zone) ? 1 : 0) : null,
  }));
  if (identity.rainSensor !== false) {
    values.push({
      externalId: ids.feature(FEATURE_KEYS.RAIN_SENSOR),
      value: typeof snapshot.raining === 'boolean' ? (snapshot.raining ? 1 : 0) : null,
    });
  }
  if (identity.rainDelay !== false) {
    values.push({
      externalId: ids.feature(FEATURE_KEYS.RAIN_DELAY),
      value: Number.isInteger(snapshot.rainDelay) ? snapshot.rainDelay : null,
    });
  }
  values.push({
    externalId: ids.feature(FEATURE_KEYS.ONLINE),
    value: snapshot.reachable === null ? null : snapshot.reachable ? 1 : 0,
  });
  return values;
}

/**
 * What a feature external id designates on a controller.
 * @returns {{ kind: 'zone', zone: number }|{ kind: 'program', program: number }
 *   |{ kind: 'stop'|'rain_delay'|'other' }}
 */
export function describeFeature(gladys, identity, featureExternalId) {
  const ids = deviceIds(gladys, identity.platformId);
  for (const feature of featuresOf(identity)) {
    if (ids.feature(feature.key) !== featureExternalId) {
      continue;
    }
    if (feature.zone !== undefined) {
      return { kind: 'zone', zone: feature.zone };
    }
    if (feature.program !== undefined) {
      return { kind: 'program', program: feature.program };
    }
    if (feature.key === FEATURE_KEYS.STOP || feature.key === FEATURE_KEYS.RAIN_DELAY) {
      return { kind: feature.key };
    }
  }
  return { kind: 'other' };
}
