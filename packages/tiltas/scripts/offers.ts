/**
 * Turn a relay feed into offers.json for the macOS test peer (tiltas-peer).
 *
 *   npm run offers -w @priedanga/tiltas -- [feed-url] > offers.json
 *
 * Development seeding tool: it does not verify the alerts (it has no trust
 * store). Phones that fetch them verify every one before showing or relaying.
 */

import { decodeAlertBody, decodeAlertEnvelope, withHops } from '@priedanga/alert-format';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { priorityOf } from '../src/accept.js';

const url = process.argv[2] ?? 'http://localhost:8787/feed.json';
const feed = (await (await fetch(url)).json()) as { items: string[] };
const now = Math.floor(Date.now() / 1000);

const offers = feed.items.flatMap((hex) => {
  const envelope = hexToBytes(hex);
  const env = decodeAlertEnvelope(envelope);
  const alert = decodeAlertBody(env.body);
  if (alert.expires <= now) return [];
  return [{ envelope: bytesToHex(withHops(envelope, env.hops + 1)), priority: priorityOf(alert), expires: alert.expires }];
});

process.stdout.write(JSON.stringify(offers, null, 2) + '\n');
console.error(`${offers.length} live alert(s) of ${feed.items.length} in ${url}`);
