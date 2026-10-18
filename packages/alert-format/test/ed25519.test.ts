import { readFileSync } from 'node:fs';
import { ed25519 } from '@noble/curves/ed25519.js';
import { hexToBytes } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';
import { buildEd25519Vectors, type Ed25519VectorFile } from '../scripts/ed25519-vectors.js';
import { verifyEd25519 } from '../src/index.js';

const file: Ed25519VectorFile = JSON.parse(
  readFileSync(new URL('../test-vectors/ed25519-strict.json', import.meta.url), 'utf8'),
) as Ed25519VectorFile;

const args = (v: Ed25519VectorFile['vectors'][number]) =>
  [hexToBytes(v.signature), hexToBytes(v.message), hexToBytes(v.publicKey)] as const;

describe('Ed25519 strictness vectors', () => {
  it('are up to date with the generator (run `npm run vectors`)', () => {
    expect(buildEd25519Vectors()).toEqual(file);
  });

  it.each(file.vectors.map((v) => [v.name, v] as const))('%s', (_name, v) => {
    expect(verifyEd25519(...args(v))).toBe(v.expect);
  });

  // The vectors are only useful if they separate strict from lenient verifiers.
  it.each(
    file.vectors
      .filter((v) => /^(small_order_a_|noncanonical_r|noncanonical_a_)/.test(v.name))
      .map((v) => [v.name, v] as const),
  )('%s is accepted by a lenient (ZIP-215) verifier', (_name, v) => {
    expect(ed25519.verify(...args(v), { zip215: true })).toBe(true);
  });

  it('rejects malformed lengths without throwing', () => {
    const v = file.vectors[0]!;
    const [sig, msg, pk] = args(v);
    expect(verifyEd25519(sig.slice(1), msg, pk)).toBe(false);
    expect(verifyEd25519(sig, msg, pk.slice(1))).toBe(false);
  });
});
