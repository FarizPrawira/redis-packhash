import { describe, it, expect, vi } from "vitest";
import { resolveAdapter, UnsupportedClientError } from "../src/index.js";

describe("resolveAdapter", () => {
  describe("when given an ioredis-style (lowercase) client", () => {
    it("should proxy the lowercase hash commands", async () => {
      const client = {
        hset: vi.fn(async () => 1),
        hget: vi.fn(async () => "v"),
        hdel: vi.fn(async () => 1),
      };
      const adapter = resolveAdapter(client);
      await adapter.hset("k", "f", "v");
      expect(await adapter.hget("k", "f")).toBe("v");
      expect(client.hset).toHaveBeenCalledWith("k", "f", "v");
    });
  });

  describe("when given a node-redis (camelCase) client", () => {
    it("should proxy the camelCase hash commands", async () => {
      const client = {
        hSet: vi.fn(async () => 1),
        hGet: vi.fn(async () => "v"),
        hDel: vi.fn(async () => 1),
      };
      const adapter = resolveAdapter(client);
      expect(await adapter.hget("k", "f")).toBe("v");
      expect(client.hGet).toHaveBeenCalledWith("k", "f");
    });
  });

  describe("when given a plain object with hset/hget/hdel", () => {
    it("should accept it as a client", async () => {
      const adapter = resolveAdapter({
        hset: async () => 1,
        hget: async () => "v",
        hdel: async () => 1,
      });
      expect(await adapter.hget("k", "f")).toBe("v");
    });
  });

  describe("when the client is missing required methods", () => {
    it("should throw UnsupportedClientError naming the missing lowercase methods", () => {
      expect(() => resolveAdapter({ hset: () => {} })).toThrowError(
        UnsupportedClientError,
      );
      try {
        resolveAdapter({ hset: () => {} });
      } catch (error) {
        expect((error as UnsupportedClientError).missing).toEqual([
          "hget",
          "hdel",
        ]);
      }
    });

    it("should throw for a camelCase client missing hGet/hDel", () => {
      expect(() => resolveAdapter({ hSet: async () => 1 })).toThrowError(
        UnsupportedClientError,
      );
      try {
        resolveAdapter({ hSet: async () => 1 });
      } catch (error) {
        expect((error as UnsupportedClientError).missing).toEqual([
          "hGet",
          "hDel",
        ]);
      }
    });
  });
});
