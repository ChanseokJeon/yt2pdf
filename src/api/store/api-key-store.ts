import { createHash, timingSafeEqual, randomBytes } from 'crypto';

import type { ApiKeyRecord } from '../types.js';
import { API_KEY_PREFIX } from '../../constants.js';

/**
 * In-memory API key store.
 *
 * Keys are loaded from environment variable V2DOC_API_KEYS on startup.
 * Only SHA-256 hashes are stored; plaintext keys are never persisted.
 *
 * Future: Replace with Redis, Firestore, or PostgreSQL for:
 * - Dynamic key management (create/revoke without restart)
 * - Usage analytics
 * - Key rotation
 */
export class ApiKeyStore {
  private keys: Map<string, ApiKeyRecord> = new Map(); // hash -> record

  /**
   * Load API keys from environment variable.
   *
   * Format of V2DOC_API_KEYS:
   *   key1:userId1:name1,key2:userId2:name2
   *
   * Example:
   *   v2d_abc123:user-chanseok:production-cli,v2d_xyz789:user-test:test-key
   *
   * If the key is provided as plaintext (starts with v2d_), it is hashed
   * before storage. If it's already a SHA-256 hex string (64 chars), it's
   * stored as-is (for production where plaintext should not be in env).
   */
  loadFromEnv(envValue?: string): void {
    const raw = envValue || process.env.V2DOC_API_KEYS || '';
    if (!raw.trim()) {
      console.warn('[ApiKeyStore] No API keys configured (V2DOC_API_KEYS is empty)');
      return;
    }

    const entries = raw
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);

    for (const entry of entries) {
      const parts = entry.split(':');
      if (parts.length < 2) {
        // [REVISED from v1: no partial key material in log (P2-9)]
        console.warn(
          `[ApiKeyStore] Invalid key entry format (expected key:userId[:name]). Entry has ${parts.length} part(s).`
        );
        continue;
      }

      const [keyOrHash, userId, name] = parts;
      const hashedKey = this.isAlreadyHashed(keyOrHash) ? keyOrHash : this.hashKey(keyOrHash);

      const id = `key_${hashedKey.substring(0, 8)}`;

      this.keys.set(hashedKey, {
        id,
        name: name || `key-${userId}`,
        hashedKey,
        userId,
        isActive: true,
        expiresAt: null,
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
      });
    }

    // [REVISED from v1: log count only, no key details (P2-9)]
    console.log(`[ApiKeyStore] Loaded ${this.keys.size} API key(s)`);
  }

  /**
   * [REVISED from v1] Validate an API key and return the associated record.
   *
   * v1 iterated all keys with constantTimeCompare(), which:
   * - Was O(N) and leaked key count via timing
   * - Had an early-exit that leaked which key index matched
   *
   * v2 uses O(1) Map.get() for hash lookup, then a single timingSafeEqual
   * to verify the hash. This is both faster and more secure.
   *
   * Returns null if:
   * - Key not found
   * - Key is inactive
   * - Key is expired
   */
  validate(plaintextKey: string): ApiKeyRecord | null {
    if (!plaintextKey) return null;

    const candidateHash = this.hashKey(plaintextKey);

    // [REVISED from v1: O(1) lookup instead of O(N) iteration (P0-1)]
    const record = this.keys.get(candidateHash);

    if (!record) return null;

    // Constant-time verify to prevent timing attacks on partial hash collisions.
    // SHA-256 hex digests are always 64 chars / 32 bytes.
    const bufA = Buffer.from(candidateHash, 'hex');
    const bufB = Buffer.from(record.hashedKey, 'hex');
    if (!timingSafeEqual(bufA, bufB)) return null;

    // Check active status
    if (!record.isActive) return null;

    // Check expiration [REVISED from v1: expiresAt is now string | null (P2-12)]
    if (record.expiresAt && new Date(record.expiresAt) < new Date()) {
      return null;
    }

    // Update last used (non-blocking)
    record.lastUsedAt = new Date().toISOString();

    return record;
  }

  // [REVISED from v1: constantTimeCompare() helper method REMOVED entirely (P0-1)]
  // The v1 method had a length-check early return that could leak timing info.
  // The inline timingSafeEqual in validate() is simpler and correct.

  /**
   * Hash an API key using SHA-256.
   */
  hashKey(key: string): string {
    return createHash('sha256').update(key).digest('hex');
  }

  /**
   * Check if a value looks like an already-hashed key (64-char hex string).
   */
  private isAlreadyHashed(value: string): boolean {
    return /^[a-f0-9]{64}$/.test(value);
  }

  /**
   * [REVISED from v1] Generate a new API key (for admin/setup use).
   *
   * Returns the plaintext key. Caller is responsible for:
   * 1. Displaying it to the user exactly once
   * 2. Storing only the hash
   */
  static generateKey(): string {
    // [REVISED from v1: uses top-level import, not require() (P1-6)]
    const bytes = randomBytes(32);
    return `${API_KEY_PREFIX}${bytes.toString('base64url')}`;
  }

  /** Get count of loaded keys. */
  get size(): number {
    return this.keys.size;
  }

  /** Find a record by its ID (for logging, admin). */
  findById(id: string): ApiKeyRecord | null {
    for (const record of this.keys.values()) {
      if (record.id === id) return record;
    }
    return null;
  }

  /** Clear all keys (for testing). */
  clear(): void {
    this.keys.clear();
  }
}

// Singleton
let store: ApiKeyStore | null = null;

export function getApiKeyStore(): ApiKeyStore {
  if (!store) {
    store = new ApiKeyStore();
    store.loadFromEnv();
  }
  return store;
}

export function resetApiKeyStore(): void {
  store = null;
}
