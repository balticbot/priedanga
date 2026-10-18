/**
 * Download complete models from the Lithuanian open-data API (Spinta,
 * get.data.gov.lt), following `_page.next` tokens. Responses are cached on
 * disk so rebuilding a pack does not hammer the public API.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const API_BASE = 'https://get.data.gov.lt';
const PAGE_SIZE = 1000;
const MAX_PAGES = 200;

export type Row = Record<string, unknown>;

export interface Download {
  model: string;
  url: string;
  rows: Row[];
  fetched: string;
}

export async function downloadModel(model: string, opts: { cacheDir: string; offline?: boolean }): Promise<Download> {
  const cacheFile = join(opts.cacheDir, model.replaceAll('/', '_') + '.json');
  if (opts.offline) {
    if (!existsSync(cacheFile)) throw new Error(`offline: no cache for ${model}`);
    return JSON.parse(readFileSync(cacheFile, 'utf8')) as Download;
  }

  const url = `${API_BASE}/${model}`;
  const rows: Row[] = [];
  let token: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = `limit(${PAGE_SIZE})` + (token ? `&page('${token}')` : '');
    const body = await getJson(`${url}?${query}`);
    const data = (body as { _data?: Row[] })._data ?? [];
    rows.push(...data);
    const next = (body as { _page?: { next?: string } })._page?.next;
    if (data.length < PAGE_SIZE || !next) {
      const result: Download = { model, url, rows, fetched: new Date().toISOString() };
      mkdirSync(opts.cacheDir, { recursive: true });
      writeFileSync(cacheFile, JSON.stringify(result));
      return result;
    }
    token = next;
  }
  throw new Error(`${model}: more than ${MAX_PAGES} pages, refusing to continue`);
}

async function getJson(url: string, attempt = 1): Promise<unknown> {
  const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'priedanga-content-builder' } });
  if (res.ok) return res.json();
  if (attempt < 4 && (res.status === 429 || res.status >= 500)) {
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    return getJson(url, attempt + 1);
  }
  throw new Error(`GET ${url} failed: ${res.status} ${res.statusText}`);
}
