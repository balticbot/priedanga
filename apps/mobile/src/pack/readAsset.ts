import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';

/** Native: read a bundled asset's exact bytes from the app bundle / cache. */
export async function readAssetBytes(module: number): Promise<Uint8Array> {
  const asset = Asset.fromModule(module);
  await asset.downloadAsync();
  if (!asset.localUri) throw new Error(`asset not available locally: ${asset.name}`);
  return new Uint8Array(await new File(asset.localUri).arrayBuffer());
}
