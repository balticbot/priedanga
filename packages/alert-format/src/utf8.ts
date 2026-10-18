/**
 * Strict UTF-8 encode/decode.
 *
 * Implemented here rather than relying on TextEncoder/TextDecoder so that
 * behaviour is identical on every JS runtime (Node, browsers, Hermes) and
 * so that invalid input is always rejected, never replaced with U+FFFD.
 */

export class Utf8Error extends Error {
  override name = 'Utf8Error';
}

export function encodeUtf8(str: string): Uint8Array {
  const out: number[] = [];
  for (const ch of str) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0xd800 && cp <= 0xdfff) {
      throw new Utf8Error('lone surrogate in string');
    }
    if (cp < 0x80) {
      out.push(cp);
    } else if (cp < 0x800) {
      out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return Uint8Array.from(out);
}

export function decodeUtf8(bytes: Uint8Array): string {
  let out = '';
  let i = 0;
  while (i < bytes.length) {
    const b0 = bytes[i]!;
    let cp: number;
    let need: number;
    let min: number;
    if (b0 < 0x80) {
      cp = b0;
      need = 0;
      min = 0;
    } else if ((b0 & 0xe0) === 0xc0) {
      cp = b0 & 0x1f;
      need = 1;
      min = 0x80;
    } else if ((b0 & 0xf0) === 0xe0) {
      cp = b0 & 0x0f;
      need = 2;
      min = 0x800;
    } else if ((b0 & 0xf8) === 0xf0) {
      cp = b0 & 0x07;
      need = 3;
      min = 0x10000;
    } else {
      throw new Utf8Error(`invalid UTF-8 lead byte at ${i}`);
    }
    for (let k = 1; k <= need; k++) {
      const b = bytes[i + k];
      if (b === undefined || (b & 0xc0) !== 0x80) {
        throw new Utf8Error(`invalid UTF-8 continuation byte at ${i + k}`);
      }
      cp = (cp << 6) | (b & 0x3f);
    }
    if (cp < min) throw new Utf8Error('overlong UTF-8 encoding');
    if (cp >= 0xd800 && cp <= 0xdfff) throw new Utf8Error('UTF-8 encoded surrogate');
    if (cp > 0x10ffff) throw new Utf8Error('code point out of range');
    out += String.fromCodePoint(cp);
    i += need + 1;
  }
  return out;
}
