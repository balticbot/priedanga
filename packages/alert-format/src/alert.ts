import { decode, encode, type CborMap, type CborValue } from './cbor.js';
import {
  asArray,
  asMap,
  bool,
  bytes,
  fail,
  isTimestamp,
  oneOf,
  rejectUnknownKeys,
  text,
  uint,
  validateAreas,
} from './fields.js';
import {
  ALERT_ID_BYTES,
  AlertKey,
  Category,
  FORMAT_VERSION,
  KEY_ID_BYTES,
  LANGS,
  Level,
  MAX_AREA_CODE,
  MAX_SOURCE_REF_BYTES,
  MAX_TEMPLATE_ID,
  MAX_TEXT_BYTES,
  MsgType,
  NATIONWIDE,
  SIGNATURE_BYTES,
  Source,
  type Alert,
  type Lang,
} from './model.js';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Throws FormatError if the alert does not satisfy every structural rule. */
export function validateAlert(alert: Alert): void {
  if (alert.id.length !== ALERT_ID_BYTES) fail(`id must be ${ALERT_ID_BYTES} bytes`);
  if (alert.issuerKeyId.length !== KEY_ID_BYTES) fail(`issuerKeyId must be ${KEY_ID_BYTES} bytes`);
  if (!isTimestamp(alert.issued) || !isTimestamp(alert.expires)) fail('timestamps must be unsigned integers');
  if (alert.expires <= alert.issued) fail('expires must be after issued');
  oneOf(alert.msgType, MsgType, 'msgType');

  const isCancel = alert.msgType === MsgType.Cancel;
  const needsRef = alert.msgType !== MsgType.Alert;
  if (needsRef) {
    if (alert.ref === undefined) fail('ref is required for update and cancel');
    if (alert.ref.length !== ALERT_ID_BYTES) fail(`ref must be ${ALERT_ID_BYTES} bytes`);
  } else if (alert.ref !== undefined) {
    fail('ref is only allowed for update and cancel');
  }

  const relayed = alert.source !== undefined;
  if (relayed !== (alert.sourceRef !== undefined)) fail('source and sourceRef must be present together');
  if (relayed) {
    oneOf(alert.source!, Source, 'source');
    text(alert.sourceRef, 'sourceRef', MAX_SOURCE_REF_BYTES);
  }

  if (isCancel) {
    if (alert.level !== undefined || alert.category !== undefined || alert.template !== undefined) {
      fail('cancel must not carry level, category or template');
    }
  } else {
    if (alert.level === undefined) fail('level is required');
    if (alert.category === undefined) fail('category is required');
    if (alert.template === undefined && !relayed) fail('template is required');
    oneOf(alert.level, Level, 'level');
    oneOf(alert.category, Category, 'category');
    if (
      alert.template !== undefined &&
      (!Number.isInteger(alert.template) || alert.template < 0 || alert.template > MAX_TEMPLATE_ID)
    ) {
      fail('template out of range');
    }
    if (relayed && alert.text?.lt === undefined) fail('relayed alerts must carry the verbatim source text in lt');
  }

  validateAreas(alert.areas, 'areas', MAX_AREA_CODE, NATIONWIDE);

  if (alert.text !== undefined) {
    const langs = Object.keys(alert.text);
    if (langs.length === 0) fail('text must not be empty when present');
    for (const lang of langs) {
      if (!(LANGS as readonly string[]).includes(lang)) fail(`text: unsupported language ${lang}`);
      text(alert.text[lang as Lang], `text.${lang}`, MAX_TEXT_BYTES);
    }
  }

  if (typeof alert.test !== 'boolean') fail('test must be a boolean');
}

// ---------------------------------------------------------------------------
// Body encoding (the signed bytes)
// ---------------------------------------------------------------------------

export function encodeAlertBody(alert: Alert): Uint8Array {
  validateAlert(alert);
  const m: CborMap = new Map<number, CborValue>([
    [AlertKey.v, FORMAT_VERSION],
    [AlertKey.id, alert.id],
    [AlertKey.issuerKeyId, alert.issuerKeyId],
    [AlertKey.issued, alert.issued],
    [AlertKey.expires, alert.expires],
    [AlertKey.msgType, alert.msgType],
    [AlertKey.areas, [...alert.areas]],
    [AlertKey.test, alert.test],
  ]);
  if (alert.ref !== undefined) m.set(AlertKey.ref, alert.ref);
  if (alert.level !== undefined) m.set(AlertKey.level, alert.level);
  if (alert.category !== undefined) m.set(AlertKey.category, alert.category);
  if (alert.template !== undefined) m.set(AlertKey.template, alert.template);
  if (alert.source !== undefined) m.set(AlertKey.source, alert.source);
  if (alert.sourceRef !== undefined) m.set(AlertKey.sourceRef, alert.sourceRef);
  if (alert.text !== undefined) {
    const t: CborMap = new Map();
    for (const [lang, value] of Object.entries(alert.text)) {
      if (value !== undefined) t.set(lang, value);
    }
    m.set(AlertKey.text, t);
  }
  return encode(m);
}

/** Strictly decode and validate alert body bytes. Throws CborError or FormatError. */
export function decodeAlertBody(body: Uint8Array): Alert {
  const m = asMap(decode(body), 'alert');
  rejectUnknownKeys(m, AlertKey, 'alert');
  if (uint(m.get(AlertKey.v), 'v') !== FORMAT_VERSION) fail('unsupported alert body version');

  const alert: Alert = {
    id: bytes(m.get(AlertKey.id), 'id', ALERT_ID_BYTES),
    issuerKeyId: bytes(m.get(AlertKey.issuerKeyId), 'issuerKeyId', KEY_ID_BYTES),
    issued: uint(m.get(AlertKey.issued), 'issued'),
    expires: uint(m.get(AlertKey.expires), 'expires'),
    msgType: oneOf(uint(m.get(AlertKey.msgType), 'msgType'), MsgType, 'msgType'),
    areas: asArray(m.get(AlertKey.areas) ?? fail('areas is required'), 'areas').map((a) =>
      uint(a, 'area', MAX_AREA_CODE),
    ),
    test: bool(m.get(AlertKey.test), 'test'),
  };
  if (m.has(AlertKey.ref)) alert.ref = bytes(m.get(AlertKey.ref), 'ref', ALERT_ID_BYTES);
  if (m.has(AlertKey.level)) alert.level = oneOf(uint(m.get(AlertKey.level), 'level'), Level, 'level');
  if (m.has(AlertKey.category)) {
    alert.category = oneOf(uint(m.get(AlertKey.category), 'category'), Category, 'category');
  }
  if (m.has(AlertKey.template)) alert.template = uint(m.get(AlertKey.template), 'template', MAX_TEMPLATE_ID);
  if (m.has(AlertKey.source)) alert.source = oneOf(uint(m.get(AlertKey.source), 'source'), Source, 'source');
  if (m.has(AlertKey.sourceRef)) alert.sourceRef = text(m.get(AlertKey.sourceRef), 'sourceRef', MAX_SOURCE_REF_BYTES);
  if (m.has(AlertKey.text)) {
    const t = asMap(m.get(AlertKey.text)!, 'text');
    const out: Partial<Record<Lang, string>> = {};
    for (const [lang, value] of t) {
      if (typeof lang !== 'string' || !(LANGS as readonly string[]).includes(lang)) {
        fail(`text: unsupported language ${String(lang)}`);
      }
      out[lang as Lang] = text(value, `text.${lang}`, MAX_TEXT_BYTES);
    }
    alert.text = out;
  }
  validateAlert(alert);
  return alert;
}

// ---------------------------------------------------------------------------
// Envelope: [version, body, signature, hops]
// ---------------------------------------------------------------------------

export interface AlertEnvelope {
  version: number;
  /** Exact signed bytes. Verification always uses these bytes, never a re-encoding. */
  body: Uint8Array;
  signature: Uint8Array;
  /**
   * Relay hop counter. Deliberately OUTSIDE the signature so relays can
   * increment it; changing it cannot alter the alert content.
   */
  hops: number;
}

export function encodeAlertEnvelope(env: Omit<AlertEnvelope, 'version'> & { version?: number }): Uint8Array {
  if (env.signature.length !== SIGNATURE_BYTES) fail('signature must be 64 bytes');
  return encode([env.version ?? FORMAT_VERSION, env.body, env.signature, env.hops]);
}

/** Decode the envelope structure only. The body is NOT decoded or verified here. */
export function decodeAlertEnvelope(bytesIn: Uint8Array): AlertEnvelope {
  const arr = asArray(decode(bytesIn), 'envelope');
  if (arr.length !== 4) fail('envelope must have 4 elements');
  return {
    version: uint(arr[0], 'envelope version'),
    body: bytes(arr[1], 'body'),
    signature: bytes(arr[2], 'signature', SIGNATURE_BYTES),
    hops: uint(arr[3], 'hops'),
  };
}

/** Return a copy of the envelope with a new hop count (used by mesh relays). */
export function withHops(envelope: Uint8Array, hops: number): Uint8Array {
  const env = decodeAlertEnvelope(envelope);
  return encodeAlertEnvelope({ ...env, hops });
}
