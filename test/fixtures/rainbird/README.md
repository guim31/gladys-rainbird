# Rain Bird fixtures

- `sip-answers.json`: hex answers of real controllers and the requests the
  Rain Bird app sends, from the tests of
  [pyrainbird](https://github.com/allenporter/pyrainbird) (MIT) and of the
  [Home Assistant integration](https://github.com/home-assistant/core/tree/dev/tests/components/rainbird)
  (Apache-2.0). The `getWifiParams` answer is anonymized.
- `encryption-vectors.json`: payloads encrypted by pyrainbird's own
  `encryption.py` (run with pycryptodome), password `test-password`: the
  decryption of `src/rainbird/crypto.js` is checked against an independent
  implementation, not only against itself.

No real address, MAC, serial number or password of any user.
