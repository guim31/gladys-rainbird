# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.1] - 2026-10-15

### Added

- Rain Bird irrigation controllers with a LNK or LNK2 Wi-Fi module, over the
  local network (no Rain Bird account, no cloud), up to three controllers.
- One device per controller: a switch per zone (on while it waters; on waters
  it for the minutes of the configuration, off stops the watering), the rain
  sensor, the rain delay in days (adjustable), online, and buttons to stop the
  watering and to run each program of the model.
- A dashboard widget: the zones watering, the rain sensor and the rain delay,
  with the buttons _Water…_ (a zone, for a duration), _Stop_, _Program…_ and
  _Rain delay…_ (Gladys 5.2.0 or later).
- Scene triggers _Rain Bird watering started_ and _Rain Bird watering
  finished_, filtered by controller, zone and who started it, with the minutes
  watered.
- Scene actions: water a zone for some minutes, stop the watering, run a
  program, set the rain delay.
- A _Test the connection_ button in the Configuration screen.
- Feature names, messages and documentation in English, French, German and
  Spanish.
- Developed without the hardware: feedback welcome.

[Unreleased]: https://github.com/guim31/gladys-rainbird/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-rainbird/releases/tag/v1.0.1
