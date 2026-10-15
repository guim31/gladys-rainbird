// -----------------------------------------------------------------------------
// The one function that talks to the network: a POST of a binary body on
// node:http / node:https. Not on fetch: the newer LNK2 firmwares serve HTTPS
// with a self-signed certificate, which fetch cannot accept for one host only;
// node:https can, per request. The payload is encrypted with the module
// password either way (src/rainbird/crypto.js).
//
// The client takes this function as a parameter: the tests replace it with an
// in-memory module (test/helpers/fakeRainbird.js).
// -----------------------------------------------------------------------------

import http from 'node:http';
import https from 'node:https';

const MAX_BODY_BYTES = 256 * 1024;

/**
 * @param {string} url absolute URL
 * @param {object} [options]
 * @param {Record<string, string>} [options.headers]
 * @param {Buffer} [options.body]
 * @param {boolean} [options.insecure] accept a certificate that does not verify (HTTPS only)
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ status: number, body: Buffer }>}
 */
export function httpRequest(
  url,
  { headers = {}, body, insecure = false, timeoutMs = 10_000 } = {},
) {
  const target = new URL(url);
  const isHttps = target.protocol === 'https:';
  return new Promise((resolve, reject) => {
    const request = (isHttps ? https : http).request(
      target,
      {
        method: 'POST',
        headers: { ...headers, 'content-length': body?.length ?? 0 },
        timeout: timeoutMs,
        // The module's certificate is self-signed: the payload encryption,
        // not TLS, protects the exchange.
        ...(isHttps ? { rejectUnauthorized: !insecure } : {}),
      },
      (response) => {
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            request.destroy(new Error('Response too large'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () =>
          resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks) }),
        );
        response.on('error', reject);
      },
    );
    request.on('timeout', () => {
      const error = new Error(`Timed out after ${timeoutMs} ms`);
      error.code = 'ETIMEDOUT';
      request.destroy(error);
    });
    request.on('error', reject);
    request.end(body);
  });
}
