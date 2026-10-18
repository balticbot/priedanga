import { NativeModule, requireOptionalNativeModule } from 'expo';

export interface TiltasStatus {
  /** idle (not started yet) | unknown | resetting | unsupported | unauthorized | off | on */
  bluetooth: string;
  running: boolean;
  /** Verified alerts this phone serves to others. */
  served: number;
  /** Fetched, not yet verified. */
  inbox: number;
  peersSeen: number;
  sessions: number;
  received: number;
  /** ms since epoch */
  lastSync?: number;
}

export interface TiltasOffer {
  /** Envelope hex, hops already incremented. */
  envelope: string;
  priority: number;
  expires: number;
}

type Events = {
  onStatus(status: TiltasStatus): void;
  onInbox(event: { count: number }): void;
};

declare class TiltasNative extends NativeModule<Events> {
  getStatus(): TiltasStatus;
  /** title/text: Android foreground-service notification (ignored on iOS). */
  start(title: string, text: string): void;
  stop(): void;
  setOffers(offers: TiltasOffer[]): void;
  /** Envelope hex strings; clears the native inbox. */
  drainInbox(): string[];
  /** Mesh key hex strings that failed verification. */
  markRejected(keys: string[]): void;
}

/** Null where the native module is not built (web). */
export const Tiltas = requireOptionalNativeModule<TiltasNative>('Tiltas');
