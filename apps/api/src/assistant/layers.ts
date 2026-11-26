import type { LayerId } from '@assistant/shared';

export type { LayerId };

/** Highest to lowest authority. A lower layer can never override a higher one. */
export const LAYER_ORDER: readonly LayerId[] = [
  'identity',
  'constitution',
  'personality',
  'user_preferences',
  'session_context',
  'task_instructions',
];

export const PERMANENT_LAYER_IDS = ['identity', 'constitution', 'personality'] as const;
export type PermanentLayerId = (typeof PERMANENT_LAYER_IDS)[number];

export const layerNumber = (id: LayerId): number => LAYER_ORDER.indexOf(id) + 1;

/** SHA-256 as lowercase hex. WebCrypto, so it behaves identically on Node and Cloudflare Workers. */
export async function sha256Hex(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
