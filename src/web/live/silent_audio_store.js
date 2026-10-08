// Stores short PCM utterances outside the hot audio callback. IndexedDB keeps
// memory bounded; in restricted browsers there is a bounded memory fallback.
export class SilentAudioStore {
  constructor({indexedDB = globalThis.indexedDB, maxMemoryBytes = 8_000_000} = {}) {
    this.indexedDB = indexedDB;
    this.maxMemoryBytes = maxMemoryBytes;
    this.memory = new Map();
    this.memoryBytes = 0;
    this.dbPromise = null;
  }

  async database() {
    if (!this.indexedDB) return null;
    if (!this.dbPromise) {
      this.dbPromise = new Promise(resolve => {
        let request;
        try { request = this.indexedDB.open('e-kaiwa-silent-audio', 1); }
        catch { resolve(null); return; }
        request.onupgradeneeded = () => request.result.createObjectStore('segments');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      });
    }
    return this.dbPromise;
  }

  async transaction(mode, action) {
    const db = await this.database();
    if (!db) return {available: false, value: null};
    try {
      return await new Promise(resolve => {
        const request = action(db.transaction('segments', mode).objectStore('segments'));
        request.onsuccess = () => resolve({available: true, value: request.result});
        request.onerror = () => resolve({available: false, value: null});
      });
    } catch {
      return {available: false, value: null};
    }
  }

  async save(key, pcm) {
    const value = new Int16Array(pcm);
    if ((await this.transaction('readwrite', store => store.put(value, key))).available) return;
    if (value.byteLength > this.maxMemoryBytes) throw new Error('Audio segment too large');
    while (this.memoryBytes + value.byteLength > this.maxMemoryBytes && this.memory.size) {
      const oldest = this.memory.keys().next().value;
      this.memoryBytes -= this.memory.get(oldest).byteLength;
      this.memory.delete(oldest);
    }
    this.memory.set(key, value);
    this.memoryBytes += value.byteLength;
  }

  async load(key) {
    const cached = this.memory.get(key);
    if (cached) return cached;
    const result = await this.transaction('readonly', store => store.get(key));
    return result.value ? new Int16Array(result.value) : null;
  }

  async remove(key) {
    const cached = this.memory.get(key);
    if (cached) this.memoryBytes -= cached.byteLength;
    this.memory.delete(key);
    await this.transaction('readwrite', store => store.delete(key));
  }

  async clear() {
    this.memory.clear();
    this.memoryBytes = 0;
    await this.transaction('readwrite', store => store.clear());
  }
}
