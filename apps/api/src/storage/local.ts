import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { AppError } from '../errors';
import type { ObjectStorage, StoredObject } from './types';

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._\-/]{0,511}$/;

function isNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'ENOENT';
}

/** Filesystem-backed storage for local development and self-hosting. Node only. */
export class LocalFsStorage implements ObjectStorage {
  private readonly objectsDir: string;
  private readonly metaDir: string;

  constructor(rootDir: string) {
    const root = resolve(rootDir);
    this.objectsDir = resolve(root, 'objects');
    this.metaDir = resolve(root, 'meta');
  }

  private pathFor(base: string, key: string): string {
    const segments = key.split('/');
    if (!KEY_PATTERN.test(key) || segments.some((s) => s === '' || s === '.' || s === '..')) {
      throw new AppError(400, 'invalid_storage_key', 'Storage key is not valid.');
    }
    const full = resolve(base, key);
    if (!full.startsWith(base + sep)) {
      throw new AppError(400, 'invalid_storage_key', 'Storage key is not valid.');
    }
    return full;
  }

  async put(key: string, data: Uint8Array, options: { contentType?: string } = {}): Promise<void> {
    const objectPath = this.pathFor(this.objectsDir, key);
    const metaPath = this.pathFor(this.metaDir, key);
    await mkdir(dirname(objectPath), { recursive: true });
    await mkdir(dirname(metaPath), { recursive: true });
    await writeFile(objectPath, data);
    await writeFile(metaPath, JSON.stringify({ contentType: options.contentType ?? null }));
  }

  async get(key: string): Promise<StoredObject | null> {
    const objectPath = this.pathFor(this.objectsDir, key);
    const metaPath = this.pathFor(this.metaDir, key);
    try {
      const buffer = await readFile(objectPath);
      let contentType: string | null = null;
      try {
        contentType = (JSON.parse(await readFile(metaPath, 'utf8')) as { contentType: string | null }).contentType;
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      return { data: new Uint8Array(buffer), contentType, size: buffer.byteLength };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(this.objectsDir, key), { force: true });
    await rm(this.pathFor(this.metaDir, key), { force: true });
  }
}
