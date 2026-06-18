import { describe, it, expect } from "vitest";
import { fnv1a } from "../src/index.js";

describe("fnv1a", () => {
  describe("when given an empty string", () => {
    it("should return the FNV offset basis", () => {
      expect(fnv1a("")).toBe(2166136261);
    });
  });

  describe("when given known inputs", () => {
    it("should return the documented reference hashes", () => {
      expect(fnv1a("a")).toBe(3826002220);
      expect(fnv1a("abc")).toBe(440920331);
    });
  });

  describe("when called repeatedly with the same input", () => {
    it("should be deterministic", () => {
      expect(fnv1a("user:12345")).toBe(fnv1a("user:12345"));
    });
  });

  describe("for any input", () => {
    it("should return an unsigned 32-bit integer", () => {
      for (const input of ["", "a", "hello world", "John Doe", "user:999999"]) {
        const hash = fnv1a(input);
        expect(Number.isInteger(hash)).toBe(true);
        expect(hash).toBeGreaterThanOrEqual(0);
        expect(hash).toBeLessThanOrEqual(0xffffffff);
      }
    });
  });

  describe("when two inputs differ by one character", () => {
    it("should scatter them into different buckets", () => {
      expect(fnv1a("user:12345") % 1024).not.toBe(fnv1a("user:12346") % 1024);
    });
  });
});
