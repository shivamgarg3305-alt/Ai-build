import { CONSTITUTION_VERSION, constitutionCanonical } from './constitution';
import { IDENTITY_VERSION, identityCanonical } from './identity';
import { sha256Hex, type PermanentLayerId } from './layers';
import { PERSONALITY_VERSION, personalityCanonical } from './personality';

export interface CoreLayerInfo {
  id: PermanentLayerId;
  version: string;
  hash: string;
}

let cached: Promise<CoreLayerInfo[]> | undefined;

/** Version and SHA-256 of each permanent layer, computed from the code in this build. */
export function getCoreLayers(): Promise<CoreLayerInfo[]> {
  cached ??= Promise.all([
    sha256Hex(identityCanonical()).then((hash): CoreLayerInfo => ({ id: 'identity', version: IDENTITY_VERSION, hash })),
    sha256Hex(constitutionCanonical()).then((hash): CoreLayerInfo => ({ id: 'constitution', version: CONSTITUTION_VERSION, hash })),
    sha256Hex(personalityCanonical()).then((hash): CoreLayerInfo => ({ id: 'personality', version: PERSONALITY_VERSION, hash })),
  ]);
  return cached;
}
