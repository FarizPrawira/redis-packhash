# redis-packhash [![npm](https://img.shields.io/npm/v/redis-packhash.svg)](https://www.npmjs.com/package/redis-packhash)

> Bucket your Redis keys into hashes so they stay in the memory-compact listpack encoding

Storing millions of small values as top-level Redis keys wastes memory — each key carries heavy per-key overhead. redis-packhash shards them across a fixed set of hashes ("buckets") sized to stay in Redis's [listpack](#how-it-works) encoding, cutting memory use several-fold, behind a tiny `set`/`get`/`del` API.

Works with [ioredis](https://github.com/redis/ioredis), [node-redis](https://github.com/redis/node-redis), or any client exposing the hash commands. No runtime dependencies.

## Install

```sh
npm install redis-packhash
```

Requires Node.js ≥ 22.

## Usage

```ts
import { PackHash } from "redis-packhash";
import Redis from "ioredis";

const store = new PackHash(new Redis(), { namespace: "users", expectedKeys: 1_000_000 });

// Values are strings — serialize and parse on your side.
await store.set("user:12345", JSON.stringify({ name: "John Doe", plan: "pro" }));

const raw = await store.get("user:12345");
//=> '{"name":"John Doe","plan":"pro"}'
const user = raw ? JSON.parse(raw) : null;

await store.has("user:12345");
//=> true

await store.del("user:12345");
//=> true
```

## API

### new PackHash(client, options?)

Returns a new store.

`client` is an [ioredis](https://github.com/redis/ioredis) / [node-redis](https://github.com/redis/node-redis) instance, or any object exposing `hset`/`hget`/`hdel` — to use an exotic client, wrap it into that shape and pass it as `client`. If a required method is missing, the constructor throws `UnsupportedClientError`.

### options

Type: `object`

#### expectedKeys

Type: `number`\
*Optional*

Rough number of keys you expect to store. redis-packhash sizes the bucket count from it, so you never compute buckets yourself. When omitted, the store uses **1024 buckets** (good up to ~100k keys).

> **Warning:** Treat this as fixed for a populated dataset. Changing it enough to change the resolved bucket count remaps every key — existing entries are then missed and orphaned. See [How it works](#how-it-works).

#### namespace

Type: `string`\
Default: `'ph'`

Prefix for the Redis keys this store creates (`<namespace>:<n>`). Use distinct namespaces to keep independent datasets from colliding.

#### maxListpackEntries

Type: `number`\
Default: `128`

Mirror of your server's `hash-max-listpack-entries`. Set it only if you've changed the default in `redis.conf`.

### Instance

Values are strings — serialize (e.g. `JSON.stringify`) and parse them yourself.

#### .set(key, value)

Store a string. Throws `TypeError` if `value` is not a string.

#### .get(key)

Get the stored string, or `null` if the key is absent.

#### .del(key)

Delete a key. Returns `true` if a value was removed, `false` if it didn't exist.

#### .has(key)

Check whether a key exists.

#### .mset(entries)

Store many `[key, value]` pairs. Sequential — not pipelined.

#### .mget(keys)

Read many keys. Returns a `Map` from each key to its string, or `null` where absent.

#### .bucketKeyFor(key)

The Redis hash key a logical key maps to (`<namespace>:<n>`). Handy for debugging.

### computeBuckets(options)

Standalone helper that returns the bucket count for a dataset size, without constructing a store.

```ts
import { computeBuckets } from "redis-packhash";

computeBuckets({ expectedKeys: 1_000_000, maxListpackEntries: 128 });
//=> 10417
```

## How it works

**Listpack** is Redis's compact in-memory encoding for small hashes — the current name for what used to be called *ziplist* (renamed in Redis 7.0+). Redis selects it automatically, and keeps using it until a hash grows past a size threshold, at which point the hash is promoted to a hashtable that costs far more memory. So you never *use* listpack directly; you keep each hash small enough to *stay* in it.

That's the whole trick: redis-packhash shards your keys across `N` buckets and keeps each bucket under the threshold.

```
store.set("user:12345", val)
        │
        ├─ bucket = fnv1a("user:12345") % buckets   → 847
        ├─ HSET  users:847  "user:12345"  val        ← one field per logical key
        └─ each "users:N" hash stays a listpack → compact memory
```

From `expectedKeys` it targets ~75% of `maxListpackEntries` (≈ 96 of the default 128) per bucket — aiming below the limit leaves headroom for uneven hash distribution and growth.

> **Note:** The listpack value limit (`hash-max-listpack-value`, default 64 B) applies to **both the value and the field name** — and your key *is* the field. A key (or value) longer than that promotes its bucket out of listpack. The bucket key name / `namespace` is a top-level key and does **not** count.

## Caveats

- **Values are strings.** redis-packhash stores exactly what you pass and returns it verbatim — serialize and parse on your side.
- **No TTL.** Each key is a hash *field*, so ordinary `EXPIRE` can't target it. Per-field expiry exists only on Redis 7.4+ (`HEXPIRE`) and isn't exposed. Use plain top-level keys if you need expiry.
- **Bulk ops are sequential.** `mset`/`mget` loop rather than pipeline, to stay client-agnostic.
- **You manage the server threshold.** `maxListpackEntries` mirrors the default (128) for sizing; it can't read your `redis.conf`.

## Related

- [ioredis](https://github.com/redis/ioredis) — the most-used Redis client for Node.js
- [node-redis](https://github.com/redis/node-redis) — the official Redis client

## License

MIT © Fariz Prawira
