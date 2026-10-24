import * as SecureStore from 'expo-secure-store';

// SecureStore has a per-value size limit. Splitting the serialized Supabase
// session keeps refresh tokens encrypted at rest without relying on that limit.
const CHUNK_SIZE = 1_800;
const MANIFEST_SUFFIX = '.manifest';

export const secureSessionStorage = {
  async getItem(key: string): Promise<string | null> {
    const manifestValue = await SecureStore.getItemAsync(`${key}${MANIFEST_SUFFIX}`);
    if (!manifestValue) return null;

    try {
      const { chunks } = JSON.parse(manifestValue) as { chunks: number };
      if (!Number.isInteger(chunks) || chunks < 1) return null;

      const parts = await Promise.all(
        Array.from({ length: chunks }, (_, index) =>
          SecureStore.getItemAsync(`${key}.${index}`),
        ),
      );
      if (parts.some((part) => part === null)) return null;
      return (parts as string[]).join('');
    } catch {
      return null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    const previousManifest = await SecureStore.getItemAsync(`${key}${MANIFEST_SUFFIX}`);
    let previousChunks = 0;
    try {
      previousChunks = previousManifest
        ? (JSON.parse(previousManifest) as { chunks: number }).chunks
        : 0;
    } catch {
      previousChunks = 0;
    }

    const chunkCount = Math.max(1, Math.ceil(value.length / CHUNK_SIZE));
    for (let index = 0; index < chunkCount; index += 1) {
      await SecureStore.setItemAsync(
        `${key}.${index}`,
        value.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE),
      );
    }
    // Publish the new value only after all chunks are safely written.
    await SecureStore.setItemAsync(
      `${key}${MANIFEST_SUFFIX}`,
      JSON.stringify({ chunks: chunkCount }),
    );
    for (let index = chunkCount; index < previousChunks; index += 1) {
      await SecureStore.deleteItemAsync(`${key}.${index}`);
    }
  },

  async removeItem(key: string): Promise<void> {
    const manifestValue = await SecureStore.getItemAsync(`${key}${MANIFEST_SUFFIX}`);
    let chunks = 0;
    try {
      chunks = manifestValue
        ? (JSON.parse(manifestValue) as { chunks: number }).chunks
        : 0;
    } catch {
      chunks = 0;
    }

    await Promise.all([
      SecureStore.deleteItemAsync(`${key}${MANIFEST_SUFFIX}`),
      ...Array.from({ length: chunks }, (_, index) =>
        SecureStore.deleteItemAsync(`${key}.${index}`),
      ),
    ]);
  },
};
