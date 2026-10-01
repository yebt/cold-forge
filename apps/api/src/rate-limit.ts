/**
 * Sliding-window rate limiting.
 *
 * IMPORTANT (single-instance assumption): `MemoryRateLimiter` keeps its state in this process
 * only. With several API instances each one counts separately (effective limit = limit ×
 * instances), and limits reset on restart. Run a single instance, or implement `RateLimiter` on
 * top of Redis (sorted sets / a Lua script) and inject it into `createApp`.
 *
 * Memory is bounded per store. A full store NEVER evicts a bucket that still has hits inside its
 * window (that would silently reset a limit an attacker is up against). It only evicts idle,
 * fully expired buckets, least-recently-used first. When nothing can be evicted the store either
 * fails CLOSED (auth/user stores: the request is refused with 429) or OPEN (the coarse per-IP
 * flood store, so a key flood cannot take the whole API down); see `failClosed`.
 */

export interface Rule {
  limit: number;
  windowMs: number;
}

export interface Take {
  key: string;
  rules: readonly Rule[];
  /** Weight of this hit (default 1). A cost of 0 checks nothing and records nothing. */
  cost?: number;
}

export interface RateLimiter {
  /**
   * Atomically checks every rule for `key`. If all allow it, records `cost` under each rule and
   * resolves true. Otherwise records nothing and resolves false.
   */
  take(key: string, rules: readonly Rule[], cost?: number): Promise<boolean>;
  /** Like `take`, but all-or-nothing across several keys. */
  takeAll(takes: readonly Take[]): Promise<boolean>;
  /** True if `take(key, rules, cost)` would succeed right now. Records nothing. */
  check(key: string, rules: readonly Rule[], cost?: number): Promise<boolean>;
  /** Drops expired state. Called periodically. */
  sweep(): void;
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** Every limit the API enforces, in one place. */
export const RATE_LIMITS = {
  /** Per IP (IPv6: per /64), every request (coarse flood protection). */
  ipGlobal: [{ limit: 600, windowMs: MINUTE }],
  /** Per IP on POST /v1/auth/magic-link → 429. */
  magicLinkIp: [{ limit: 10, windowMs: 15 * MINUTE }],
  /** Per (normalized email, IP) on POST /v1/auth/magic-link → silently not sent (still 202). */
  magicLinkEmailIp: [{ limit: 3, windowMs: 15 * MINUTE }],
  /**
   * Per normalized email, shared by everyone → silently not sent (still 202). Loose on purpose:
   * a stranger must not be able to burn a victim's budget. The cooldown spaces out emails.
   */
  magicLinkEmail: [
    { limit: 1, windowMs: 30_000 },
    { limit: 20, windowMs: DAY },
  ],
  /** Per IP on POST /v1/auth/verify → 429. */
  verifyIp: [{ limit: 20, windowMs: 15 * MINUTE }],
  /** Per IP: successful verifies that CREATE an account → 429. */
  newAccountsIp: [{ limit: 5, windowMs: DAY }],
  /** Per user on every authenticated endpoint → 429. */
  user: [{ limit: 120, windowMs: MINUTE }],
  /** Per user on POST /v1/sync → 429 (on top of `user`). */
  userSync: [{ limit: 20, windowMs: MINUTE }],
  /** Per user on GET /v1/export → 429 (on top of `user`). */
  userExport: [{ limit: 5, windowMs: HOUR }],
  /** Per user: records submitted to /v1/sync (cost-based) → 429. */
  userWrites: [{ limit: 20_000, windowMs: MINUTE }],
} satisfies Record<string, Rule[]>;

interface Bucket {
  windowMs: number;
  /** Ascending hit times and their weights; `total` = sum of weights still in the window. */
  times: number[];
  weights: number[];
  total: number;
}

export interface MemoryRateLimiterOptions {
  /** Hard cap on tracked buckets so a flood of distinct keys cannot exhaust memory. */
  maxBuckets?: number;
  /** When the store is full of live buckets: refuse (true) or allow without tracking (false). */
  failClosed?: boolean;
  /** Called (rate-limited by the caller's logging) when the store is full of live buckets. */
  onFull?: () => void;
}

export class MemoryRateLimiter implements RateLimiter {
  /** bucket id → bucket. Map order = recency (a touched bucket is moved to the end), so the front is LRU. */
  private readonly buckets = new Map<string, Bucket>();
  private readonly maxBuckets: number;
  private readonly failClosed: boolean;
  private readonly onFull: (() => void) | undefined;
  private lastFullSweep = Number.NEGATIVE_INFINITY;

  constructor(
    private readonly now: () => number,
    opts: MemoryRateLimiterOptions | number = {},
  ) {
    const o = typeof opts === "number" ? { maxBuckets: opts } : opts;
    this.maxBuckets = o.maxBuckets ?? 200_000;
    this.failClosed = o.failClosed ?? true;
    this.onFull = o.onFull;
  }

  async take(key: string, rules: readonly Rule[], cost = 1): Promise<boolean> {
    return this.takeAllSync([{ key, rules, cost }]);
  }

  async takeAll(takes: readonly Take[]): Promise<boolean> {
    return this.takeAllSync(takes);
  }

  async check(key: string, rules: readonly Rule[], cost = 1): Promise<boolean> {
    return this.evaluate([{ key, rules, cost }]) !== null;
  }

  takeSync(key: string, rules: readonly Rule[], cost = 1): boolean {
    return this.takeAllSync([{ key, rules, cost }]);
  }

  takeAllSync(takes: readonly Take[]): boolean {
    const plan = this.evaluate(takes);
    if (!plan) return false;
    const now = this.now();
    const missing = plan.filter((p) => !p.bucket).length;
    if (missing && !this.makeRoom(missing, now)) {
      this.onFull?.();
      if (this.failClosed) return false;
      return true; // fail open: allowed, but untracked
    }
    for (const p of plan) {
      const bucket = p.bucket ?? { windowMs: p.rule.windowMs, times: [], weights: [], total: 0 };
      bucket.times.push(now);
      bucket.weights.push(p.cost);
      bucket.total += p.cost;
      // Re-insert to mark as most recently used.
      this.buckets.delete(p.id);
      this.buckets.set(p.id, bucket);
    }
    return true;
  }

  sweep(): void {
    const now = this.now();
    for (const [id, bucket] of this.buckets) {
      this.prune(bucket, now);
      if (bucket.total === 0 && bucket.times.length === 0) this.buckets.delete(id);
    }
  }

  get size(): number {
    return this.buckets.size;
  }

  /** null = denied. Otherwise the buckets to charge (with `bucket` undefined for new ones). */
  private evaluate(takes: readonly Take[]) {
    const now = this.now();
    const plan: { id: string; rule: Rule; cost: number; bucket: Bucket | undefined }[] = [];
    for (const { key, rules, cost = 1 } of takes) {
      if (cost <= 0) continue;
      for (const rule of rules) {
        const id = `${rule.windowMs}:${rule.limit}:${key}`;
        const bucket = this.buckets.get(id);
        if (bucket) this.prune(bucket, now);
        if ((bucket?.total ?? 0) + cost > rule.limit) return null;
        plan.push({ id, rule, cost, bucket });
      }
    }
    return plan;
  }

  private prune(bucket: Bucket, now: number): void {
    const cutoff = now - bucket.windowMs;
    let i = 0;
    while (i < bucket.times.length && bucket.times[i]! <= cutoff) bucket.total -= bucket.weights[i++]!;
    if (i) {
      bucket.times.splice(0, i);
      bucket.weights.splice(0, i);
    }
  }

  /** Frees `n` slots by evicting only expired buckets, LRU first. False if it cannot. */
  private makeRoom(n: number, now: number): boolean {
    if (this.buckets.size + n <= this.maxBuckets) return true;
    // Cheap pass: look at a few least-recently-used buckets.
    let scanned = 0;
    for (const [id, bucket] of this.buckets) {
      if (this.buckets.size + n <= this.maxBuckets || scanned++ >= 64) break;
      this.prune(bucket, now);
      if (bucket.times.length === 0) this.buckets.delete(id);
    }
    if (this.buckets.size + n <= this.maxBuckets) return true;
    // Full sweep, at most once a second so a key flood cannot make every request O(n).
    if (now - this.lastFullSweep >= 1000) {
      this.lastFullSweep = now;
      this.sweep();
    }
    return this.buckets.size + n <= this.maxBuckets;
  }
}

/**
 * The limiter stores the app uses. Auth-critical namespaces live in their own store so that
 * traffic to other routes can never push them out, and that store fails closed when full.
 */
export interface Limiters {
  /** Coarse per-IP flood protection. Fails open when full. */
  general: RateLimiter;
  /** magic-link (ip, email, email+ip), verify ip, new accounts per ip, global mail cap. Fails closed. */
  auth: RateLimiter;
  /** Per-user limits (only authenticated users create keys). Fails closed. */
  user: RateLimiter;
}

export function createMemoryLimiters(now: () => number, onFull?: (store: string) => void): Limiters {
  return {
    general: new MemoryRateLimiter(now, { maxBuckets: 200_000, failClosed: false, onFull: () => onFull?.("general") }),
    auth: new MemoryRateLimiter(now, { maxBuckets: 200_000, failClosed: true, onFull: () => onFull?.("auth") }),
    user: new MemoryRateLimiter(now, { maxBuckets: 100_000, failClosed: true, onFull: () => onFull?.("user") }),
  };
}
