import { Asset } from 'expo-asset';

/** Web: fetch the asset (served from the bundle; cached by the service worker in production). */
export async function readAssetBytes(module: number): Promise<Uint8Array> {
  const asset = Asset.fromModule(module);
  const res = await fetch(asset.uri);
  if (!res.ok) throw new Error(`asset fetch failed: ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}
