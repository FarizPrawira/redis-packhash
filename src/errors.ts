/** Thrown when the supplied client can't satisfy the required command surface. */
export class UnsupportedClientError extends Error {
  readonly missing: readonly string[];

  constructor(missing: readonly string[]) {
    super(
      `redis-packhash: client is missing required method(s): ${missing.join(", ")}. ` +
        `Pass an ioredis or node-redis instance, or any object exposing ` +
        `hset/hget/hdel.`,
    );
    this.name = "UnsupportedClientError";
    this.missing = missing;
  }
}
