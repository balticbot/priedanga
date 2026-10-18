/** Wire-format version carried in every envelope and body. */
export const FORMAT_VERSION = 1;

export const MsgType = { Alert: 0, Update: 1, Cancel: 2 } as const;
export type MsgType = (typeof MsgType)[keyof typeof MsgType];

/**
 * Mirrors the official Lithuanian air-alert levels.
 * Exact semantics and wording to be confirmed with PAGD.
 */
export const Level = { Yellow: 1, Red: 2, YellowAfterRed: 3, White: 4 } as const;
export type Level = (typeof Level)[keyof typeof Level];

export const Category = { Air: 1, Chemical: 2, Radiation: 3, Flood: 4, Other: 5 } as const;
export type Category = (typeof Category)[keyof typeof Category];

export const Role = { LiveIssuer: 1, TestIssuer: 2, Content: 3 } as const;
export type Role = (typeof Role)[keyof typeof Role];

export const LANGS = ['lt', 'en', 'ru', 'pl', 'uk'] as const;
export type Lang = (typeof LANGS)[number];

/**
 * Area code meaning "the whole country". When present it must be the only
 * entry in an area list. Codes 1..255 identify municipalities; the mapping
 * to official municipality register codes is defined in the content pack.
 */
export const NATIONWIDE = 0;
export const MAX_AREA_CODE = 255;

export const ALERT_ID_BYTES = 16;
export const KEY_ID_BYTES = 8;
export const PUBLIC_KEY_BYTES = 32;
export const SIGNATURE_BYTES = 64;
export const MAX_TEMPLATE_ID = 0xffff;
export const MAX_TEXT_BYTES = 512;
export const MAX_NAME_BYTES = 128;

export interface Alert {
  /** 16 random bytes; unique per message, used for deduplication. */
  id: Uint8Array;
  /** Key ID of the issuer certificate that signed this alert. */
  issuerKeyId: Uint8Array;
  /** Unix seconds. */
  issued: number;
  /** Unix seconds; the alert is not shown or relayed after this. */
  expires: number;
  msgType: MsgType;
  /** ID of the alert this one updates or cancels. Required for Update and Cancel. */
  ref?: Uint8Array;
  /** Required for Alert and Update; absent for Cancel. */
  level?: Level;
  /** Required for Alert and Update; absent for Cancel. */
  category?: Category;
  /** Template ID in the offline template pack. Required for Alert and Update; absent for Cancel. */
  template?: number;
  /** Sorted, unique area codes; [NATIONWIDE] for the whole country. */
  areas: number[];
  /** Optional free text per language. */
  text?: Partial<Record<Lang, string>>;
  /** TEST alerts must be signed by a TestIssuer certificate, live alerts by a LiveIssuer. */
  test: boolean;
}

export interface Certificate {
  keyId: Uint8Array;
  publicKey: Uint8Array;
  role: Role;
  /** Unix seconds, inclusive. */
  validFrom: number;
  /** Unix seconds, inclusive. */
  validTo: number;
  /** Areas this issuer may target; [NATIONWIDE] for all. Required for issuer roles, absent for Content. */
  areas?: number[];
  /** Human-readable label, e.g. "TEST issuer — Balticbot demo". */
  name: string;
}

export interface RevocationList {
  /** Monotonically increasing; a store must never accept a lower sequence than it already holds. */
  seq: number;
  issued: number;
  /** Sorted, unique certificate key IDs that are revoked. */
  keyIds: Uint8Array[];
  /** Sorted, unique alert IDs that are revoked. */
  alertIds: Uint8Array[];
}

/** Integer map keys used in the CBOR encoding. Part of the wire contract; never renumber. */
export const AlertKey = {
  v: 0,
  id: 1,
  issuerKeyId: 2,
  issued: 3,
  expires: 4,
  msgType: 5,
  ref: 6,
  level: 7,
  category: 8,
  areas: 9,
  template: 10,
  text: 11,
  test: 12,
} as const;

export const CertKey = {
  v: 0,
  keyId: 1,
  publicKey: 2,
  role: 3,
  validFrom: 4,
  validTo: 5,
  areas: 6,
  name: 7,
} as const;

export const RevocationKey = {
  v: 0,
  seq: 1,
  issued: 2,
  keyIds: 3,
  alertIds: 4,
} as const;
