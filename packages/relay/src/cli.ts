/**
 * PAGD warning-feed relay (development).
 *
 *   npm run relay -w @priedanga/relay -- build [--out FILE] [--days N]
 *   npm run relay -w @priedanga/relay -- serve [--port 8787] [--interval 60]
 *
 * build  fetch the PAGD feed once and write a signed relay feed (default packs/dev/relay-feed.json)
 * serve  poll every --interval seconds, serve the feed at http://localhost:PORT/feed.json,
 *        and log how long new messages take to appear in the open-data feed after their
 *        cell-broadcast send time (appended to packages/relay/.cache/latency.jsonl)
 *
 * serve --demo red|yellow|yellow-after-red|white [--demo-area "Kauno m."]
 *        also serve one TEST alert (signed by the dev TEST issuer, valid 30 min) so the
 *        alert screen can be seen without a real alert. The app labels it as a test.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MunicipalitiesFile, PlacesFile } from '@priedanga/content-builder/schema';
import { buildGazetteer, parseAreas } from './areas.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { Category, Level, MsgType, newAlertId, signAlert } from '@priedanga/alert-format';
import { hexToBytes } from '@noble/hashes/utils.js';
import { buildFeed, PAGD_URL, type SourceRow } from './feed.js';
import type { RelayFeed } from './schema.js';
import { vilniusToUnix } from './time.js';

const repoRoot = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const cacheDir = join(repoRoot, 'packages/relay/.cache');
const [command = 'build', ...args] = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] !== undefined ? args[i + 1]! : fallback;
};

const relayKeyFile = join(repoRoot, 'secrets/dev/relay.sk');
if (!existsSync(relayKeyFile)) {
  console.error('No dev relay key. Run `npm run pack` first: it creates secrets/dev/relay.sk and puts its certificate in the pack.');
  process.exit(1);
}
const relaySecretKey = hexToBytes(readFileSync(relayKeyFile, 'utf8').trim());
const readPack = <T>(file: string): T => JSON.parse(readFileSync(join(repoRoot, 'packs/dev', file), 'utf8')) as T;
const gazetteer = buildGazetteer(
  readPack<MunicipalitiesFile>('municipalities.json').municipalities,
  readPack<PlacesFile>('places.json').places,
);
const days = Number(arg('--days', '30'));

const DEMO_LEVELS: Record<string, number> = { red: Level.Red, yellow: Level.Yellow, 'yellow-after-red': Level.YellowAfterRed, white: Level.White };
function demoAlert(): string | null {
  const name = args.includes('--demo') ? arg('--demo', 'red') : null;
  if (name === null) return null;
  const level = DEMO_LEVELS[name];
  if (level === undefined) throw new Error(`--demo must be one of ${Object.keys(DEMO_LEVELS).join(', ')}`);
  const keyFile = join(repoRoot, 'secrets/dev/test-issuer.sk');
  if (!existsSync(keyFile)) throw new Error('No dev TEST issuer key. Run `npm run pack` first.');
  const issued = Math.floor(Date.now() / 1000);
  const areas = args.includes('--demo-area') ? parseAreas(arg('--demo-area', ''), gazetteer).areas : [0];
  return bytesToHex(
    signAlert(hexToBytes(readFileSync(keyFile, 'utf8').trim()), {
      id: newAlertId(),
      issued,
      expires: issued + 30 * 60,
      msgType: MsgType.Alert,
      level: level as Level,
      category: Category.Air,
      template: 1,
      areas,
      text: {
        lt: 'BANDOMASIS PRANEŠIMAS. Tai Priedanga programėlės bandymas, ne tikras perspėjimas.',
        en: 'TEST MESSAGE. This is a Priedanga app test, not a real alert.',
      },
      test: true,
    }),
  );
}
const demo = demoAlert();

async function fetchRows(): Promise<SourceRow[]> {
  const res = await fetch(`${PAGD_URL}?sort(-siunciamu_pranesimu_pradzia)&limit(300)`, {
    headers: { accept: 'application/json', 'user-agent': 'priedanga-relay' },
  });
  if (!res.ok) throw new Error(`PAGD feed: ${res.status} ${res.statusText}`);
  return ((await res.json()) as { _data: SourceRow[] })._data;
}

async function buildOnce(): Promise<{ feed: RelayFeed; rows: SourceRow[] }> {
  const rows = await fetchRows();
  const { feed, stats } = buildFeed({ rows, gazetteer, relaySecretKey, now: Math.floor(Date.now() / 1000), days });
  console.log(`[relay] ${new Date().toISOString()} relayed ${stats.relayed} (air ${stats.airAlerts}) of ${stats.rows}`, JSON.stringify({ skipped: stats.skipped, areas: stats.areaConfidence }));
  return { feed, rows };
}

if (command === 'build') {
  const out = resolve(arg('--out', join(repoRoot, 'packs/dev/relay-feed.json')));
  const { feed } = await buildOnce();
  writeFileSync(out, JSON.stringify(feed, null, 2) + '\n');
  console.log(`[relay] wrote ${feed.items.length} items -> ${out}`);
} else if (command === 'serve') {
  const port = Number(arg('--port', '8787'));
  const interval = Number(arg('--interval', '60')) * 1000;
  mkdirSync(cacheDir, { recursive: true });
  const seen = new Set<string>();
  let current: RelayFeed | null = null;
  let first = true;

  const tick = async () => {
    try {
      const { feed, rows } = await buildOnce();
      current = demo ? { ...feed, items: [demo, ...feed.items] } : feed;
      const now = Date.now();
      for (const r of rows) {
        const id = String(r.issiustu_pranesimu_id);
        if (seen.has(id)) continue;
        seen.add(id);
        // Messages present at startup tell us nothing about latency.
        if (first || !r.siunciamu_pranesimu_pradzia) continue;
        const sent = vilniusToUnix(r.siunciamu_pranesimu_pradzia) * 1000;
        const entry = { id, sent: new Date(sent).toISOString(), firstSeen: new Date(now).toISOString(), latencySeconds: Math.round((now - sent) / 1000) };
        console.log('[relay] NEW message', JSON.stringify(entry));
        appendFileSync(join(cacheDir, 'latency.jsonl'), JSON.stringify(entry) + '\n');
      }
      first = false;
    } catch (e) {
      console.error('[relay] poll failed:', e instanceof Error ? e.message : e);
    }
  };

  await tick();
  setInterval(() => void tick(), interval);
  createServer((req, res) => {
    if (req.url?.startsWith('/feed.json') && current) {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-cache', 'access-control-allow-origin': '*' });
      res.end(JSON.stringify(current));
    } else {
      res.writeHead(404).end();
    }
  }).listen(port, () => console.log(`[relay] serving http://localhost:${port}/feed.json (poll every ${interval / 1000}s)`));
} else {
  console.error(`unknown command: ${command}`);
  process.exit(1);
}
