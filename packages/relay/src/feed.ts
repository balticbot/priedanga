import { bytesToHex } from '@noble/hashes/utils.js';
import { MAX_TEXT_BYTES, MsgType, relayAlertId, signAlert, Source, encodeUtf8, type Alert } from '@priedanga/alert-format';
import { parseAreas, type AreaConfidence, type Gazetteer } from './areas.js';
import { classify, lifetimeSeconds } from './classify.js';
import { FEED_FORMAT, FEED_VERSION, type RelayFeed } from './schema.js';
import { vilniusToUnix } from './time.js';

export const PAGD_MODEL = 'datasets/gov/pagd/pranesimai/Pranesimas';
export const PAGD_URL = `https://get.data.gov.lt/${PAGD_MODEL}`;

export interface SourceRow {
  issiustu_pranesimu_id: string | number;
  siunciamu_pranesimu_pradzia: string | null;
  pranesimo_tekstas_lt: string | null;
  ivykio_vietoves_aprasymas_lt: string | null;
  informacijos_saltinis?: string | null;
}

export interface FeedStats {
  rows: number;
  relayed: number;
  skipped: Record<string, number>;
  areaConfidence: Partial<Record<AreaConfidence, number>>;
  airAlerts: number;
}

export interface BuildFeedOptions {
  rows: readonly SourceRow[];
  gazetteer: Gazetteer;
  relaySecretKey: Uint8Array;
  /** Unix seconds. */
  now: number;
  /** Only relay messages issued within this many days. */
  days?: number;
  maxItems?: number;
}

/**
 * Turn PAGD warning-feed rows into signed relay alerts. The source text is
 * carried verbatim in `text.lt`; level, category and areas are the relay's
 * classification and are labelled as such by the app.
 */
export function buildFeed(opts: BuildFeedOptions): { feed: RelayFeed; stats: FeedStats } {
  const days = opts.days ?? 30;
  const maxItems = opts.maxItems ?? 200;
  const stats: FeedStats = { rows: opts.rows.length, relayed: 0, skipped: {}, areaConfidence: {}, airAlerts: 0 };
  const skip = (why: string) => (stats.skipped[why] = (stats.skipped[why] ?? 0) + 1);

  const parsed = opts.rows
    .map((row) => ({ row, issued: row.siunciamu_pranesimu_pradzia ? safeTime(row.siunciamu_pranesimu_pradzia) : null }))
    .sort((a, b) => (b.issued ?? 0) - (a.issued ?? 0));

  const items: string[] = [];
  for (const { row, issued } of parsed) {
    if (items.length >= maxItems) break;
    const text = row.pranesimo_tekstas_lt?.trim();
    if (issued === null) {
      skip('no_time');
      continue;
    }
    if (issued < opts.now - days * 86_400) break;
    if (issued > opts.now + 300) {
      skip('future_time');
      continue;
    }
    if (!text) {
      skip('no_text');
      continue;
    }
    if (encodeUtf8(text).length > MAX_TEXT_BYTES) {
      skip('text_too_long');
      continue;
    }

    const sourceRef = String(row.issiustu_pranesimu_id);
    const c = classify(text);
    const area = parseAreas(row.ivykio_vietoves_aprasymas_lt, opts.gazetteer, row.informacijos_saltinis);
    stats.areaConfidence[area.confidence] = (stats.areaConfidence[area.confidence] ?? 0) + 1;

    const alert: Omit<Alert, 'issuerKeyId'> = {
      id: relayAlertId(Source.PagdWarningFeed, sourceRef),
      issued,
      expires: issued + lifetimeSeconds(c),
      msgType: MsgType.Alert,
      level: c.level,
      category: c.category,
      areas: area.areas,
      text: { lt: text },
      test: false,
      source: Source.PagdWarningFeed,
      sourceRef,
    };
    items.push(bytesToHex(signAlert(opts.relaySecretKey, alert)));
    stats.relayed++;
    if (c.airAlert) stats.airAlerts++;
  }

  return {
    feed: {
      format: FEED_FORMAT,
      version: FEED_VERSION,
      generated: new Date(opts.now * 1000).toISOString(),
      source: { id: 'pagd/pranesimai', url: PAGD_URL, license: 'CC BY 4.0' },
      items,
    },
    stats,
  };
}

function safeTime(s: string): number | null {
  try {
    return vilniusToUnix(s);
  } catch {
    return null;
  }
}
