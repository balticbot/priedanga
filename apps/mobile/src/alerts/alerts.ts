/**
 * Verifying relay feeds and choosing what to show. No I/O, so the same code
 * runs in the app and in tests.
 */

import {
  appliesToArea,
  Category,
  decodeAlertBody,
  decodeAlertEnvelope,
  Level,
  verifyAlertAsync,
  type Alert,
  type Ed25519Verifier,
  type TrustStore,
} from '@priedanga/alert-format';
import type { RelayFeed } from '@priedanga/relay/schema';
import { hexToBytes } from '../pack/hex';

export interface ShownAlert {
  alert: Alert;
  /** Signed by a relay (copied from the source), not by the authority. */
  relayed: boolean;
  issuerName: string;
  /** Still within its validity window right now. */
  live: boolean;
  /** The verified envelope as received (needed to relay it over Tiltas). */
  envelope: Uint8Array;
  /** How it reached this phone. */
  via: 'feed' | 'mesh';
}

export interface VerifiedFeed {
  alerts: ShownAlert[];
  /** Items that failed verification and are not shown. */
  rejected: number;
  generated: string;
}

/**
 * Verify every item. Live items must pass full verification at `now`.
 * Expired items are shown as history only if they verified at the time they
 * were issued (signature, issuer role, certificate window and area scope);
 * any other failure drops the item.
 */
export async function verifyFeed(feed: RelayFeed, store: TrustStore, now: number, ed25519?: Ed25519Verifier): Promise<VerifiedFeed> {
  if (feed.format !== 'priedanga-relay-feed' || feed.version !== 1 || !Array.isArray(feed.items)) {
    throw new Error('unsupported feed format');
  }
  const alerts: ShownAlert[] = [];
  let rejected = 0;
  const seen = new Set<string>();

  for (const hex of feed.items) {
    let envelope: Uint8Array;
    try {
      envelope = hexToBytes(hex);
    } catch {
      rejected++;
      continue;
    }
    let r = await verifyAlertAsync(envelope, store, now, ed25519);
    let live = true;
    if (!r.ok && r.reason === 'EXPIRED') {
      try {
        const issued = decodeAlertBody(decodeAlertEnvelope(envelope).body).issued;
        r = await verifyAlertAsync(envelope, store, issued, ed25519);
        live = false;
      } catch {
        // malformed: falls through as rejected
      }
    }
    if (!r.ok) {
      rejected++;
      continue;
    }
    const key = alertKey(r.alert);
    if (seen.has(key)) continue;
    seen.add(key);
    alerts.push({ alert: r.alert, relayed: r.relayed, issuerName: r.issuer.name, live, envelope, via: 'feed' });
  }
  alerts.sort((a, b) => b.alert.issued - a.alert.issued);
  return { alerts, rejected, generated: feed.generated };
}

export const alertKey = (a: Alert): string => Array.from(a.id, (b) => b.toString(16).padStart(2, '0')).join('');

/** Feed and mesh alerts together, newest first; the feed copy wins when both have an alert. */
export function mergeAlerts(feed: readonly ShownAlert[], mesh: readonly ShownAlert[]): ShownAlert[] {
  const seen = new Set(feed.map((a) => alertKey(a.alert)));
  return [...feed, ...mesh.filter((a) => !seen.has(alertKey(a.alert)))].sort((a, b) => b.alert.issued - a.alert.issued);
}

/**
 * The air-alert state for the user's area: the newest live air alert that
 * covers it. A white (all-clear) message is returned too, so the app can say
 * so. Without a known area, only nationwide alerts count.
 */
export function currentAirAlert(alerts: readonly ShownAlert[], areaCode: number | null): ShownAlert | null {
  for (const a of alerts) {
    if (!a.live || a.alert.category !== Category.Air) continue;
    const covers = areaCode === null ? a.alert.areas.includes(0) : appliesToArea(a.alert, areaCode);
    if (covers) return a;
  }
  return null;
}

export function isDanger(a: ShownAlert | null): boolean {
  return a !== null && a.alert.level !== Level.White;
}
