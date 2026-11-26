import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalFsStorage } from '../src/storage/local';

let dir: string;
let storage: LocalFsStorage;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'assistant-storage-'));
  storage = new LocalFsStorage(dir);
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('LocalFsStorage', () => {
  it('stores, reads and deletes objects with content type', async () => {
    await storage.put('users/u1/note.txt', new TextEncoder().encode('hello'), { contentType: 'text/plain' });
    const got = await storage.get('users/u1/note.txt');
    expect(got).not.toBeNull();
    expect(new TextDecoder().decode(got!.data)).toBe('hello');
    expect(got).toMatchObject({ contentType: 'text/plain', size: 5 });
    await storage.delete('users/u1/note.txt');
    expect(await storage.get('users/u1/note.txt')).toBeNull();
  });

  it('returns null for missing keys and tolerates deleting them', async () => {
    expect(await storage.get('nothing/here')).toBeNull();
    await expect(storage.delete('nothing/here')).resolves.toBeUndefined();
  });

  it.each(['../escape', 'a/../../escape', '/absolute', 'a//b', '', '.hidden/../x', 'bad key'])(
    'rejects unsafe key %j',
    async (key) => {
      await expect(storage.put(key, new Uint8Array([1]))).rejects.toMatchObject({ code: 'invalid_storage_key' });
      await expect(storage.get(key)).rejects.toMatchObject({ code: 'invalid_storage_key' });
    },
  );
});
