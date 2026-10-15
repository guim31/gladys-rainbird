// -----------------------------------------------------------------------------
// Scene action handlers (manifest `scene_actions`, Gladys 5.1+).
//
// A zone switch is already a Gladys scene action ("control a device"), but it
// waters for the length of the configuration only. These say how long, start
// a program, stop everything at once, and set the rain delay with a number of
// days. Gladys applies the field defaults to scene actions.
// -----------------------------------------------------------------------------

export const SCENE_ACTIONS = {
  async water_zone(hub, { fields = {} }) {
    const { minutes } = await hub.waterZone(fields.device || null, fields.zone, fields.minutes);
    return { minutes };
  },

  async stop_watering(hub, { fields = {} }) {
    const controllers = await hub.stopWatering(fields.device || null);
    return { controllers };
  },

  async run_program(hub, { fields = {} }) {
    await hub.runProgram(fields.device || null, String(fields.program ?? 'A'));
    return {};
  },

  async set_rain_delay(hub, { fields = {} }) {
    const days = await hub.setRainDelay(fields.device || null, fields.days);
    return { days };
  },
};
