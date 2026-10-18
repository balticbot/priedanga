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
  return { rootPublicKey: getPublicKey(rootSk), contentSecretKey: contentSk, contentCertificate };
}
