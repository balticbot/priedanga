/**
 * Tiltas decisions in the app, without I/O: what to show from mesh arrivals,
 * what to reject, and what to serve to nearby phones (packages/tiltas/SPEC.md §4).
 */

import type { Ed25519Verifier, TrustStore } from '@priedanga/alert-format';
import { acceptEnvelope, keyHex } from '@priedanga/tiltas';
import { alertKey, type ShownAlert } from '../alerts/alerts';

export interface NativeOffer {
  envelope: string;
  priority: number;
  expires: number;
}

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/**
 * Verify envelopes fetched from nearby phones. Only fully verified, live
 * alerts are returned; every failure is reported by mesh key so the native
 * side does not fetch it again.
 */
export async function processArrivals(
  envelopes: readonly Uint8Array[],
  store: TrustStore,
  now: number,
  ed25519?: Ed25519Verifier,
): Promise<{ accepted: ShownAlert[]; rejectedKeys: string[] }> {
  const accepted: ShownAlert[] = [];
  const rejectedKeys: string[] = [];
  for (const envelope of envelopes) {
    const a = await acceptEnvelope(envelope, store, now, ed25519);
    if (a.ok) {
      const { alert, relayed, issuer } = a.result;
      accepted.push({ alert, relayed, issuerName: issuer.name, live: true, envelope, via: 'mesh' });
    } else if (a.key) {
      rejectedKeys.push(keyHex(a.key));
    }
  }
  return { accepted, rejectedKeys };
}

/**
 * What this phone serves: every live alert it has verified, from any source,
 * re-verified now and with hops + 1. Alerts at the hop limit are left out.
 */
export async function buildOffers(alerts: readonly ShownAlert[], store: TrustStore, now: number, ed25519?: Ed25519Verifier): Promise<NativeOffer[]> {
  const offers: NativeOffer[] = [];
  const seen = new Set<string>();
  for (const item of alerts) {
    const id = alertKey(item.alert);
    if (!item.live || seen.has(id)) continue;
    seen.add(id);
    const a = await acceptEnvelope(item.envelope, store, now, ed25519);
    if (a.ok && a.offer) offers.push({ envelope: toHex(a.offer.envelope), priority: a.offer.priority, expires: a.offer.expires });
  }
  return offers;
}

/** Keep mesh alerts that are still live, one per alert ID. */
export function liveMeshAlerts(alerts: readonly ShownAlert[], now: number): ShownAlert[] {
  const byId = new Map<string, ShownAlert>();
  for (const a of alerts) if (a.alert.expires > now) byId.set(alertKey(a.alert), a);
  return [...byId.values()].sort((a, b) => b.alert.issued - a.alert.issued);
}
