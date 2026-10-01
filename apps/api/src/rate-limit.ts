/**
 * Sliding-window rate limiting.
 *
 * IMPORTANT: `MemoryRateLimiter` keeps its state in this process only. With several API
 * instances each one counts separately (effective limit = limit × instances), and limits
 * reset on restart. Run a single instance, or implement `RateLimiter` on top of Redis
 * (sorted sets / a Lua script) and inject it into `createApp`.
 */

export interface Rule {
  limit: number;
  windowMs: number;
}

export interface RateLimiter {
  /**
   * Atomically checks every rule for `key`. If all allow it, records one hit under each
   * rule and resolves true. Otherwise records nothing and resolves false.
   */
  take(key: string, rules: readonly Rule[]): Promise<boolean>;
  /** Drops expired state. Called periodically. */
  sweep(): void;
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** Every limit the API enforces, in one place. */
export const RATE_LIMITS = {
  /** Per IP, every request (coarse flood protection). */
  ipGlobal: [{ limit: 600, windowMs: MINUTE }],
  /** Per IP on POST /v1/auth/magic-link → 429. */
  magicLinkIp: [{ limit: 10, windowMs: 15 * MINUTE }],
  /** Per normalized email on POST /v1/auth/magic-link → silently not sent (still 202). */
  magicLinkEmail: [
    { limit: 3, windowMs: 15 * MINUTE },
    { limit: 10, windowMs: DAY },
  ],
  /** Per IP on POST /v1/auth/verify → 429. */
  verifyIp: [{ limit: 20, windowMs: 15 * MINUTE }],
  /** Per user on every authenticated endpoint → 429. */
  user: [{ limit: 120, windowMs: MINUTE }],
} satisfies Record<string, Rule[]>;

export class MemoryRateLimiter implements RateLimiter {
  /** bucket key → ascending hit timestamps (at most `limit` of them). */
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly now: () => number,
    /** Hard cap on tracked buckets so a flood of distinct keys cannot exhaust memory. */
    private readonly maxBuckets = 200_000,
  ) {}

  async take(key: string, rules: readonly Rule[]): Promise<boolean> {
    return this.takeSync(key, rules);
  }

  takeSync(key: string, rules: readonly Rule[]): boolean {
    const now = this.now();
    const buckets = rules.map((rule) => {
      const id = `${rule.windowMs}:${rule.limit}:${key}`;
      const list = this.prune(id, now - rule.windowMs);
      return { id, list, rule };
    });
    if (buckets.some(({ list, rule }) => list.length >= rule.limit)) return false;
    for (const { id, list } of buckets) {
      list.push(now);
      if (!this.hits.has(id)) {
        if (this.hits.size >= this.maxBuckets) this.evictOldest();
        this.hits.set(id, list);
      }
    }
    return true;
  }

  sweep(): void {
    const now = this.now();
    for (const [id, list] of this.hits) {
      const windowMs = Number(id.slice(0, id.indexOf(":")));
      while (list.length && list[0]! <= now - windowMs) list.shift();
      if (!list.length) this.hits.delete(id);
    }
  }

  get size(): number {
    return this.hits.size;
  }

  private prune(id: string, cutoff: number): number[] {
    const list = this.hits.get(id) ?? [];
    while (list.length && list[0]! <= cutoff) list.shift();
    return list;
  }

  private evictOldest(): void {
    const first = this.hits.keys().next();
    if (!first.done) this.hits.delete(first.value);
  }
}
