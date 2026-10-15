// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DEFAULT_CONFIG,
  LANGUAGES,
  MAX_ZONE_MINUTES,
  MIN_ZONE_MINUTES,
  POLL_INTERVALS,
  SLOTS,
} from '../src/config.js';
import { PROGRAM_LETTERS } from '../src/devices.js';
import { ORIGINS, TRIGGERS, WIDGET_KEY } from '../src/hub.js';
import { MODELS } from '../src/rainbird/models.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { WIDGETS } from '../src/widgets.js';
import { createWorld, deviceId } from './helpers/world.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

const CAPABILITY_FIELDS = ['scene_triggers', 'scene_actions', 'widgets'];
// The widget buttons open a form (GladysAssistant/Gladys#3168): Gladys 5.2.0.
const WIDGET_FORMS_MIN_GLADYS_VERSION = [5, 2, 0];
const CATEGORIES_MIN_GLADYS_VERSION = [4, 86, 0];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

test('identity: name, image, cover, local transport, garden category', () => {
  assert.equal(manifest.name, 'Rain Bird');
  assert.equal(manifest.type, 'device');
  assert.match(manifest.docker_image, /^ghcr\.io\/guim31\/gladys-rainbird:/);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-rainbird/main/cover.png',
  );
  assert.deepEqual(manifest.transports, ['local']);
  // "Appliances & garden" in the store vocabulary: mowers, watering.
  assert.deepEqual(manifest.categories, ['appliances']);
  assert.equal(manifest.network_discovery, undefined);
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${lang}: ${text.length}`);
  }
});

test('every manifest action has a handler', async (t) => {
  const world = await createWorld();
  t.after(() => world.app.stop());
  for (const action of manifest.actions) {
    const ack = await world.fake.action(action.key, {});
    assert.equal(ack.success, true, `${action.key}: ${ack.error}`);
  }
  assert.deepEqual(keysOf(manifest.actions), ['test_connection']);
});

test('declaring catalog categories requires Gladys >= 4.86.0', () => {
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  assert.ok(isAtLeast(minGladysVersion(), CATEGORIES_MIN_GLADYS_VERSION));
});

test('the widget forms require Gladys >= 5.2.0 (also covers scenes and widgets, 5.1.0)', () => {
  const declared = CAPABILITY_FIELDS.filter((field) => manifest[field] !== undefined);
  assert.deepEqual(declared, CAPABILITY_FIELDS);
  assert.ok(isAtLeast(minGladysVersion(), WIDGET_FORMS_MIN_GLADYS_VERSION));
});

test('every scene_actions key has a handler, and returns the declared outputs', async (t) => {
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
  const world = await createWorld();
  t.after(() => world.app.stop());
  const fields = { device: deviceId(world.gladys), zone: 2, minutes: 5, program: 'B', days: 2 };
  for (const action of manifest.scene_actions) {
    const ack = await world.fake.sceneAction(action.key, fields);
    assert.equal(ack.success, true, `${action.key}: ${ack.error}`);
    assert.deepEqual(
      Object.keys(ack.data.outputs).sort(),
      keysOf(action.outputs).sort(),
      `${action.key} outputs`,
    );
  }
  assert.deepEqual(world.module.commands.slice(-4), ['39000205', '40', '3801', '370002']);
});

test('the scene action fields match the code bounds', () => {
  const field = (action, key) =>
    manifest.scene_actions.find((a) => a.key === action).fields.find((f) => f.key === key);
  assert.equal(field('water_zone', 'minutes').min, MIN_ZONE_MINUTES);
  assert.equal(field('water_zone', 'minutes').max, MAX_ZONE_MINUTES);
  assert.equal(field('water_zone', 'minutes').default, DEFAULT_CONFIG.zone_minutes);
  const longestDelay = Math.max(...Object.values(MODELS).map((m) => m.maxRainDelayDays));
  assert.equal(field('set_rain_delay', 'days').max, longestDelay);
  assert.deepEqual(
    field('run_program', 'program').options.map((o) => o.value),
    PROGRAM_LETTERS,
  );
});

test('the scene triggers are the ones the hub fires, with their filters and variables', async (t) => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), Object.values(TRIGGERS).sort());
  const world = await createWorld();
  t.after(() => world.app.stop());
  await world.fake.deviceCreated(world.fake.discoveredDevices[0]);
  world.module.active = new Set([1]);
  await world.hub.pollAll();
  world.module.active = new Set();
  await world.hub.pollAll();
  const fired = new Map(world.fake.sceneEvents.map((event) => [event.key, event.data]));
  for (const trigger of manifest.scene_triggers) {
    const data = fired.get(trigger.key);
    assert.ok(data, `${trigger.key} was fired`);
    for (const key of [...keysOf(trigger.fields), ...keysOf(trigger.variables)]) {
      assert.ok(key in data, `${trigger.key}: "${key}" is in the event data`);
    }
    for (const key of Object.keys(data)) {
      assert.ok(
        keysOf(trigger.variables).includes(key) || keysOf(trigger.fields).includes(key),
        `${trigger.key}: "${key}" is declared`,
      );
    }
    const origin = trigger.fields.find((field) => field.key === 'origin');
    assert.deepEqual(
      origin.options.map((option) => option.value).sort(),
      Object.values(ORIGINS).sort(),
    );
  }
});

test('every widgets key has a handler', async (t) => {
  assert.deepEqual(keysOf(manifest.widgets), [WIDGET_KEY]);
  assert.deepEqual(Object.keys(WIDGETS), [WIDGET_KEY]);
  const world = await createWorld();
  t.after(() => world.app.stop());
  const ack = await world.fake.widgetGet(WIDGET_KEY, { settings: {} });
  assert.equal(ack.success, true, ack.error);
});

test('config_schema defaults and options stay consistent with the code', () => {
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `DEFAULT_CONFIG.${field.key}`);
    }
  }
  const schema = (key) => manifest.config_schema.find((f) => f.key === key);
  assert.deepEqual(
    schema('language').options.map((o) => o.value),
    LANGUAGES,
  );
  assert.deepEqual(
    schema('poll_interval').options.map((o) => o.value),
    POLL_INTERVALS,
  );
  assert.equal(schema('zone_minutes').min, MIN_ZONE_MINUTES);
  assert.equal(schema('zone_minutes').max, MAX_ZONE_MINUTES);
  assert.deepEqual(
    Object.keys(DEFAULT_CONFIG).sort(),
    manifest.config_schema
      .filter((f) => f.type !== 'section')
      .map((f) => f.key)
      .sort(),
  );
  for (const slot of SLOTS) {
    const password = schema(`controller_${slot}_password`);
    assert.equal(password.type, 'secret', 'passwords are secret fields');
  }
});

test('section fields are purely presentational', () => {
  const sections = manifest.config_schema.filter((f) => f.type === 'section');
  assert.ok(sections.length > 0);
  for (const section of sections) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.equal(section.placeholder, undefined);
    assert.ok(!(section.key in DEFAULT_CONFIG));
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//, 'section links must be https');
    }
  }
});

test('dynamic selects declare a source and no static options', () => {
  const dynamicSelects = allFields.filter((f) => f.source !== undefined);
  assert.ok(dynamicSelects.length > 0);
  for (const field of dynamicSelects) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined);
  }
});

test('number fields have integer bounds and defaults (the form has no step)', () => {
  for (const field of allFields.filter((f) => f.type === 'number')) {
    for (const key of ['min', 'max', 'default']) {
      if (field[key] !== undefined) {
        assert.ok(Number.isInteger(field[key]), `field "${field.key}".${key} must be an integer`);
      }
    }
  }
});

test('actions declare no secret field, no required field (no default is applied)', () => {
  // Gladys#3154/#3155: a secret in an action form cannot be filled, and an
  // action applies no default while enforcing `required`.
  for (const action of manifest.actions ?? []) {
    for (const field of action.fields ?? []) {
      assert.notEqual(field.type, 'secret');
      assert.notEqual(field.required, true);
    }
  }
});

test('field placeholders are multi-language objects', () => {
  for (const field of allFields.filter((f) => f.placeholder !== undefined)) {
    assert.equal(typeof field.placeholder, 'object', `field "${field.key}": placeholder`);
    assert.ok(field.placeholder.en);
  }
});

test('trigger filters have no boolean field (no "any" state)', () => {
  for (const trigger of manifest.scene_triggers) {
    for (const field of trigger.fields) {
      assert.notEqual(field.type, 'boolean');
    }
  }
});
