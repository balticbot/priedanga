import {
  buildTrustStore,
  Category,
  createCertificate,
  generateSecretKey,
  getPublicKey,
  Level,
  MsgType,
  Role,
  signAlert,
  type TrustStore,
} from '@priedanga/alert-format';

export const NOW = 1_800_000_000;

const seed = (n: number) => new Uint8Array(32).fill(n);
export const rootKey = generateSecretKey(seed(1));
export const issuerKey = generateSecretKey(seed(2));
/** Signs alerts but has no certificate: stands in for a forger. */
export const forgerKey = generateSecretKey(seed(3));

export const store: TrustStore = buildTrustStore({
  rootPublicKey: getPublicKey(rootKey),
  certificates: [
    createCertificate(rootKey, {
      publicKey: getPublicKey(issuerKey),
      role: Role.TestIssuer,
      validFrom: NOW - 86_400,
      validTo: NOW + 86_400 * 365,
      areas: [0],
      name: 'TEST issuer (tiltas tests)',
    }),
  ],
}).store;

let counter = 0;
export function alert(opts: { level?: Level; key?: Uint8Array; expiresIn?: number; text?: string } = {}): Uint8Array {
  const id = new Uint8Array(16);
  new DataView(id.buffer).setUint32(12, ++counter);
  return signAlert(opts.key ?? issuerKey, {
    id,
    issued: NOW - 60,
    expires: NOW + (opts.expiresIn ?? 3600),
    msgType: MsgType.Alert,
    level: opts.level ?? Level.Red,
    category: Category.Air,
    template: 1,
    areas: [0],
    ...(opts.text ? { text: { lt: opts.text } } : {}),
    test: true,
  });
}
