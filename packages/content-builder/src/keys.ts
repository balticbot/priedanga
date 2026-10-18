/**
 * DEVELOPMENT signing keys.
 *
 * Production keys never live on a developer machine: the root key is held
 * offline by custodians and the content key in an HSM. For development, this
 * module creates a local dev root and dev content key under `secrets/dev/`
 * (git-ignored) the first time a pack is built.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { createCertificate, generateSecretKey, getPublicKey, Role } from '@priedanga/alert-format';

export interface DevKeys {
  rootPublicKey: Uint8Array;
  contentSecretKey: Uint8Array;
  contentCertificate: Uint8Array;
  relaySecretKey: Uint8Array;
  /** Live relay for the PAGD warning feed. Window reaches back so recent history verifies. */
  relayCertificate: Uint8Array;
  /** TEST issuer for demo alerts; the app labels everything it signs as a test. */
  testIssuerSecretKey: Uint8Array;
  testIssuerCertificate: Uint8Array;
}

function loadOrCreate(file: string): Uint8Array {
  if (existsSync(file)) return hexToBytes(readFileSync(file, 'utf8').trim());
  const sk = generateSecretKey();
  writeFileSync(file, bytesToHex(sk) + '\n', { mode: 0o600 });
  return sk;
}

export function loadDevKeys(secretsDir: string, now: number): DevKeys {
  mkdirSync(secretsDir, { recursive: true, mode: 0o700 });
  const rootSk = loadOrCreate(join(secretsDir, 'root.sk'));
  const contentSk = loadOrCreate(join(secretsDir, 'content.sk'));
  const contentCertificate = createCertificate(rootSk, {
    publicKey: getPublicKey(contentSk),
    role: Role.Content,
    validFrom: now - 86_400,
    validTo: now + 365 * 86_400,
    name: 'DEV content key — not for production',
  });
  const relaySk = loadOrCreate(join(secretsDir, 'relay.sk'));
  const relayCertificate = createCertificate(rootSk, {
    publicKey: getPublicKey(relaySk),
    role: Role.LiveRelay,
    validFrom: now - 400 * 86_400,
    validTo: now + 365 * 86_400,
    areas: [0],
    name: 'DEV relay — PAGD warning feed, not for production',
  });
  const testSk = loadOrCreate(join(secretsDir, 'test-issuer.sk'));
  const testIssuerCertificate = createCertificate(rootSk, {
    publicKey: getPublicKey(testSk),
    role: Role.TestIssuer,
    validFrom: now - 86_400,
    validTo: now + 365 * 86_400,
    areas: [0],
    name: 'DEV TEST issuer — demo alerts only',
  });
  return {
    rootPublicKey: getPublicKey(rootSk),
    testIssuerSecretKey: testSk,
    testIssuerCertificate,
    contentSecretKey: contentSk,
    contentCertificate,
    relaySecretKey: relaySk,
    relayCertificate,
  };
}
