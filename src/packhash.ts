import { type PackHashAdapter, resolveAdapter } from "./adapter.js";
import { fnv1a } from "./hash.js";

export interface PackHashOptions {
  /**
   * Rough number of keys you expect to store. redis-packhash sizes the bucket
   * count from this, so you never compute or tune buckets yourself. Optional —
   * when omitted, the store uses 1024 buckets (good up to ~100k keys).
   */
  expectedKeys?: number;

  /**
   * Prefix for the Redis keys this store creates (`<namespace>:<n>`). Use
   * distinct namespaces to keep independent datasets from colliding.
   *
   * @default 'ph'
   */
  namespace?: string;

  /**
   * Mirror of your server's `hash-max-listpack-entries`. Used only to size
   * buckets — set it if you've changed the default in `redis.conf`.
   *
   * @default 128
   */
  maxListpackEntries?: number;
}

/**
 * Fraction of the entry limit we aim to fill per bucket when auto-sizing.
 * We target below the limit (not at it) to leave headroom for uneven hash
 * distribution and dataset growth. Chosen internally so callers never tune it.
 */
const TARGET_LOAD_FACTOR = 0.75;

/** Bucket count used when `expectedKeys` is not provided (good to ~100k keys). */
const DEFAULT_BUCKETS = 1024;

/** Default mirror of `hash-max-listpack-entries`. */
const DEFAULT_MAX_LISTPACK_ENTRIES = 128;

/** Inputs for {@link computeBuckets}. */
export interface ComputeBucketsOptions {
  /** Expected total number of keys. */
  expectedKeys: number;
  /** Server `hash-max-listpack-entries`. */
  maxListpackEntries: number;
}

/**
 * Derive a bucket count from your dataset size, so you never compute it by hand.
 *
 * Targets ~75% of `maxListpackEntries` per bucket — staying below the listpack
 * limit leaves headroom for uneven hash distribution and growth.
 *
 *   computeBuckets({ expectedKeys: 1_000_000, maxListpackEntries: 128 }) // → 10417
 *
 * Inputs are assumed valid; the PackHash constructor validates option values up
 * front so this stays a pure calculation.
 */
export function computeBuckets(options: ComputeBucketsOptions): number {
  const { expectedKeys, maxListpackEntries } = options;
  const targetPerBucket = Math.max(
    1,
    Math.floor(maxListpackEntries * TARGET_LOAD_FACTOR),
  );
  return Math.max(1, Math.ceil(expectedKeys / targetPerBucket));
}

/**
 * Validate user-supplied options once, at construction, so every downstream
 * function can trust the values without re-checking them.
 */
function validateOptions(options: PackHashOptions): void {
  const { expectedKeys, namespace, maxListpackEntries } = options;

  if (
    expectedKeys != null &&
    (!Number.isFinite(expectedKeys) || expectedKeys < 0)
  ) {
    throw new TypeError(
      `expectedKeys must be a non-negative number, got ${expectedKeys}`,
    );
  }
  if (
    namespace != null &&
    (typeof namespace !== "string" || namespace.length === 0)
  ) {
    throw new TypeError(
      `namespace must be a non-empty string, got ${String(namespace)}`,
    );
  }
  if (
    maxListpackEntries != null &&
    (!Number.isInteger(maxListpackEntries) || maxListpackEntries < 1)
  ) {
    throw new TypeError(
      `maxListpackEntries must be a positive integer, got ${maxListpackEntries}`,
    );
  }
}

/**
 * Stores many key→value pairs inside bucketed Redis hashes, so each hash stays
 * in Redis's memory-compact listpack encoding — cutting memory use several-fold
 * versus millions of top-level keys. Values are strings; serialize and parse
 * them yourself.
 *
 * @example
 * ```ts
 * import { PackHash } from "redis-packhash";
 * import Redis from "ioredis";
 *
 * const store = new PackHash(new Redis(), { expectedKeys: 1_000_000 });
 *
 * await store.set("user:12345", JSON.stringify({ name: "John Doe" }));
 * const raw = await store.get("user:12345"); // => '{"name":"John Doe"}' | null
 * ```
 */
export class PackHash {
  readonly namespace: string;
  readonly buckets: number;
  readonly maxListpackEntries: number;

  private readonly adapter: PackHashAdapter;

  /**
   * Create a store. `client` is an ioredis / node-redis instance, or any object
   * exposing `hset`/`hget`/`hdel` (wrap an exotic client into that shape). See
   * {@link PackHashOptions} for `options`.
   */
  constructor(client: unknown, options: PackHashOptions = {}) {
    validateOptions(options);
    const maxListpackEntries =
      options.maxListpackEntries ?? DEFAULT_MAX_LISTPACK_ENTRIES;
    const buckets =
      options.expectedKeys != null
        ? computeBuckets({ expectedKeys: options.expectedKeys, maxListpackEntries })
        : DEFAULT_BUCKETS;

    this.adapter = resolveAdapter(client);
    this.namespace = options.namespace ?? "ph";
    this.buckets = buckets;
    this.maxListpackEntries = maxListpackEntries;
  }

  /**
   * The Redis hash key a logical `key` maps to (`<namespace>:<n>`). Useful for
   * debugging or inspecting a bucket directly.
   */
  bucketKeyFor(key: string): string {
    return `${this.namespace}:${fnv1a(key) % this.buckets}`;
  }

  /**
   * Store a string under `key`. Serialize non-string values (e.g. with
   * `JSON.stringify`) before calling — redis-packhash never serializes for you.
   *
   * @throws {TypeError} If `value` is not a string.
   */
  async set(key: string, value: string): Promise<void> {
    if (typeof value !== "string") {
      throw new TypeError(
        `value for "${key}" must be a string; serialize it (e.g. JSON.stringify) before set()`,
      );
    }
    await this.adapter.hset(this.bucketKeyFor(key), key, value);
  }

  /**
   * Read the string stored under `key`.
   *
   * @returns The stored string, or `null` if the key is absent.
   */
  async get(key: string): Promise<string | null> {
    const raw = await this.adapter.hget(this.bucketKeyFor(key), key);
    return raw ?? null;
  }

  /**
   * Delete a key.
   *
   * @returns `true` if a value was removed, `false` if the key didn't exist.
   */
  async del(key: string): Promise<boolean> {
    const removed = await this.adapter.hdel(this.bucketKeyFor(key), key);
    return Number(removed) > 0;
  }

  /**
   * Check whether a key exists.
   *
   * @returns `true` if the key is present.
   */
  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== null;
  }

  /**
   * Store many `[key, value]` pairs. Sequential — not pipelined.
   */
  async mset(entries: Iterable<readonly [string, string]>): Promise<void> {
    for (const [key, value] of entries) await this.set(key, value);
  }

  /**
   * Read many keys at once.
   *
   * @returns A `Map` from each key to its stored string, or `null` where absent.
   */
  async mget(keys: Iterable<string>): Promise<Map<string, string | null>> {
    const results = new Map<string, string | null>();
    for (const key of keys) results.set(key, await this.get(key));
    return results;
  }
}
