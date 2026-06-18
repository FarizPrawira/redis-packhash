import { describe, it, expect } from "vitest";
import {
  PackHash,
  computeBuckets,
  fnv1a,
  type PackHashAdapter,
  type PackHashOptions,
} from "../src/index.js";

/** In-memory adapter: each bucket is a Map of field → value. */
function memoryAdapter(): PackHashAdapter & {
  store: Map<string, Map<string, string>>;
} {
  const store = new Map<string, Map<string, string>>();
  const fieldsOf = (key: string) =>
    store.get(key) ?? store.set(key, new Map()).get(key)!;
  return {
    store,
    async hset(key, field, value) {
      fieldsOf(key).set(field, value);
      return 1;
    },
    async hget(key, field) {
      return store.get(key)?.get(field) ?? null;
    },
    async hdel(key, field) {
      return store.get(key)?.delete(field) ? 1 : 0;
    },
  };
}

/** Construct a store with a small default size for tests where sizing is irrelevant. */
function makeStore(
  adapter: ReturnType<typeof memoryAdapter> = memoryAdapter(),
  opts: Partial<PackHashOptions> = {},
): PackHash {
  return new PackHash(adapter, { expectedKeys: 1000, ...opts });
}

/** computeBuckets with the default entry limit, for assertions. */
const sizeFor = (expectedKeys: number) =>
  computeBuckets({ expectedKeys, maxListpackEntries: 128 });

describe("PackHash", () => {
  describe("construction", () => {
    describe("when expectedKeys is omitted", () => {
      it("should default to 1024 buckets", () => {
        const store = new PackHash(memoryAdapter());
        expect(store.buckets).toBe(1024);
      });
    });

    describe("when expectedKeys is provided", () => {
      it("should size the bucket count from it", () => {
        const store = new PackHash(memoryAdapter(), {
          expectedKeys: 1_000_000,
        });
        expect(store.buckets).toBe(sizeFor(1_000_000));
      });
    });

    describe("when given invalid options", () => {
      it("should reject a negative expectedKeys", () => {
        expect(
          () => new PackHash(memoryAdapter(), { expectedKeys: -1 }),
        ).toThrow(TypeError);
      });

      it("should reject an empty namespace", () => {
        expect(() => new PackHash(memoryAdapter(), { namespace: "" })).toThrow(
          TypeError,
        );
      });

      it("should reject a non-positive maxListpackEntries", () => {
        expect(
          () => new PackHash(memoryAdapter(), { maxListpackEntries: 0 }),
        ).toThrow(TypeError);
      });
    });
  });

  describe("computeBuckets", () => {
    it("should target ~75% of the entry limit by default", () => {
      // 1,000,000 keys, target floor(128 * 0.75) = 96 per bucket
      expect(sizeFor(1_000_000)).toBe(Math.ceil(1_000_000 / 96));
    });

    it("should keep the average under the entry limit", () => {
      const expectedKeys = 500_000;
      expect(expectedKeys / sizeFor(expectedKeys)).toBeLessThan(128);
    });

    it("should honor a custom entry limit", () => {
      // 100 * 0.75 = 75 per bucket
      expect(
        computeBuckets({ expectedKeys: 1000, maxListpackEntries: 100 }),
      ).toBe(Math.ceil(1000 / 75));
    });
  });

  describe("set and get", () => {
    it("should store and return the exact string given", async () => {
      const store = makeStore();
      const raw = JSON.stringify({ name: "John Doe", plan: "pro" });
      await store.set("user:12345", raw);
      expect(await store.get("user:12345")).toBe(raw);
    });

    it("should preserve an empty string", async () => {
      const store = makeStore();
      await store.set("k", "");
      expect(await store.get("k")).toBe("");
    });

    describe("when the key is absent", () => {
      it("should return null", async () => {
        const store = makeStore();
        expect(await store.get("nope")).toBeNull();
      });
    });

    describe("when the value is not a string", () => {
      it("should throw a TypeError", async () => {
        const store = makeStore();
        await expect(store.set("k", 123 as never)).rejects.toThrow(TypeError);
      });
    });

    it("should route a key to its namespace-prefixed FNV bucket", async () => {
      const adapter = memoryAdapter();
      const store = makeStore(adapter, {
        namespace: "u",
        expectedKeys: 100_000,
      });
      await store.set("user:12345", "1");
      // derive the expected bucket independently — don't reuse bucketKeyFor
      const expected = `u:${fnv1a("user:12345") % store.buckets}`;
      expect(store.bucketKeyFor("user:12345")).toBe(expected);
      expect(adapter.store.get(expected)?.get("user:12345")).toBe("1");
    });
  });

  describe("del and has", () => {
    it("should delete an existing key and report it removed", async () => {
      const store = makeStore();
      await store.set("k", "v");
      expect(await store.has("k")).toBe(true);
      expect(await store.del("k")).toBe(true);
      expect(await store.has("k")).toBe(false);
    });

    describe("when deleting a missing key", () => {
      it("should report false", async () => {
        const store = makeStore();
        expect(await store.del("ghost")).toBe(false);
      });
    });
  });

  describe("bulk operations", () => {
    it("should round-trip many entries through mset and mget", async () => {
      const store = makeStore();
      await store.mset([
        ["a", "1"],
        ["b", "2"],
      ]);
      const results = await store.mget(["a", "b", "missing"]);
      expect(results.get("a")).toBe("1");
      expect(results.get("b")).toBe("2");
      expect(results.get("missing")).toBeNull();
    });
  });

  describe("with a node-redis (camelCase) client", () => {
    it("should work end-to-end through set/get/has/del", async () => {
      const data = new Map<string, Map<string, string>>();
      const fieldsOf = (key: string) =>
        data.get(key) ?? data.set(key, new Map()).get(key)!;
      const camelClient = {
        hSet: async (key: string, field: string, value: string) => {
          fieldsOf(key).set(field, value);
          return 1;
        },
        hGet: async (key: string, field: string) =>
          data.get(key)?.get(field) ?? null,
        hDel: async (key: string, field: string) =>
          data.get(key)?.delete(field) ? 1 : 0,
      };
      const store = new PackHash(camelClient, { expectedKeys: 1000 });
      await store.set("k", "v");
      expect(await store.get("k")).toBe("v");
      expect(await store.has("k")).toBe(true);
      expect(await store.del("k")).toBe(true);
      expect(await store.get("k")).toBeNull();
    });
  });
});
