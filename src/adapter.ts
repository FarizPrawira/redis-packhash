import { UnsupportedClientError } from "./errors.js";

/**
 * The normalized command surface redis-packhash needs, all Promise-returning.
 * Built-in detection produces one of these from a Redis client. To use an
 * exotic client, pass a plain object of this shape as the `client` argument.
 */
export interface PackHashAdapter {
  hset(key: string, field: string, value: string): Promise<unknown>;
  hget(key: string, field: string): Promise<string | null>;
  hdel(key: string, field: string): Promise<unknown>;
}

type AnyFn = (...args: unknown[]) => unknown;
type UnknownRecord = Record<string, unknown>;

/** True if `target` has a callable method named `method`. */
const hasMethod = (target: unknown, method: string): boolean =>
  !!target &&
  typeof target === "object" &&
  typeof (target as UnknownRecord)[method] === "function";

/** Invoke `target[method](...args)`. */
const invoke = (target: unknown, method: string, ...args: unknown[]): unknown =>
  ((target as UnknownRecord)[method] as AnyFn)(...args);

/**
 * Resolve a raw client into a normalized adapter.
 *
 * Detection:
 *   - node-redis v4+ — camelCase command methods (hSet, hGet, …)
 *   - ioredis or any other client — lowercase command methods (hset, hget, …)
 *
 * @returns A normalized adapter exposing `hset`/`hget`/`hdel`.
 * @throws {UnsupportedClientError} If the client is missing required methods.
 */
export function resolveAdapter(client: unknown): PackHashAdapter {
  // node-redis v4+ uses camelCase command methods; ioredis and other clients
  // use lowercase. Pick the casing, then validate the *whole* set — so a partial
  // client fails with a clear UnsupportedClientError rather than a late crash.
  const [setName, getName, delName] = hasMethod(client, "hSet")
    ? (["hSet", "hGet", "hDel"] as const)
    : (["hset", "hget", "hdel"] as const);

  const missing = [setName, getName, delName].filter(
    (method) => !hasMethod(client, method),
  );
  if (missing.length > 0) throw new UnsupportedClientError(missing);

  return {
    hset: (key, field, value) =>
      Promise.resolve(invoke(client, setName, key, field, value)),
    hget: (key, field) =>
      Promise.resolve(invoke(client, getName, key, field)) as Promise<
        string | null
      >,
    hdel: (key, field) => Promise.resolve(invoke(client, delName, key, field)),
  };
}
