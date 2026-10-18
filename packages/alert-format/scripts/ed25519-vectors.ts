/**
 * Ed25519 strictness vectors: raw (signature, message, public key) triples on
 * which Ed25519 implementations are known to disagree. Every Priedanga
 * verifier (JS reference, CryptoKit, BouncyCastle, future mesh firmware) must
 * return `expect` for each vector, except the ones marked `cofactorDependent`
 * (see SPEC.md §3.1).
 *
 * Everything is deterministic and derived from a PUBLIC seed: TESTS ONLY.
 */

import { ed25519, ED25519_TORSION_SUBGROUP } from '@noble/curves/ed25519.js';
import { bytesToNumberLE, numberToBytesLE } from '@noble/curves/utils.js';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { bytesToHex, concatBytes, hexToBytes } from '@noble/hashes/utils.js';
import { verifyEd25519 } from '../src/crypto.js';
import { encodeUtf8 } from '../src/utf8.js';

export interface Ed25519Vector {
  name: string;
  description: string;
  signature: string;
  message: string;
  publicKey: string;
  /** Result required from a strict RFC 8032 verifier (the JS reference). */
  expect: boolean;
  /**
   * Only crafted by the holder of the secret key, with a small-order component
   * in R or A. Cofactored verifiers (the JS reference) accept, cofactorless
   * ones (CryptoKit, BouncyCastle) reject. RFC 8032 allows either.
   */
  cofactorDependent?: true;
}

export interface Ed25519VectorFile {
  format: 'priedanga-ed25519-strict-vectors';
  version: 1;
  warning: string;
  vectors: Ed25519Vector[];
}

const Point = ed25519.Point;
const L = Point.Fn.ORDER;
const P = Point.Fp.ORDER;
const B = Point.BASE;
const mod = (n: bigint, m: bigint): bigint => ((n % m) + m) % m;
const le32 = (n: bigint): Uint8Array => numberToBytesLE(n, 32);
const challenge = (r: Uint8Array, a: Uint8Array, msg: Uint8Array): bigint => mod(bytesToNumberLE(sha512(concatBytes(r, a, msg))), L);

/** Torsion point of order 8. */
const T8 = Point.fromBytes(hexToBytes(ED25519_TORSION_SUBGROUP[1]!));

export function buildEd25519Vectors(): Ed25519VectorFile {
  const sk = sha256(encodeUtf8('priedanga TEST-ONLY ed25519 strictness key, never use in production'));
  const { scalar: a, pointBytes: A } = ed25519.utils.getExtendedPublicKey(sk);
  const r = mod(bytesToNumberLE(sha512(encodeUtf8('priedanga TEST-ONLY nonce'))), L);
  const R = B.multiply(r).toBytes();
  const msg = (i: number): Uint8Array => encodeUtf8(`priedanga/v1/test\u0000message ${i}`);

  /** First message index >= start whose challenge satisfies `want` for (Renc, Aenc). */
  const findMessage = (renc: Uint8Array, aenc: Uint8Array, want: (k: bigint) => boolean, start = 0): number => {
    for (let i = start; ; i++) if (want(challenge(renc, aenc, msg(i)))) return i;
  };

  const vectors: Ed25519Vector[] = [];
  const add = (v: Omit<Ed25519Vector, 'expect'> & { expect?: boolean }): void => {
    const reference = verifyEd25519(hexToBytes(v.signature), hexToBytes(v.message), hexToBytes(v.publicKey));
    if (v.expect !== undefined && v.expect !== reference) throw new Error(`${v.name}: reference returned ${reference}`);
    vectors.push({ ...v, expect: reference });
  };
  const hex = bytesToHex;

  // 1. Honest signature.
  const m0 = msg(0);
  const sig0 = ed25519.sign(m0, sk);
  add({ name: 'valid', description: 'Honest RFC 8032 signature', signature: hex(sig0), message: hex(m0), publicKey: hex(A), expect: true });
  add({ name: 'wrong_message', description: 'Valid signature, different message', signature: hex(sig0), message: hex(msg(1)), publicKey: hex(A), expect: false });
  add({ name: 'wrong_key', description: 'Valid signature, different public key', signature: hex(sig0), message: hex(m0), publicKey: hex(B.multiply(7n).toBytes()), expect: false });

  // 2. Malleability: S + L passes the group equation; strict verifiers require S < L.
  const s0 = bytesToNumberLE(sig0.slice(32));
  add({
    name: 's_plus_l',
    description: 'Non-canonical S (S + L): malleated copy of the valid signature',
    signature: hex(concatBytes(sig0.slice(0, 32), le32(s0 + L))),
    message: hex(m0),
    publicKey: hex(A),
    expect: false,
  });
  add({
    name: 's_high_bits',
    description: 'S + 2^255 (top bit set): must be rejected, not reduced',
    signature: hex(concatBytes(sig0.slice(0, 32), le32(s0 + (1n << 255n)))),
    message: hex(m0),
    publicKey: hex(A),
    expect: false,
  });

  // 3. Non-canonical R: identity encoded as y = p + 1. With r = 0 the equation holds,
  //    so only verifiers that decode R leniently (ZIP-215) or skip the byte check accept.
  {
    const renc = le32(P + 1n);
    const m = msg(2);
    const s = mod(challenge(renc, A, m) * a, L);
    add({
      name: 'noncanonical_r',
      description: 'R = identity encoded non-canonically (y = p + 1); equation holds',
      signature: hex(concatBytes(renc, le32(s))),
      message: hex(m),
      publicKey: hex(A),
      expect: false,
    });
  }

  // 4. Small-order public keys. Choose a message whose challenge is a multiple of 8, so
  //    S = r, R = rB satisfies the equation for every torsion A (cofactored and cofactorless).
  ED25519_TORSION_SUBGROUP.forEach((t, i) => {
    const aenc = hexToBytes(t);
    const m = msg(findMessage(R, aenc, (k) => k % 8n === 0n, 100 + i * 1000));
    add({
      name: `small_order_a_${i}`,
      description: `Public key is torsion point ${t}; equation holds`,
      signature: hex(concatBytes(R, le32(r))),
      message: hex(m),
      publicKey: t,
      expect: false,
    });
  });

  // 5. Non-canonical public-key encodings of the identity; equation holds for any message.
  for (const [name, aenc, description] of [
    ['noncanonical_a_y_p_plus_1', le32(P + 1n), 'Public key = identity encoded as y = p + 1'],
    ['noncanonical_a_x0_sign', concatBytes(le32(1n).slice(0, 31), Uint8Array.of(0x80)), 'Public key = identity with x = 0 but sign bit set'],
  ] as const) {
    add({ name, description: `${description}; equation holds`, signature: hex(concatBytes(R, le32(r))), message: hex(msg(3)), publicKey: hex(aenc), expect: false });
  }

  // 6. Point not on the curve.
  {
    let y = 2n;
    for (; ; y++) {
      try {
        Point.fromBytes(le32(y));
      } catch {
        break;
      }
    }
    add({ name: 'a_not_on_curve', description: `Public key y = ${y} has no matching x`, signature: hex(sig0), message: hex(m0), publicKey: hex(le32(y)), expect: false });
  }

  // 7. Mixed-order A (A + T8, not small order). With a challenge that is a multiple of 8
  //    both cofactored and cofactorless verifiers accept; otherwise only cofactored ones.
  {
    const amixed = Point.fromBytes(A).add(T8).toBytes();
    const sign = (m: Uint8Array): Uint8Array => concatBytes(R, le32(mod(r + challenge(R, amixed, m) * a, L)));
    const m8 = msg(findMessage(R, amixed, (k) => k % 8n === 0n, 20_000));
    add({ name: 'mixed_order_a_k_mult_8', description: 'Public key A + T8, challenge multiple of 8: all verifiers accept', signature: hex(sign(m8)), message: hex(m8), publicKey: hex(amixed), expect: true });
    const mx = msg(findMessage(R, amixed, (k) => k % 8n !== 0n, 30_000));
    add({ name: 'mixed_order_a', description: 'Public key A + T8, challenge not a multiple of 8', signature: hex(sign(mx)), message: hex(mx), publicKey: hex(amixed), cofactorDependent: true });
  }

  // 8. Mixed-order R (rB + T8) with an honest key.
  {
    const renc = B.multiply(r).add(T8).toBytes();
    const m = msg(40_000);
    add({
      name: 'mixed_order_r',
      description: 'R = rB + T8 with honest key: holds only in the cofactored equation',
      signature: hex(concatBytes(renc, le32(mod(r + challenge(renc, A, m) * a, L)))),
      message: hex(m),
      publicKey: hex(A),
      cofactorDependent: true,
    });
  }

  return {
    format: 'priedanga-ed25519-strict-vectors',
    version: 1,
    warning: 'All keys are derived from public seeds and are for TESTS ONLY. Never trust them in production.',
    vectors,
  };
}
