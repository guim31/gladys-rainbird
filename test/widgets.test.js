// -----------------------------------------------------------------------------
// The dashboard widget: a content the core renders exactly as sent
// (validateWidgetContent of the SDK), within the budget, in every state; its
// buttons and their forms.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { WIDGET_KEY } from '../src/hub.js';
import { ACTIONS } from '../src/widgets.js';
import {
  FakeRainbird,
  HOST_1,
  HOST_2,
  MAC_2,
  createWorld,
  deviceId,
  idsOf,
} from './helpers/world.js';

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

async function content(w, settings = {}, language = 'en') {
  const ack = await w.fake.widgetGet(WIDGET_KEY, { settings, language });
  assert.equal(ack.success, true, ack.error);
  return ack.data.content;
}

function checkBudget(widget) {
  assert.deepEqual(validateWidgetContent(widget), []);
  const count = (types) => widget.components.filter((c) => types.includes(c.type)).length;
  assert.ok(widget.components.length <= 8);
  assert.ok(count(['text']) <= 2);
  assert.ok(count(['button']) <= 4);
  assert.ok(count(['card-list', 'chart', 'image']) <= 1);
  const keys = widget.components.filter((c) => c.action).map((c) => c.action.key);
  assert.equal(new Set(keys).size, keys.length, 'unique action keys');
}

test('the widget renders as sent, in every language and state', async (t) => {
  const module = new FakeRainbird();
  module.active = new Set([5]);
  module.raining = true;
  module.rainDelay = 2;
  const w = await world(t, { modules: { [HOST_1]: module } });
  for (const language of ['en', 'fr', 'de', 'es']) {
    checkBudget(await content(w, {}, language));
  }
  const widget = await content(w);
  const list = widget.components.find((c) => c.type === 'card-list');
  assert.equal(list.items[0].title, 'Zone 5', 'the zone watering first');
  assert.equal(list.items[0].badge.text, 'Watering');
  assert.equal(list.items.length, 7);
  const status = widget.components.find((c) => c.type === 'status');
  assert.deepEqual(
    status.items.map((item) => [item.label, item.value]),
    [
      ['Rain sensor', 'Rain'],
      ['Rain delay', '2 day(s)'],
    ],
  );
  assert.deepEqual(
    widget.components.filter((c) => c.type === 'button').map((c) => c.action.key),
    [ACTIONS.WATER, ACTIONS.STOP, ACTIONS.PROGRAM, ACTIONS.RAIN_DELAY],
  );
  assert.equal(widget.ttl_seconds, 30, 'watering: refreshed sooner');
});

test('22 zones: 8 listed, the others counted', async (t) => {
  const zones = Array.from({ length: 22 }, (_, index) => index + 1);
  const module = new FakeRainbird({ modelId: 7, zones });
  module.active = new Set([20]);
  const w = await world(t, { modules: { [HOST_1]: module } });
  const widget = await content(w);
  checkBudget(widget);
  const list = widget.components.find((c) => c.type === 'card-list');
  assert.equal(list.items.length, 8);
  assert.equal(list.items[0].title, 'Zone 20');
  const status = widget.components.find((c) => c.type === 'status');
  assert.deepEqual(status.items.at(-1).value, 14);
  const water = widget.components.find((c) => c.action?.key === ACTIONS.WATER);
  assert.equal(water.action.fields[0].options.length, 22, 'every zone in the form');
});

test('no program on the model: no program button', async (t) => {
  const w = await world(t, {
    modules: { [HOST_1]: new FakeRainbird({ modelId: 3, zones: [1, 2, 3, 4] }) },
  });
  const widget = await content(w);
  checkBudget(widget);
  assert.ok(!widget.components.some((c) => c.action?.key === ACTIONS.PROGRAM));
});

test('messages: nothing configured, not answered yet, controller removed', async (t) => {
  const none = await world(t, { config: {} });
  checkBudget(await content(none));
  assert.match((await content(none)).components[0].text, /Enter the address/);

  const silent = new FakeRainbird();
  silent.online = false;
  const waiting = await world(t, { modules: { [HOST_1]: silent } });
  assert.match((await content(waiting)).components[0].text, /not answered yet/);

  const w = await world(t);
  assert.match(
    (await content(w, { device: 'ext:test-integration:controller:gone' })).components[0].text,
    /no longer in the configuration/,
  );
});

test('a controller that stopped answering shows it', async (t) => {
  const w = await world(t);
  w.module.online = false;
  await w.hub.pollAll({ all: true });
  const widget = await content(w, {}, 'fr');
  checkBudget(widget);
  const status = widget.components.find((c) => c.type === 'status');
  assert.deepEqual(status.items[0], {
    label: 'Connexion',
    icon: 'alert-triangle',
    value: 'ne répond pas',
    color: 'danger',
  });
});

test('the buttons: water a zone, stop, run a program, set the rain delay', async (t) => {
  const w = await world(t);
  const tap = (actionKey, values) =>
    w.fake.widgetAction(WIDGET_KEY, actionKey, {}, { settings: {}, values });

  let ack = await tap(ACTIONS.WATER, { zone: '4', minutes: 12 });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(w.module.lastRun, { zone: 4, minutes: 12 });
  assert.equal(ack.data.message.fr, 'Zone 4 : arrosage pendant 12 min.');

  ack = await tap(ACTIONS.STOP);
  assert.equal(w.module.commands.at(-1), '40');
  assert.equal(ack.data.message.en, 'Watering stopped.');

  ack = await tap(ACTIONS.PROGRAM, { program: 'B' });
  assert.equal(w.module.commands.at(-1), '3801');
  assert.equal(ack.data.message.de, 'Programm B gestartet.');

  ack = await tap(ACTIONS.RAIN_DELAY, { days: 0 });
  assert.equal(w.module.commands.at(-1), '370000');
  assert.equal(ack.data.message.es, 'Retraso por lluvia cancelado.');
});

test('a Gladys older than 5.2.0 sends the tap without the form: asked to update', async (t) => {
  const w = await world(t);
  const ack = await w.fake.widgetAction(WIDGET_KEY, ACTIONS.WATER, {}, { settings: {} });
  assert.equal(ack.success, false);
  assert.match(ack.error, /5\.2\.0/);
});

test('the widget shows the controller chosen in its settings', async (t) => {
  const second = new FakeRainbird({ mac: MAC_2, modelId: 3, zones: [1, 2] });
  const w = await world(t, {
    modules: { [HOST_1]: new FakeRainbird(), [HOST_2]: second },
    config: {
      controller_1_host: HOST_1,
      controller_1_password: 'secret',
      controller_2_host: HOST_2,
      controller_2_password: 'secret',
      controller_2_name: 'Potager',
    },
  });
  assert.equal((await content(w)).components[0].text, 'Rain Bird ESP-TM2');
  const settings = { device: idsOf(w.gladys, MAC_2).device };
  assert.equal((await content(w, settings)).components[0].text, 'Potager');
  await w.fake.widgetAction(WIDGET_KEY, ACTIONS.STOP, {}, { settings });
  assert.equal(second.commands.at(-1), '40');
  assert.notEqual(w.module.commands.at(-1), '40');
  assert.ok(deviceId(w.gladys));
});
