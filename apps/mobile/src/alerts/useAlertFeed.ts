import type { TrustStore } from '@priedanga/alert-format';
import type { RelayFeed } from '@priedanga/relay/schema';
import { useEffect, useRef, useState } from 'react';
import { verifyEd25519 } from '../../modules/priedanga-crypto/src';
import { verifyFeed, type VerifiedFeed } from './alerts';

/** Dev default: `npm run relay -- serve` on the same machine (reachable from the iOS simulator). */
export const FEED_URL = process.env.EXPO_PUBLIC_FEED_URL ?? 'http://localhost:8787/feed.json';
const POLL_MS = 60_000;

export type FeedState =
  | { status: 'idle' }
  | { status: 'ok'; feed: VerifiedFeed; checkedAt: number }
  | { status: 'error'; error: string; last: VerifiedFeed | null; checkedAt: number };

/** Fetch and verify the relay feed while online; keeps the last good feed on errors. */
export function useAlertFeed(store: TrustStore | null, online: boolean): FeedState {
  const [state, setState] = useState<FeedState>({ status: 'idle' });
  const last = useRef<VerifiedFeed | null>(null);

  useEffect(() => {
    if (!store || !online) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(FEED_URL, { headers: { 'cache-control': 'no-cache' } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const feed = (await res.json()) as RelayFeed;
        const verified = await verifyFeed(feed, store, Math.floor(Date.now() / 1000), verifyEd25519);
        last.current = verified;
        if (!cancelled) setState({ status: 'ok', feed: verified, checkedAt: Date.now() });
      } catch (e) {
        if (!cancelled) setState({ status: 'error', error: String(e), last: last.current, checkedAt: Date.now() });
      }
    };
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [store, online]);

  return state;
}
