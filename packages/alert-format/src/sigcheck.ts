/**
 * Signature checks as data, so that every verification routine has exactly one
 * implementation of its check order but can run with either the synchronous
 * JS reference verifier or an injected (e.g. native, asynchronous) one.
 *
 * Verification routines are written as generators that `yield` a batch of
 * signature checks and receive one boolean per check back. `runSync` answers
 * with the JS reference; `runAsync` answers with an injected verifier and runs
 * the checks of one batch concurrently.
 */

import { contextMessage, verifyEd25519, verifyWithContext, type Context, type Ed25519Verifier } from './crypto.js';
import { PUBLIC_KEY_BYTES, SIGNATURE_BYTES } from './model.js';

export interface SignatureCheck {
  readonly context: Context;
  readonly body: Uint8Array;
  readonly signature: Uint8Array;
  readonly publicKey: Uint8Array;
}

export type Checks<R> = Generator<readonly SignatureCheck[], R, readonly boolean[]>;

export function runSync<R>(steps: Checks<R>): R {
  let step = steps.next([]);
  while (!step.done) {
    step = steps.next(step.value.map((c) => verifyWithContext(c.context, c.body, c.signature, c.publicKey)));
  }
  return step.value;
}

export async function runAsync<R>(steps: Checks<R>, verify: Ed25519Verifier = verifyEd25519): Promise<R> {
  let step = steps.next([]);
  while (!step.done) {
    step = steps.next(await Promise.all(step.value.map((c) => checkWith(verify, c))));
  }
  return step.value;
}

/** Length checks stay here, so an injected verifier never decides on malformed sizes. */
async function checkWith(verify: Ed25519Verifier, c: SignatureCheck): Promise<boolean> {
  if (c.signature.length !== SIGNATURE_BYTES || c.publicKey.length !== PUBLIC_KEY_BYTES) return false;
  try {
    return (await verify(c.signature, contextMessage(c.context, c.body), c.publicKey)) === true;
  } catch {
    return false;
  }
}
