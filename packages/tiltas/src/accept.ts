/**
 * What a phone does with an envelope that arrived over the mesh (SPEC §4):
 * verify it fully, then decide whether and how to relay it. Shared by the
 * app and the simulation.
 */

import {
  DEFAULT_POLICY,
  decodeAlertEnvelope,
  Level,
  MsgType,
  verifyAlertAsync,
  withHops,
  type Alert,
  type Ed25519Verifier,
  type TrustStore,
  type VerifyResult,
} from '@priedanga/alert-format';
import { meshKey, type InventoryEntry } from './protocol.js';

/** Inventory priority (SPEC §2.1): 3 red, 2 yellow, 1 all-clear or cancel, 0 other. */
export function priorityOf(alert: Alert): number {
  if (alert.msgType === MsgType.Cancel) return 1;
  switch (alert.level) {
    case Level.Red:
      return 3;
    case Level.Yellow:
    case Level.YellowAfterRed:
      return 2;
    case Level.White:
      return 1;
    default:
      return 0;
  }
}

export interface Offer extends InventoryEntry {
  /** Envelope as it will be served: hops already incremented. */
  envelope: Uint8Array;
}

export type Acceptance =
  | { ok: true; key: Uint8Array; result: Extract<VerifyResult, { ok: true }>; offer: Offer | null }
  | { ok: false; key: Uint8Array | null; reason: string };

/**
 * Verify an envelope at `now`. On success returns the offer to put in the
 * served set (hops + 1), or null if relaying would exceed the hop limit.
 */
export async function acceptEnvelope(envelope: Uint8Array, store: TrustStore, now: number, ed25519?: Ed25519Verifier): Promise<Acceptance> {
  let key: Uint8Array | null = null;
  let hops = 0;
  try {
    const env = decodeAlertEnvelope(envelope);
    key = meshKey(env.body);
    hops = env.hops;
  } catch {
    // verification below reports the reason
  }
  const result = await verifyAlertAsync(envelope, store, now, ed25519);
  if (!result.ok) return { ok: false, key, reason: result.reason };
  const offer =
    hops + 1 > DEFAULT_POLICY.maxHops
      ? null
      : { key: key!, priority: priorityOf(result.alert), expires: result.alert.expires, envelope: withHops(envelope, hops + 1) };
  return { ok: true, key: key!, result, offer };
}
