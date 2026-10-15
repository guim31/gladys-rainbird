# Rain Bird for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) integration for **Rain Bird
irrigation controllers** with a **LNK or LNK2 Wi-Fi module** (ESP-TM2, ESP-Me,
ESP-ME3, ESP-RZXe, ST8x-WiFi, ARC8, TRU…), over the **local network**: no Rain
Bird account, no cloud. It talks the encrypted JSON-RPC protocol of the module
(`POST /stick`), the one of the Home Assistant `rainbird` integration and of
the [pyrainbird](https://github.com/allenporter/pyrainbird) library.

> **Developed without the hardware: feedback welcome.** The protocol and the
> test fixtures come from pyrainbird and Home Assistant, whose tests record the
> answers of real controllers; the encryption is checked byte for byte against
> pyrainbird's own code. Nothing was run against a real controller yet: please
> report what works and what does not in the
> [issues](https://github.com/guim31/gladys-rainbird/issues) or on the
> [Gladys forum](https://community.gladysassistant.com).

## Features

One Gladys device per controller (up to three), identified by the MAC address
of its module:

- **one switch per zone** wired on the controller: on while the zone waters;
  turning it on waters the zone for the minutes of the configuration (the
  controller stops it by itself), turning it off stops the watering;
- **rain sensor** (rain detected) and **rain delay** (days the schedule stays
  paused, adjustable from Gladys);
- **online** (the controller answers), and a badge local / unreachable;
- buttons **Stop watering** and **Run program A, B…** (the programs of the
  model).

On top of the device:

- a **dashboard widget**: the zones watering, the rain sensor and the rain
  delay, and the buttons _Water…_ (a zone, for a duration), _Stop_,
  _Program…_ and _Rain delay…_;
- **scene triggers**: _watering started_ and _watering finished_, filtered by
  controller, zone and who started it (the controller's schedule or Gladys),
  with the minutes watered;
- **scene actions**: water a zone for N minutes, stop the watering (one
  controller or all), run a program, set the rain delay;
- a **Test the connection** button in the Configuration screen.

Every text is in English, French, German and Spanish.

## Requirements

- Gladys Assistant **5.2.0** or later (the widget buttons open a form).
- A Rain Bird controller with a LNK / LNK2 Wi-Fi module, set up with the Rain
  Bird app, on the network Gladys reaches; its IP address (a fixed one is
  best) and the controller password chosen in the Rain Bird app.

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the
   address of this repository: `https://github.com/guim31/gladys-rainbird`
   (or install **Rain Bird** from the catalog once it is listed).
2. In **Configuration**, enter the address of the module (`192.168.1.20`), its
   password and a name; up to two more controllers below. Save, then click
   **Test the connection**.
3. Open the **Discover** tab and add the devices.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

- **Protocol**: each request is a JSON-RPC 2.0 call (`tunnelSip` carrying a
  controller command in hex, or `getWifiParams`), encrypted with AES-256-CBC,
  the key being the SHA-256 of the module password, and posted to
  `http(s)://<address>/stick`. Without a scheme in the address, HTTPS is tried
  first (newer LNK2 firmwares, self-signed certificate), then HTTP.
- **One request at a time**: the module serves one client and answers 503 when
  busy. The client queues the requests, waits 250 ms between two, retries a
  busy answer three times a second apart, and the integration reads each
  controller at most once a minute (1, 2 or 5 minutes in the configuration):
  about three requests per reading, the model and zones again every six
  hours.
- **Its own timer**: the devices are published with `should_poll: false` and
  read by a timer of the container (Gladys 5.2 does not poll external devices
  reliably, GladysAssistant/Gladys#3198), only for the controllers added to
  Gladys. A command is checked five seconds later, when the controller shows
  it. States are published when they change, and every six hours otherwise.
- **Identity** from the MAC address of the module (`getWifiParams`, of which
  only the MAC is kept: the same answer holds the Wi-Fi password), else the
  serial number, else the slot. Model, zones and identity are kept in
  `/data/rainbird-state.json` to publish the device while the controller is
  off.

## Limitations

- Local network only, through a LNK / LNK2 module.
- No zone names (they live in the Rain Bird cloud), no schedule editing.
- Turning a zone off stops every zone: the controller has no other stop
  command.
- A watering started from the controller shows up within the reading
  interval.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests use the fake Gladys of the SDK (`@gladysassistant/integration-sdk/testing`)
and a fake Rain Bird module (`test/helpers/fakeRainbird.js`, with the
encryption, also served over real HTTP), built from the answers recorded on
real controllers (`test/fixtures/rainbird/`). See [`CLAUDE.md`](CLAUDE.md) for
the project rules.

`scripts/probe.mjs` reads a real module **without sending any command** (model,
firmware, zones, rain sensor, rain delay, and how it refuses a wrong password),
printing nothing sensitive:

```bash
RAINBIRD_PASSWORD='…' node scripts/probe.mjs 192.168.1.20 --raw
```

Releases go through **Actions → Release** (it bumps the versions, rolls the
[changelog](CHANGELOG.md), tags and builds the image).

## Credits

- [pyrainbird](https://github.com/allenporter/pyrainbird) by Allen Porter,
  jbarrancos and contributors (MIT): the protocol, the command codes, the
  model table and the encryption scheme, rewritten here in JavaScript; the
  answers recorded in its tests are the fixtures of this repository.
- Home Assistant's
  [`rainbird`](https://github.com/home-assistant/core/tree/dev/homeassistant/components/rainbird)
  integration (Apache-2.0): the choice of entities, the MAC address identity,
  the one-request-at-a-time rule; its test fixtures too.
- The architecture and the conformity tests follow
  [gladys-wled](https://github.com/guim31/gladys-wled) and
  [gladys-pihole](https://github.com/guim31/gladys-pihole).

## Disclaimer

This project is not affiliated with, endorsed or sponsored by Rain Bird
Corporation. "Rain Bird" is a trademark of Rain Bird Corporation.

## License

Apache-2.0
