// -----------------------------------------------------------------------------
// Payload encryption of the Rain Bird LNK / LNK2 Wi-Fi module.
//
// Every JSON-RPC request and answer posted to `/stick` is encrypted with the
// module password, the scheme of pyrainbird (allenporter/pyrainbird, MIT,
// `encryption.py`), rewritten here:
//
//   body = SHA-256(plaintext) (32 bytes) || IV (16 bytes) || AES-256-CBC(...)
//
// The AES key is SHA-256(password). The plaintext is padded with NUL bytes to
// a multiple of 16 (no PKCS#7); the module pads its answers with NUL, line
// feeds or 0x10 bytes, all stripped after decryption. The leading hash is not
// checked by pyrainbird on the answers, nor here.
// -----------------------------------------------------------------------------

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const BLOCK = 16;
const HEADER = 32 + BLOCK;

const sha256 = (data) => createHash('sha256').update(data).digest();

/**
 * @param {string} text the JSON-RPC request
 * @param {string} password the module password
 * @param {Buffer} [iv] fixed IV (tests); random otherwise
 * @returns {Buffer}
 */
export function encryptPayload(text, password, iv = randomBytes(BLOCK)) {
  const plain = Buffer.from(text, 'utf8');
  const padded = Buffer.alloc(Math.ceil(plain.length / BLOCK) * BLOCK);
  plain.copy(padded);
  const cipher = createCipheriv('aes-256-cbc', sha256(Buffer.from(password, 'utf8')), iv);
  cipher.setAutoPadding(false);
  return Buffer.concat([sha256(plain), iv, cipher.update(padded), cipher.final()]);
}

/**
 * @param {Buffer} body the encrypted answer
 * @param {string} password
 * @returns {string} the JSON text, padding stripped
 * @throws when the body cannot be an encrypted payload
 */
export function decryptPayload(body, password) {
  if (!Buffer.isBuffer(body) || body.length < HEADER + BLOCK || (body.length - HEADER) % BLOCK) {
    throw new Error(`Not an encrypted payload (${body?.length ?? 0} bytes)`);
  }
  const decipher = createDecipheriv(
    'aes-256-cbc',
    sha256(Buffer.from(password, 'utf8')),
    body.subarray(32, HEADER),
  );
  decipher.setAutoPadding(false);
  const plain = Buffer.concat([decipher.update(body.subarray(HEADER)), decipher.final()]);
  // NUL, 0x10, line feed and spaces: whatever pads the end of the JSON.
  return trimPadding(plain.toString('utf8'));
}

/** Drop the trailing bytes up to a space (NUL, 0x10, line feed, spaces). */
function trimPadding(text) {
  let end = text.length;
  while (end > 0 && text.charCodeAt(end - 1) <= 0x20) {
    end -= 1;
  }
  return text.slice(0, end);
}
