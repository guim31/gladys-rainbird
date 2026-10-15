// -----------------------------------------------------------------------------
// Rain Bird controller models, keyed by the model id the controller answers
// to the "model and version" command (0x02), as 4 lowercase hex digits.
//
// Limits from pyrainbird `resources/models.yaml` (allenporter/pyrainbird,
// MIT): zones (stations), programs, longest rain delay in days, longest
// manual run in minutes. A model missing here still works with the defaults
// of UNKNOWN_MODEL; its zones come from the controller itself (0x03).
// -----------------------------------------------------------------------------

const model = (name, maxStations, maxPrograms, maxRainDelayDays, maxRunMinutes) =>
  Object.freeze({ name, maxStations, maxPrograms, maxRainDelayDays, maxRunMinutes });

export const MODELS = Object.freeze({
  '0003': model('ESP-RZXe', 8, 0, 14, 360),
  '0005': model('ESP-TM2', 12, 3, 14, 360),
  '0006': model('ST8x-WiFi', 8, 0, 14, 360),
  '0007': model('ESP-Me', 22, 4, 14, 360),
  '0008': model('ST8x-WiFi2', 8, 8, 14, 360),
  '0009': model('ESP-ME3', 22, 4, 14, 360),
  '000a': model('ESP-TM2', 12, 3, 14, 360),
  '000b': model('BAT-BT', 6, 4, 14, 540),
  '000c': model('LXME2', 48, 40, 30, 5760),
  '000d': model('LX-IVM', 60, 10, 30, 5760),
  '000e': model('LX-IVM Pro', 240, 40, 30, 5760),
  '0011': model('ESP-2WIRE', 50, 4, 14, 360),
  '0014': model('TM2R', 12, 3, 14, 360),
  '0015': model('TRU', 12, 3, 14, 360),
  '0016': model('BAT-PRO', 6, 12, 30, 540),
  '0017': model('BAT-PRO', 6, 12, 30, 540),
  '0018': model('BAT-PRO Flow', 6, 12, 30, 540),
  '0019': model('BAT-PRO Flow', 6, 12, 30, 540),
  '0099': model('TBOS-BT', 6, 3, 14, 540),
  '0100': model('TBOS-BT', 6, 3, 14, 540),
  '0103': model('ESP-RZXe2', 8, 8, 14, 360),
  '0107': model('ESP-Me', 22, 4, 14, 360),
  '010a': model('ESP-TM2', 12, 3, 14, 360),
  '0812': model('RC2', 8, 3, 14, 360),
  '0813': model('ARC8', 8, 3, 14, 360),
});

// An unknown model: 32 zones (one page of the zone masks), the programs are
// not offered, the common limits.
export const UNKNOWN_MODEL = model('', 32, 0, 14, 360);

/**
 * @param {number} modelId as answered by the controller
 * @returns {{ id: string, known: boolean, name: string, maxStations: number,
 *   maxPrograms: number, maxRainDelayDays: number, maxRunMinutes: number }}
 */
export function modelInfo(modelId) {
  const id = Number(modelId).toString(16).padStart(4, '0');
  const known = MODELS[id];
  return { id, known: Boolean(known), ...(known ?? UNKNOWN_MODEL) };
}
