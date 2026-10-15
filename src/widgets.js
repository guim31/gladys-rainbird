// -----------------------------------------------------------------------------
// Dashboard widget (manifest `widgets`, Gladys 5.1+): `rainbird`.
//
// The use case: from the wall tablet, see which zone waters and whether rain
// paused the schedule, water one zone for a few minutes before sowing, stop
// everything when someone walks in the garden, start a program, or pause the
// schedule for the rainy days announced.
//
// One controller: the one chosen in the widget settings, else the first of the
// configuration. Budget (8 components, 1 focal, 1 status, 4 buttons): the
// zones as a list (focal, 8 at most: those watering first), one status list
// (rain sensor, rain delay, connection) and four buttons. The values are sent
// as such, not bound to device features, so the widget works before the device
// is added to Gladys.
//
// The "Water…", "Program…" and "Rain delay…" buttons open a form (widget
// action fields, GladysAssistant/Gladys#3168): Gladys 5.2.0 or later. An older
// Gladys sends the tap without the form, answered by a message asking to
// update Gladys.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { MAX_ZONE_MINUTES, MIN_ZONE_MINUTES } from './config.js';
import { PROGRAM_LETTERS, controllerName, deviceIds, programsOf, zoneName } from './devices.js';
import { WIDGET_KEY } from './hub.js';
import { ERROR_KINDS } from './rainbird/client.js';
import { ERROR_TEXT, pick } from './texts.js';

// Action keys of the buttons: permanent once published (unique, the core
// drops a button whose key is taken).
export const ACTIONS = Object.freeze({
  WATER: 'water_zone',
  STOP: 'stop',
  PROGRAM: 'run_program',
  RAIN_DELAY: 'rain_delay',
});

const MAX_LISTED_ZONES = 8;

export const TEXT = {
  pick: {
    en: 'Enter the address of your Rain Bird module in the configuration of the integration.',
    fr: "Saisissez l'adresse de votre module Rain Bird dans la configuration de l'intégration.",
    de: 'Gib die Adresse deines Rain-Bird-Moduls in der Konfiguration der Integration ein.',
    es: 'Introduzca la dirección de su módulo Rain Bird en la configuración de la integración.',
  },
  unknown: {
    en: 'This controller is no longer in the configuration: choose another one in the widget settings.',
    fr: "Ce programmateur n'est plus dans la configuration : choisissez-en un autre dans les réglages du widget.",
    de: 'Dieses Steuergerät ist nicht mehr in der Konfiguration: Wähle ein anderes in den Widget-Einstellungen.',
    es: 'Este programador ya no está en la configuración: elija otro en la configuración del widget.',
  },
  waitingFirst: {
    en: 'The controller has not answered yet: see the Configuration screen of the integration.',
    fr: "Le programmateur n'a pas encore répondu : voir l'écran Configuration de l'intégration.",
    de: 'Das Steuergerät hat noch nicht geantwortet: Sieh dir die Konfiguration der Integration an.',
    es: 'El programador aún no ha respondido: consulte la pantalla de configuración de la integración.',
  },
  updateGladys: {
    en: 'Update Gladys to 5.2.0 or later to use this button.',
    fr: 'Mettez Gladys à jour (5.2.0 ou plus) pour utiliser ce bouton.',
    de: 'Aktualisiere Gladys auf 5.2.0 oder neuer, um diese Schaltfläche zu nutzen.',
    es: 'Actualice Gladys a la versión 5.2.0 o posterior para usar este botón.',
  },
  watering: { en: 'Watering', fr: 'Arrosage', de: 'Bewässert', es: 'Regando' },
  idle: { en: 'Idle', fr: 'Au repos', de: 'Inaktiv', es: 'En reposo' },
  rainSensor: {
    en: 'Rain sensor',
    fr: 'Capteur de pluie',
    de: 'Regensensor',
    es: 'Sensor de lluvia',
  },
  rain: { en: 'Rain', fr: 'Pluie', de: 'Regen', es: 'Lluvia' },
  dry: { en: 'Dry', fr: 'Sec', de: 'Trocken', es: 'Seco' },
  rainDelay: {
    en: 'Rain delay',
    fr: 'Délai de pluie',
    de: 'Regenpause',
    es: 'Retraso por lluvia',
  },
  off: { en: 'Off', fr: 'Aucun', de: 'Aus', es: 'Ninguno' },
  days: { en: 'day(s)', fr: 'jour(s)', de: 'Tag(e)', es: 'día(s)' },
  connection: { en: 'Connection', fr: 'Connexion', de: 'Verbindung', es: 'Conexión' },
  more: {
    en: 'more zones',
    fr: 'autres zones',
    de: 'weitere Zonen',
    es: 'zonas más',
  },
  water: { en: 'Water…', fr: 'Arroser…', de: 'Bewässern…', es: 'Regar…' },
  stop: { en: 'Stop', fr: 'Arrêter', de: 'Stoppen', es: 'Detener' },
  program: { en: 'Program…', fr: 'Programme…', de: 'Programm…', es: 'Programa…' },
  delay: { en: 'Rain delay…', fr: 'Délai de pluie…', de: 'Regenpause…', es: 'Retraso…' },
  zone: { en: 'Zone', fr: 'Zone', de: 'Zone', es: 'Zona' },
  minutes: {
    en: 'Duration (minutes)',
    fr: 'Durée (minutes)',
    de: 'Dauer (Minuten)',
    es: 'Duración (minutos)',
  },
  programField: { en: 'Program', fr: 'Programme', de: 'Programm', es: 'Programa' },
  daysField: {
    en: 'Days (0 cancels)',
    fr: 'Jours (0 annule)',
    de: 'Tage (0 hebt auf)',
    es: 'Días (0 cancela)',
  },
};

// Toasts after a tap (≤ 200 characters).
export const DONE_TEXT = {
  en: {
    watering: (zone, minutes) => `${zone}: watering for ${minutes} min.`,
    stopped: 'Watering stopped.',
    program: (letter) => `Program ${letter} started.`,
    delay: (days) => (days ? `Watering paused for ${days} day(s).` : 'Rain delay cancelled.'),
  },
  fr: {
    watering: (zone, minutes) => `${zone} : arrosage pendant ${minutes} min.`,
    stopped: 'Arrosage arrêté.',
    program: (letter) => `Programme ${letter} lancé.`,
    delay: (days) => (days ? `Arrosage suspendu ${days} jour(s).` : 'Délai de pluie annulé.'),
  },
  de: {
    watering: (zone, minutes) => `${zone}: Bewässerung für ${minutes} min.`,
    stopped: 'Bewässerung gestoppt.',
    program: (letter) => `Programm ${letter} gestartet.`,
    delay: (days) => (days ? `Bewässerung für ${days} Tag(e) pausiert.` : 'Regenpause aufgehoben.'),
  },
  es: {
    watering: (zone, minutes) => `${zone}: riego durante ${minutes} min.`,
    stopped: 'Riego detenido.',
    program: (letter) => `Programa ${letter} iniciado.`,
    delay: (days) =>
      days ? `Riego suspendido durante ${days} día(s).` : 'Retraso por lluvia cancelado.',
  },
};

const t = (text, language) => pick(text, language);
const LANGS = Object.keys(DONE_TEXT);
const allLanguages = (render) => Object.fromEntries(LANGS.map((lang) => [lang, render(lang)]));

function message(text, language) {
  return {
    ttl_seconds: 300,
    components: [{ type: 'text', variant: 'body', text: t(text, language) }],
  };
}

/** The zones, those watering first, 8 at most. */
function zoneList(record, language) {
  const active = record.snapshot.activeZones ?? [];
  const zones = [
    ...record.identity.zones.filter((zone) => active.includes(zone)),
    ...record.identity.zones.filter((zone) => !active.includes(zone)),
  ];
  const listed = zones.slice(0, MAX_LISTED_ZONES);
  const items = listed.map((zone) => ({
    title: zoneName(zone, language),
    badge: active.includes(zone)
      ? { text: t(TEXT.watering, language), color: WIDGET_COLORS.SUCCESS }
      : { text: t(TEXT.idle, language), color: WIDGET_COLORS.NEUTRAL },
  }));
  return { type: 'card-list', display: 'list', items, hidden: zones.length - listed.length };
}

function statusRows(record, language, hidden) {
  const { raining, rainDelay } = record.snapshot;
  const items = [];
  if (record.error) {
    items.push({
      label: t(TEXT.connection, language),
      icon: 'alert-triangle',
      value: t(ERROR_TEXT[record.error.kind], language).slice(0, 40),
      color:
        record.error.kind === ERROR_KINDS.UNREACHABLE
          ? WIDGET_COLORS.DANGER
          : WIDGET_COLORS.WARNING,
    });
  }
  if (typeof raining === 'boolean') {
    items.push({
      label: t(TEXT.rainSensor, language),
      icon: 'umbrella',
      value: t(raining ? TEXT.rain : TEXT.dry, language),
      color: raining ? WIDGET_COLORS.INFO : WIDGET_COLORS.NEUTRAL,
    });
  }
  if (Number.isInteger(rainDelay)) {
    items.push({
      label: t(TEXT.rainDelay, language),
      icon: 'pause-circle',
      value: rainDelay ? `${rainDelay} ${t(TEXT.days, language)}` : t(TEXT.off, language),
      color: rainDelay ? WIDGET_COLORS.WARNING : WIDGET_COLORS.NEUTRAL,
    });
  }
  if (hidden > 0) {
    items.push({
      label: t(TEXT.more, language),
      icon: 'more-horizontal',
      value: hidden,
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  return items;
}

export function buttons(hub, record, language) {
  const { identity, snapshot } = record;
  const maxMinutes = Math.min(MAX_ZONE_MINUTES, identity.model.maxRunMinutes);
  const watering = (snapshot.activeZones ?? []).length > 0;
  const list = [];
  if (identity.zones.length > 0) {
    list.push({
      type: 'button',
      label: t(TEXT.water, language),
      icon: 'droplet',
      style: 'secondary',
      action: {
        key: ACTIONS.WATER,
        fields: [
          {
            key: 'zone',
            type: 'select',
            required: true,
            default: String(identity.zones[0]),
            label: TEXT.zone,
            options: identity.zones.map((zone) => ({
              value: String(zone),
              label: allLanguages((lang) => zoneName(zone, lang)),
            })),
          },
          {
            key: 'minutes',
            type: 'number',
            required: true,
            min: MIN_ZONE_MINUTES,
            max: maxMinutes,
            default: Math.min(hub.config.zoneMinutes, maxMinutes),
            label: TEXT.minutes,
          },
        ],
      },
    });
  }
  list.push({
    type: 'button',
    label: t(TEXT.stop, language),
    // Nothing waters: the check mark says so (never the style: `primary` is
    // invisible in dark mode).
    icon: watering ? 'square' : 'check-circle',
    style: 'secondary',
    action: { key: ACTIONS.STOP },
  });
  const programs = programsOf(identity.model);
  if (programs.length > 0) {
    list.push({
      type: 'button',
      label: t(TEXT.program, language),
      icon: 'play',
      style: 'secondary',
      action: {
        key: ACTIONS.PROGRAM,
        fields: [
          {
            key: 'program',
            type: 'select',
            required: true,
            default: 'A',
            label: TEXT.programField,
            options: programs.map((program) => ({
              value: PROGRAM_LETTERS[program],
              label: allLanguages(
                (lang) => `${t(TEXT.programField, lang)} ${PROGRAM_LETTERS[program]}`,
              ),
            })),
          },
        ],
      },
    });
  }
  list.push({
    type: 'button',
    label: t(TEXT.delay, language),
    icon: 'cloud-rain',
    style: 'secondary',
    action: {
      key: ACTIONS.RAIN_DELAY,
      fields: [
        {
          key: 'days',
          type: 'number',
          required: true,
          min: 0,
          max: identity.model.maxRainDelayDays,
          default: snapshot.rainDelay || 1,
          label: TEXT.daysField,
        },
      ],
    },
  });
  return list;
}

async function get(hub, { settings, language = 'en' }) {
  if (hub.records.size === 0) {
    return message(TEXT.pick, language);
  }
  const record = hub.view(settings?.device);
  if (!record) {
    return message(TEXT.unknown, language);
  }
  if (!record.identity) {
    return message(TEXT.waitingFirst, language);
  }
  const components = [
    {
      type: 'text',
      variant: 'heading',
      text: controllerName(record.controller, record.identity).slice(0, 40),
    },
  ];
  const { hidden, ...list } = zoneList(record, language);
  if (list.items.length > 0) {
    components.push(list);
  }
  const items = statusRows(record, language, hidden);
  if (items.length > 0) {
    components.push({ type: 'status', items });
  }
  components.push(...buttons(hub, record, language));
  const watering = (record.snapshot.activeZones ?? []).length > 0;
  return { ttl_seconds: watering ? 30 : 120, components };
}

/** A value typed in a form; an older Gladys relays the tap without it. */
function typed(values, key, language) {
  if (!values || values[key] === undefined || values[key] === null || values[key] === '') {
    throw new Error(t(TEXT.updateGladys, language));
  }
  return values[key];
}

async function action(hub, { actionKey, settings, values }) {
  const language = hub.language();
  // The controller the widget shows.
  const record = hub.view(settings?.device);
  if (!record) {
    throw new Error(t(hub.records.size === 0 ? TEXT.pick : TEXT.unknown, language));
  }
  if (!record.identity) {
    throw new Error(t(TEXT.waitingFirst, language));
  }
  const device = deviceIds(hub.gladys, record.identity.platformId).device;
  switch (actionKey) {
    case ACTIONS.WATER: {
      const zone = Number(typed(values, 'zone', language));
      const { minutes } = await hub.waterZone(device, zone, typed(values, 'minutes', language));
      return {
        message: allLanguages((lang) => DONE_TEXT[lang].watering(zoneName(zone, lang), minutes)),
      };
    }
    case ACTIONS.STOP:
      await hub.stopWatering(device);
      return { message: allLanguages((lang) => DONE_TEXT[lang].stopped) };
    case ACTIONS.PROGRAM: {
      const letter = await hub.runProgram(device, String(typed(values, 'program', language)));
      return { message: allLanguages((lang) => DONE_TEXT[lang].program(letter)) };
    }
    case ACTIONS.RAIN_DELAY: {
      const days = await hub.setRainDelay(device, typed(values, 'days', language));
      return { message: allLanguages((lang) => DONE_TEXT[lang].delay(days)) };
    }
    default:
      throw new Error(`Unknown action ${actionKey}`);
  }
}

export const WIDGETS = {
  [WIDGET_KEY]: { get, action },
};
