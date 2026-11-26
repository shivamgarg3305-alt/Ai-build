export interface StoredObject {
  data: Uint8Array;
  contentType: string | null;
  size: number;
}

/** Object storage seam. Implemented today by the local filesystem; Cloudflare R2 is the intended production adapter. */
export interface ObjectStorage {
  put(key: string, data: Uint8Array, options?: { contentType?: string }): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  delete(key: string): Promise<void>;
}
