// -----------------------------------------------------------------------------
// Texts the integration sends to Gladys outside the widget (src/widgets.js):
// connection status, errors, the "Test the connection" report, the errors of
// the commands and scene actions. Four languages, the four of the Gladys
// interface; German says "du", Spanish "usted". test/i18n.test.js checks
// every table.
// -----------------------------------------------------------------------------

import { ERROR_KINDS } from './rainbird/client.js';

export const INIT_FAILED = {
  en: 'Initialization failed, check the integration logs.',
  fr: "L'initialisation a échoué, consultez les logs de l'intégration.",
  de: 'Initialisierung fehlgeschlagen, sieh dir die Protokolle der Integration an.',
  es: 'La inicialización ha fallado, consulte los registros de la integración.',
};

export const CONNECTION_TEXT = {
  noController: {
    en: 'Enter the address and password of your Rain Bird module in the configuration.',
    fr: "Saisissez l'adresse et le mot de passe de votre module Rain Bird dans la configuration.",
    de: 'Gib die Adresse und das Passwort deines Rain-Bird-Moduls in der Konfiguration ein.',
    es: 'Introduzca la dirección y la contraseña de su módulo Rain Bird en la configuración.',
  },
  invalidHost: {
    en: 'Address not understood, e.g. 192.168.1.20',
    fr: 'Adresse incomprise, ex. 192.168.1.20',
    de: 'Adresse nicht verstanden, z. B. 192.168.1.20',
    es: 'Dirección no válida, p. ej. 192.168.1.20',
  },
};

// One short explanation per error kind (src/rainbird/client.js).
export const ERROR_TEXT = {
  [ERROR_KINDS.UNREACHABLE]: {
    en: 'does not answer',
    fr: 'ne répond pas',
    de: 'antwortet nicht',
    es: 'no responde',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'password refused (or not a Rain Bird module)',
    fr: 'mot de passe refusé (ou pas un module Rain Bird)',
    de: 'Passwort abgelehnt (oder kein Rain-Bird-Modul)',
    es: 'contraseña rechazada (o no es un módulo Rain Bird)',
  },
  [ERROR_KINDS.BUSY]: {
    en: 'busy with another client (the Rain Bird app?)',
    fr: 'occupé avec un autre client (l’appli Rain Bird ?)',
    de: 'mit einem anderen Client beschäftigt (die Rain-Bird-App?)',
    es: 'ocupado con otro cliente (¿la aplicación Rain Bird?)',
  },
  [ERROR_KINDS.REFUSED]: {
    en: 'the controller refused the command',
    fr: 'le programmateur a refusé la commande',
    de: 'das Steuergerät hat den Befehl abgelehnt',
    es: 'el programador ha rechazado la orden',
  },
  [ERROR_KINDS.PROTOCOL]: {
    en: 'unexpected answer, see the logs',
    fr: 'réponse inattendue, voir les logs',
    de: 'unerwartete Antwort, sieh in den Protokollen nach',
    es: 'respuesta inesperada, consulte los registros',
  },
};

// The "Test the connection" report, one line per controller.
export const REPORT_TEXT = {
  en: {
    zones: (count) => `${count} zone(s)`,
    watering: (zones) => `watering: ${zones}`,
    idle: 'not watering',
    raining: 'rain detected',
    delay: (days) => `rain delay ${days} day(s)`,
    waiting: 'not read yet',
  },
  fr: {
    zones: (count) => `${count} zone(s)`,
    watering: (zones) => `arrosage : ${zones}`,
    idle: "pas d'arrosage en cours",
    raining: 'pluie détectée',
    delay: (days) => `délai de pluie ${days} jour(s)`,
    waiting: 'pas encore lu',
  },
  de: {
    zones: (count) => `${count} Zone(n)`,
    watering: (zones) => `Bewässerung: ${zones}`,
    idle: 'keine Bewässerung',
    raining: 'Regen erkannt',
    delay: (days) => `Regenpause ${days} Tag(e)`,
    waiting: 'noch nicht gelesen',
  },
  es: {
    zones: (count) => `${count} zona(s)`,
    watering: (zones) => `riego: ${zones}`,
    idle: 'sin riego en curso',
    raining: 'lluvia detectada',
    delay: (days) => `retraso por lluvia de ${days} día(s)`,
    waiting: 'aún no leído',
  },
};

// Errors of the commands, scene actions and widget buttons (shown in Gladys).
export const ACTION_TEXT = {
  noController: {
    en: 'No Rain Bird controller is configured.',
    fr: "Aucun programmateur Rain Bird n'est configuré.",
    de: 'Kein Rain-Bird-Steuergerät ist konfiguriert.',
    es: 'No hay ningún programador Rain Bird configurado.',
  },
  unknownController: {
    en: 'This controller is no longer in the configuration.',
    fr: "Ce programmateur n'est plus dans la configuration.",
    de: 'Dieses Steuergerät ist nicht mehr in der Konfiguration.',
    es: 'Este programador ya no está en la configuración.',
  },
  notIdentified: {
    en: 'This controller has not answered yet: check its address and password.',
    fr: "Ce programmateur n'a pas encore répondu : vérifiez son adresse et son mot de passe.",
    de: 'Dieses Steuergerät hat noch nicht geantwortet: Prüfe seine Adresse und sein Passwort.',
    es: 'Este programador aún no ha respondido: compruebe su dirección y su contraseña.',
  },
  unknownZone: {
    en: 'This zone is not wired on the controller.',
    fr: "Cette zone n'est pas câblée sur le programmateur.",
    de: 'Diese Zone ist am Steuergerät nicht angeschlossen.',
    es: 'Esta zona no está conectada al programador.',
  },
  unknownProgram: {
    en: 'This controller has no such program.',
    fr: "Ce programmateur n'a pas ce programme.",
    de: 'Dieses Steuergerät hat dieses Programm nicht.',
    es: 'Este programador no tiene ese programa.',
  },
  failed: {
    en: 'No controller accepted the command.',
    fr: "Aucun programmateur n'a accepté la commande.",
    de: 'Kein Steuergerät hat den Befehl angenommen.',
    es: 'Ningún programador ha aceptado la orden.',
  },
};

export const LANGUAGE_FALLBACK = 'en';

/** "Name: text", with the space French puts before a colon. */
export const labelled = (name, text, language) =>
  `${name}${language === 'fr' ? ' : ' : ': '}${text}`;
export const pick = (text, language) => text[language] ?? text[LANGUAGE_FALLBACK];
