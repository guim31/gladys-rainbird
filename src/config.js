// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// Up to three controllers, each in its own slot (address, password, name).
// The device identity is the module's MAC address, not the slot: moving a
// controller to another slot, or giving it another address, keeps its device.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

export const SLOTS = [1, 2, 3];

// Reading intervals offered in the configuration, in seconds. One minute at
// least: the module serves one client at a time, the Rain Bird app included.
export const POLL_INTERVALS = ['60', '120', '300'];

// Length of a manual run started from a zone switch, in minutes.
export const MIN_ZONE_MINUTES = 1;
export const MAX_ZONE_MINUTES = 240;

export const DEFAULT_CONFIG = {
  controller_1_host: '',
  controller_1_password: '',
  controller_1_name: '',
  controller_2_host: '',
  controller_2_password: '',
  controller_2_name: '',
  controller_3_host: '',
  controller_3_password: '',
  controller_3_name: '',
  zone_minutes: 10,
  poll_interval: '60',
  language: 'fr',
};

const MAX_NAME_LENGTH = 40;

/**
 * Parse the address typed by the user: a bare IP or name (`192.0.2.10`,
 * `rainbird.local:8080`), or a URL (`https://192.0.2.10/stick`). Without a
 * scheme, the client tries HTTPS then HTTP.
 * @param {unknown} raw
 * @returns {{ host: string, scheme: 'http'|'https'|null }|null} null when unusable
 */
export function parseHost(raw) {
  if (typeof raw !== 'string') {
    return null;
  }
  const text = raw.trim();
  if (!text) {
    return null;
  }
  const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
  let url;
  try {
    url = new URL(hasScheme ? text : `http://${text}`);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) {
    return null;
  }
  // Credentials in the address would end up in the logs and the device params.
  if (url.username || url.password) {
    return null;
  }
  return { host: url.host, scheme: hasScheme ? url.protocol.slice(0, -1) : null };
}

/** A whole number of minutes, within the bounds of a manual run. */
export function parseMinutes(raw, fallback = DEFAULT_CONFIG.zone_minutes) {
  const number =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string' && raw.trim() !== ''
        ? Number(raw.trim().replace(',', '.'))
        : NaN;
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.min(MAX_ZONE_MINUTES, Math.max(MIN_ZONE_MINUTES, Math.round(number)));
}

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const text = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  const pick = (key, list) => {
    const value = source[key] === undefined || source[key] === null ? '' : String(source[key]);
    return list.includes(value) ? value : DEFAULT_CONFIG[key];
  };

  const controllers = [];
  const invalidSlots = [];
  for (const slot of SLOTS) {
    const typed = text(`controller_${slot}_host`);
    if (!typed) {
      continue;
    }
    const address = parseHost(typed);
    if (!address) {
      invalidSlots.push(slot);
      continue;
    }
    controllers.push({
      slot,
      ...address,
      // Passwords are kept as typed: spaces may be part of them.
      password:
        typeof source[`controller_${slot}_password`] === 'string'
          ? source[`controller_${slot}_password`]
          : '',
      name: text(`controller_${slot}_name`).slice(0, MAX_NAME_LENGTH) || null,
    });
  }

  return {
    controllers,
    invalidSlots,
    zoneMinutes: parseMinutes(source.zone_minutes),
    pollIntervalMs: Number(pick('poll_interval', POLL_INTERVALS)) * 1000,
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
