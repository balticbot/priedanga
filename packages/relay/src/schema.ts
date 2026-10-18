/**
 * Relay feed format. Shared by the relay service and the app.
 * Must stay free of Node.js imports.
 *
 * The feed wrapper itself is NOT signed: every item is an individually signed
 * alert envelope (relay role), verified on the phone. A tampered wrapper can
 * only drop or reorder items, never forge one.
 */

export const FEED_FORMAT = 'priedanga-relay-feed';
export const FEED_VERSION = 1;

export interface RelayFeed {
  format: typeof FEED_FORMAT;
  version: typeof FEED_VERSION;
  /** ISO time the feed was generated. */
  generated: string;
  source: { id: string; url: string; license: string };
  /** Hex-encoded alert envelopes, newest first. */
  items: string[];
}
