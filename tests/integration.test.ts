import { afterAll, beforeAll, describe, expect, it } from "vitest";
import Redis from "ioredis";
import { PackHash } from "../src/index.js";

// Runs only when REDIS_URL is set (the CI integration job). Skipped locally and
// in the unit-test matrix, so `npm test` never needs a Redis server.
const url = process.env.REDIS_URL;

describe.skipIf(!url)("redis integration (listpack encoding)", () => {
  let redis: Redis;

  beforeAll(async () => {
    redis = new Redis(url as string);
    await redis.flushdb();
  });

  afterAll(async () => {
    await redis?.quit();
  });

  it("keeps a small bucket in listpack encoding", async () => {
    const store = new PackHash(redis, { namespace: "small" });
    await store.set("user:1", "v");
    const encoding = await redis.call(
      "OBJECT",
      "ENCODING",
      store.bucketKeyFor("user:1"),
    );
    expect(encoding).toBe("listpack");
    expect(await store.get("user:1")).toBe("v");
  });

  it("promotes a bucket to hashtable once it exceeds the listpack entry limit", async () => {
    // Pin the threshold explicitly so the test doesn't depend on the image's
    // default. expectedKeys:1 → a single bucket, so every key collides into it.
    await redis.call("CONFIG", "SET", "hash-max-listpack-entries", "8");
    const store = new PackHash(redis, { namespace: "big", expectedKeys: 1 });
    for (let i = 0; i < 16; i++) await store.set(`k:${i}`, "v");
    const encoding = await redis.call(
      "OBJECT",
      "ENCODING",
      store.bucketKeyFor("k:0"),
    );
    expect(encoding).toBe("hashtable");
  });
});
