/**
 * Reference model of one Tiltas phone (SPEC §3–§5), transport-agnostic.
 * The Swift engine implements the same rules over CoreBluetooth; this model
 * drives the crowd simulation in the tests and documents the algorithm.
 */

import type { Ed25519Verifier, TrustStore } from '@priedanga/alert-format';
import { acceptEnvelope, type Acceptance, type Offer } from './accept.js';
import {
  byUrgency,
  checkEnvelope,
  decodeChunk,
  decodeInventory,
  decodeSelect,
  encodeChunk,
  encodeInventory,
  encodeSelect,
  keyHex,
  MAX_INVENTORY,
  NOT_AVAILABLE,
  reassemble,
  type Chunk,
} from './protocol.js';

export const LIMITS = Object.freeze({
  served: MAX_INVENTORY,
  inbox: 16,
  fetchesPerSession: 8,
  cooldownSeconds: 60,
  penaltySeconds: 300,
  rejectSeconds: 3600,
});

/** The peripheral side of a peer, as seen by a central during one session. */
export interface PeerLink {
  readInventory(): Uint8Array;
  writeSelect(frame: Uint8Array): void;
  readChunk(): Uint8Array;
}

export interface SessionReport {
  fetched: number;
  failed: boolean;
}

export class MeshNode {
  /** Verified alerts this node serves, by key hex. */
  readonly served = new Map<string, Offer>();
  /** Unverified envelopes waiting for verification, by key hex. Never served. */
  readonly inbox = new Map<string, Uint8Array>();
  /** Keys that failed verification, with the time they were rejected. */
  readonly rejected = new Map<string, number>();
  private readonly cooldownUntil = new Map<string, number>();
  private readonly selection = new Map<string, { key: string; index: number }>();

  constructor(readonly id: string) {}

  // ---- served set -------------------------------------------------------

  offer(o: Offer, now: number): void {
    this.served.set(keyHex(o.key), o);
    this.prune(now);
  }

  private prune(now: number): void {
    for (const [k, o] of this.served) if (o.expires <= now) this.served.delete(k);
    if (this.served.size <= LIMITS.served) return;
    const keep = [...this.served.entries()].sort(([, a], [, b]) => byUrgency(a, b)).slice(0, LIMITS.served);
    this.served.clear();
    for (const [k, o] of keep) this.served.set(k, o);
  }

  holds(keyHexValue: string, now: number): boolean {
    const r = this.rejected.get(keyHexValue);
    if (r !== undefined && now - r >= LIMITS.rejectSeconds) this.rejected.delete(keyHexValue);
    return this.served.has(keyHexValue) || this.inbox.has(keyHexValue) || this.rejected.has(keyHexValue);
  }

  // ---- peripheral side ----------------------------------------------------

  inventoryFrame(now: number): Uint8Array {
    this.prune(now);
    return encodeInventory([...this.served.values()].map(({ key, priority, expires }) => ({ key, priority, expires })));
  }

  link(central: string, now: number): PeerLink {
    return {
      readInventory: () => this.inventoryFrame(now),
      writeSelect: (frame) => {
        const { key, index } = decodeSelect(frame);
        this.selection.set(central, { key: keyHex(key), index });
      },
      readChunk: () => {
        const sel = this.selection.get(central);
        const offer = sel && this.served.get(sel.key);
        return sel && offer ? encodeChunk(offer.envelope, sel.index) : NOT_AVAILABLE;
      },
    };
  }

  // ---- central side -------------------------------------------------------

  canSync(peer: string, now: number): boolean {
    return (this.cooldownUntil.get(peer) ?? 0) <= now;
  }

  /** One sync session against `peer` (SPEC §3). Fetched envelopes land in the inbox. */
  sync(peer: string, link: PeerLink, now: number): SessionReport {
    let fetched = 0;
    let failed = false;
    try {
      const missing = decodeInventory(link.readInventory())
        .filter((e) => e.expires > now && !this.holds(keyHex(e.key), now))
        .sort(byUrgency)
        .slice(0, LIMITS.fetchesPerSession);
      for (const entry of missing) {
        if (this.inbox.size >= LIMITS.inbox) break;
        const chunks: Chunk[] = [];
        link.writeSelect(encodeSelect(entry.key, 0));
        const first = decodeChunk(link.readChunk());
        if (first.total === 0) continue; // gone since the inventory was read
        chunks.push(first);
        for (let i = 1; i < first.total; i++) {
          link.writeSelect(encodeSelect(entry.key, i));
          chunks.push(decodeChunk(link.readChunk()));
        }
        const envelope = reassemble(chunks);
        checkEnvelope(envelope, entry.key);
        this.inbox.set(keyHex(entry.key), envelope);
        fetched++;
      }
    } catch {
      failed = true;
    }
    this.cooldownUntil.set(peer, now + (failed ? LIMITS.penaltySeconds : LIMITS.cooldownSeconds));
    return { fetched, failed };
  }

  /** Verify everything in the inbox; verified alerts join the served set (SPEC §4). */
  async processInbox(store: TrustStore, now: number, ed25519?: Ed25519Verifier): Promise<Acceptance[]> {
    const out: Acceptance[] = [];
    for (const [k, envelope] of [...this.inbox]) {
      this.inbox.delete(k);
      const a = await acceptEnvelope(envelope, store, now, ed25519);
      if (a.ok) {
        if (a.offer) this.offer(a.offer, now);
      } else {
        this.rejected.set(k, now);
      }
      out.push(a);
    }
    return out;
  }
}
