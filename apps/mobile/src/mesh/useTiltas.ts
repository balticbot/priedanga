import type { TrustStore } from '@priedanga/alert-format';
import { File, Paths } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { verifyEd25519 } from '../../modules/priedanga-crypto/src';
import { Tiltas, type TiltasStatus } from '../../modules/tiltas/src';
import { mergeAlerts, type ShownAlert } from '../alerts/alerts';
import { hexToBytes } from '../pack/hex';
import { buildOffers, liveMeshAlerts, processArrivals } from './mesh';

/** Why the mesh is running: the user's switch, an active danger alert, or no internet. */
export type TiltasReason = 'user' | 'danger' | 'offline' | null;

export interface TiltasState {
  /** The native module exists on this platform (iOS for now). */
  available: boolean;
  enabled: boolean;
  setEnabled: (on: boolean) => void;
  active: boolean;
  reason: TiltasReason;
  status: TiltasStatus | null;
  /** Verified, live alerts that arrived over the mesh. */
  alerts: ShownAlert[];
}

interface Saved {
  enabled: boolean;
  /** Envelope hex of alerts received over the mesh; re-verified on load. */
  alerts: string[];
}

const toHex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const nowSec = () => Math.floor(Date.now() / 1000);

function file(): File | null {
  try {
    return new File(Paths.document, 'tiltas.json');
  } catch {
    return null;
  }
}

function save(s: Saved): void {
  try {
    const f = file();
    if (!f) return;
    if (!f.exists) f.create();
    f.write(JSON.stringify(s));
  } catch {
    // in-memory state still works
  }
}

/**
 * Runs Tiltas when the user turned it on, while a danger alert is active, or
 * while offline. Verifies everything fetched from nearby phones before
 * showing it, and serves every live verified alert (feed or mesh) onwards.
 */
export function useTiltas(store: TrustStore | null, opts: { online: boolean; danger: boolean; feedAlerts: readonly ShownAlert[] }): TiltasState {
  const [enabled, setEnabledState] = useState(false);
  const [alerts, setAlerts] = useState<ShownAlert[]>([]);
  const [status, setStatus] = useState<TiltasStatus | null>(() => Tiltas?.getStatus() ?? null);
  const loaded = useRef(false);
  const latest = useRef({ enabled, alerts });
  latest.current = { enabled, alerts };

  const persist = useCallback((patch: Partial<{ enabled: boolean; alerts: ShownAlert[] }>) => {
    const next = { ...latest.current, ...patch };
    save({ enabled: next.enabled, alerts: next.alerts.map((a) => toHex(a.envelope)) });
  }, []);

  // Load the switch and the stored mesh alerts (re-verified: keys or time may have changed).
  useEffect(() => {
    if (!store || loaded.current) return;
    loaded.current = true;
    const f = file();
    if (!f?.exists) return;
    void (async () => {
      try {
        const saved = JSON.parse(await f.text()) as Partial<Saved>;
        setEnabledState(saved.enabled === true);
        const envelopes = (Array.isArray(saved.alerts) ? saved.alerts : []).flatMap((h) => {
          try {
            return [hexToBytes(String(h))];
          } catch {
            return [];
          }
        });
        const { accepted } = await processArrivals(envelopes, store, nowSec(), verifyEd25519);
        setAlerts(liveMeshAlerts(accepted, nowSec()));
      } catch {
        // corrupt file: start empty
      }
    })();
  }, [store]);

  const setEnabled = useCallback(
    (on: boolean) => {
      setEnabledState(on);
      persist({ enabled: on });
    },
    [persist],
  );

  const reason: TiltasReason = enabled ? 'user' : opts.danger ? 'danger' : !opts.online ? 'offline' : null;
  const active = Tiltas !== null && store !== null && reason !== null;

  useEffect(() => {
    if (!Tiltas) return;
    if (active) Tiltas.start();
    else Tiltas.stop();
  }, [active]);

  const drain = useCallback(async () => {
    if (!Tiltas || !store) return;
    const hexes = Tiltas.drainInbox();
    if (hexes.length === 0) return;
    const envelopes = hexes.flatMap((h) => {
      try {
        return [hexToBytes(h)];
      } catch {
        return [];
      }
    });
    const { accepted, rejectedKeys } = await processArrivals(envelopes, store, nowSec(), verifyEd25519);
    if (rejectedKeys.length) Tiltas.markRejected(rejectedKeys);
    if (accepted.length) {
      const next = liveMeshAlerts([...latest.current.alerts, ...accepted], nowSec());
      setAlerts(next);
      persist({ alerts: next });
    }
  }, [store, persist]);

  useEffect(() => {
    if (!Tiltas) return;
    const subs = [
      Tiltas.addListener('onStatus', setStatus),
      Tiltas.addListener('onInbox', () => void drain()),
      AppState.addEventListener('change', (s) => s === 'active' && void drain()),
    ];
    void drain(); // anything fetched while the app was in the background
    return () => subs.forEach((s) => s.remove());
  }, [drain]);

  // Serve every live verified alert, whichever way it arrived.
  useEffect(() => {
    if (!Tiltas || !store) return;
    let cancelled = false;
    void buildOffers(mergeAlerts(opts.feedAlerts, alerts), store, nowSec(), verifyEd25519).then((offers) => {
      if (!cancelled) Tiltas?.setOffers(offers);
    });
    return () => {
      cancelled = true;
    };
  }, [store, opts.feedAlerts, alerts]);

  return { available: Tiltas !== null, enabled, setEnabled, active, reason, status, alerts };
}
