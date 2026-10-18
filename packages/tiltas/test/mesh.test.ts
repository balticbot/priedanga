/**
 * Crowd simulation: phones meet at random and run real sync sessions through
 * the wire frames. Checks that genuine alerts spread, forged ones never do,
 * and the hop limit and caps hold.
 */

import { decodeAlertEnvelope, encodeAlertEnvelope, Level } from '@priedanga/alert-format';
import { describe, expect, it } from 'vitest';
import { acceptEnvelope } from '../src/accept.js';
import { LIMITS, MeshNode, type PeerLink } from '../src/node.js';
import { encodeChunk, encodeInventory, keyHex, meshKey } from '../src/protocol.js';
import { alert, forgerKey, NOW, store } from './fixtures.js';

/** Deterministic PRNG so failures reproduce. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

async function seed(node: MeshNode, envelope: Uint8Array, now = NOW) {
  const a = await acceptEnvelope(envelope, store, now);
  if (!a.ok || !a.offer) throw new Error('seed failed');
  node.offer(a.offer, now);
}

async function meet(central: MeshNode, peripheral: MeshNode | PeerLink, now: number, peerId = 'x') {
  const link = peripheral instanceof MeshNode ? peripheral.link(central.id, now) : peripheral;
  const id = peripheral instanceof MeshNode ? peripheral.id : peerId;
  if (!central.canSync(id, now)) return;
  const report = central.sync(id, link, now);
  await central.processInbox(store, now);
  return report;
}

/** Random encounters in a crowd; each round every phone meets one random other phone. */
async function crowd(nodes: MeshNode[], rounds: number, random: () => number, extra?: (round: number, now: number) => Promise<void>) {
  for (let r = 0; r < rounds; r++) {
    const now = NOW + r * 61; // past the per-peer cool-down
    for (const n of nodes) {
      const other = nodes[Math.floor(random() * nodes.length)]!;
      if (other !== n) await meet(n, other, now);
    }
    await extra?.(r, now);
  }
}

describe('mesh simulation', () => {
  it('a genuine alert reaches the whole crowd with hops incremented', async () => {
    const nodes = Array.from({ length: 60 }, (_, i) => new MeshNode(`p${i}`));
    const red = alert({ level: Level.Red });
    await seed(nodes[0]!, red);
    await crowd(nodes, 12, rng(7));
    const key = keyHex(meshKey(decodeAlertEnvelope(red).body));
    expect(nodes.filter((n) => n.served.has(key)).length).toBe(60);
    const hops = nodes.map((n) => decodeAlertEnvelope(n.served.get(key)!.envelope).hops);
    expect(Math.min(...hops)).toBe(1);
    expect(Math.max(...hops)).toBeLessThanOrEqual(16);
  });

  it('forged alerts never leave the forger, and a forger cannot block a genuine alert', async () => {
    const nodes = Array.from({ length: 40 }, (_, i) => new MeshNode(`p${i}`));
    const genuine = alert({ level: Level.Yellow });
    const genuineEnv = decodeAlertEnvelope(genuine);
    const genuineKey = meshKey(genuineEnv.body);
    const forged = alert({ key: forgerKey, level: Level.Red }); // valid shape, no certificate
    const forgedEnv = decodeAlertEnvelope(forged);
    // Forger 1 serves a forged alert under its true key; forger 2 claims the
    // genuine alert's key but serves different bytes.
    const tampered = encodeAlertEnvelope({ body: forgedEnv.body, signature: genuineEnv.signature, hops: 0 });
    const forger = (served: Uint8Array, key: Uint8Array): PeerLink => ({
      readInventory: () => encodeInventory([{ key, priority: 3, expires: NOW + 3600 }]),
      writeSelect: () => {},
      readChunk: () => encodeChunk(served, 0),
    });
    await seed(nodes[0]!, genuine);
    const random = rng(11);
    await crowd(nodes, 12, random, async (_, now) => {
      for (let i = 0; i < 5; i++) {
        const victim = nodes[Math.floor(random() * nodes.length)]!;
        await meet(victim, forger(forged, meshKey(forgedEnv.body)), now, `forger-a-${i}`);
        await meet(victim, forger(tampered, genuineKey), now, `forger-b-${i}`);
      }
    });
    const forgedKey = keyHex(meshKey(forgedEnv.body));
    expect(nodes.some((n) => n.served.has(forgedKey))).toBe(false);
    expect(nodes.every((n) => n.served.has(keyHex(genuineKey)))).toBe(true);
    expect(nodes.filter((n) => n.rejected.has(forgedKey)).length).toBeGreaterThan(0);
  });

  it('stops relaying at 16 hops', async () => {
    const chain = Array.from({ length: 20 }, (_, i) => new MeshNode(`c${i}`));
    const red = alert();
    await seed(chain[0]!, red); // seeded from the feed: served with hops 1
    for (let i = 1; i < chain.length; i++) await meet(chain[i]!, chain[i - 1]!, NOW);
    const key = keyHex(meshKey(decodeAlertEnvelope(red).body));
    const reached = chain.map((n) => n.served.has(key));
    // c0..c15 relay hops 1..16; c16 receives hops 16, shows it but does not relay.
    expect(reached.lastIndexOf(true)).toBe(15);
    const last = new MeshNode('end');
    expect((await acceptEnvelope(chain[15]!.served.get(key)!.envelope, store, NOW)).ok).toBe(true);
    await meet(last, chain[16]!, NOW);
    expect(last.served.size + last.rejected.size).toBe(0);
  });

  it('keeps at most 32 alerts, dropping the least urgent', async () => {
    const node = new MeshNode('n');
    for (let i = 0; i < 20; i++) await seed(node, alert({ level: Level.White, expiresIn: 3600 + i }));
    for (let i = 0; i < 20; i++) await seed(node, alert({ level: Level.Red, expiresIn: 3600 + i }));
    expect(node.served.size).toBe(32);
    const priorities = [...node.served.values()].map((o) => o.priority);
    expect(priorities.filter((p) => p === 3).length).toBe(20);
    expect(node.inventoryFrame(NOW).length).toBe(2 + 13 * 32);
  });

  it('drops expired alerts and never fetches them', async () => {
    const a = new MeshNode('a');
    const b = new MeshNode('b');
    await seed(a, alert({ expiresIn: 30 }));
    const later = NOW + 31;
    expect(a.inventoryFrame(later)).toEqual(Uint8Array.of(1, 0));
    await meet(b, a, later);
    expect(b.served.size + b.inbox.size).toBe(0);
  });

  it('penalises a peer that sends junk', async () => {
    const node = new MeshNode('n');
    const junk: PeerLink = { readInventory: () => Uint8Array.of(1, 5), writeSelect: () => {}, readChunk: () => new Uint8Array() };
    const report = await meet(node, junk, NOW, 'bad');
    expect(report?.failed).toBe(true);
    expect(node.canSync('bad', NOW + LIMITS.cooldownSeconds)).toBe(false);
    expect(node.canSync('bad', NOW + LIMITS.penaltySeconds)).toBe(true);
  });
});
