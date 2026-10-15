// -----------------------------------------------------------------------------
// The controller commands tunnelled through the module (`tunnelSip`): a hex
// string whose first byte is the command code, answered by a hex string whose
// first byte is the response code. Codes and layouts from pyrainbird
// `resources/sipcommands.yaml` (allenporter/pyrainbird, MIT), for the commands
// this integration uses only; the encoding is rewritten here.
//
// Zone masks (0x83 available zones, 0xBF zones watering): 4 bytes per page of
// 32 zones, the lowest bit of the first byte being zone 1 of the page.
// -----------------------------------------------------------------------------

const hex = (value, digits) => Number(value).toString(16).toUpperCase().padStart(digits, '0');

/**
 * Every command used, with its encoder, its expected response code and the
 * decoder of the answer. `length` is the number of bytes of the request, sent
 * next to it as the module expects.
 */
export const COMMANDS = Object.freeze({
  modelAndVersion: {
    encode: () => '02',
    response: '82',
    decode: (data) => ({
      modelId: parseInt(data.slice(2, 6), 16),
      major: parseInt(data.slice(6, 8), 16),
      minor: parseInt(data.slice(8, 10), 16),
    }),
  },
  availableStations: {
    encode: (page) => `03${hex(page, 2)}`,
    response: '83',
    decode: (data) => ({ page: parseInt(data.slice(2, 4), 16), mask: data.slice(4, 12) }),
  },
  serialNumber: {
    encode: () => '05',
    response: '85',
    decode: (data) => ({ serial: data.slice(2, 18) }),
  },
  firmwareVersion: {
    encode: () => '0B',
    response: '8B',
    decode: (data) => ({
      major: parseInt(data.slice(2, 4), 16),
      minor: parseInt(data.slice(4, 6), 16),
      patch: parseInt(data.slice(6, 10), 16),
    }),
  },
  rainDelay: {
    encode: () => '36',
    response: 'B6',
    decode: (data) => ({ days: parseInt(data.slice(2, 6), 16) }),
  },
  setRainDelay: { encode: (days) => `37${hex(days, 4)}`, response: '01' },
  runProgram: { encode: (program) => `38${hex(program, 2)}`, response: '01' },
  runStation: { encode: (zone, minutes) => `39${hex(zone, 4)}${hex(minutes, 2)}`, response: '01' },
  rainSensor: {
    encode: () => '3E',
    response: 'BE',
    decode: (data) => ({ raining: parseInt(data.slice(2, 4), 16) !== 0 }),
  },
  activeStations: {
    encode: (page) => `3F${hex(page, 2)}`,
    response: 'BF',
    decode: (data) => ({ page: parseInt(data.slice(2, 4), 16), mask: data.slice(4, 12) }),
  },
  stopIrrigation: { encode: () => '40', response: '01' },
});

/** Response code of a refused command (NAK): `00 <command> <reason>`. */
export const NACK = '00';

/**
 * @param {string} name a key of COMMANDS
 * @param {...number} args
 * @returns {{ data: string, length: number }}
 */
export function encodeCommand(name, ...args) {
  const data = COMMANDS[name].encode(...args);
  return { data, length: data.length / 2 };
}

/**
 * Check and decode an answer.
 * @param {string} name a key of COMMANDS
 * @param {string} data the hex answer of the controller
 * @returns {object} the decoded fields ({} for an acknowledgement)
 * @throws {SipError} a refused command (`nack: true`) or an unexpected answer
 */
export function decodeAnswer(name, data) {
  const command = COMMANDS[name];
  const text = typeof data === 'string' ? data.toUpperCase() : '';
  if (!/^[0-9A-F]+$/.test(text) || text.length % 2) {
    throw new SipError(`${name}: answer is not hex`);
  }
  const code = text.slice(0, 2);
  if (code === NACK && command.response !== NACK) {
    throw new SipError(`${name}: refused by the controller (NAK ${text.slice(2)})`, {
      nack: true,
    });
  }
  if (code !== command.response) {
    throw new SipError(`${name}: unexpected answer ${code} (expected ${command.response})`);
  }
  return command.decode ? command.decode(text) : {};
}

export class SipError extends Error {
  constructor(message, { nack = false } = {}) {
    super(message);
    this.name = 'SipError';
    this.nack = nack;
  }
}

/**
 * Zone numbers set in a mask (8 hex digits per page of 32 zones).
 * @param {string} mask
 * @param {number} [page]
 * @returns {number[]}
 */
export function zonesOfMask(mask, page = 0) {
  const zones = [];
  for (let byte = 0; byte * 2 < mask.length; byte += 1) {
    const value = parseInt(mask.slice(byte * 2, byte * 2 + 2), 16);
    for (let bit = 0; bit < 8; bit += 1) {
      if (value & (1 << bit)) {
        zones.push(page * 32 + byte * 8 + bit + 1);
      }
    }
  }
  return zones;
}

/** Pages of 32 zones to read for a model. */
export const pagesFor = (maxStations) => Math.max(1, Math.ceil(maxStations / 32));
