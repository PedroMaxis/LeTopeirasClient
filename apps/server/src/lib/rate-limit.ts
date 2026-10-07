/**
 * Fixed-window in-memory rate limiter. Fine for a single server process with a
 * handful of users; state is lost on restart, which is acceptable here.
 */
export class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records a hit for `key` and returns whether it is still within the limit. */
  consume(key: string): boolean {
    const now = this.now();
    const window = this.windows.get(key);
    if (!window || window.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      this.prune(now);
      return true;
    }
    window.count++;
    return window.count <= this.limit;
  }

  reset(key: string): void {
    this.windows.delete(key);
  }

  private prune(now: number): void {
    if (this.windows.size < 1000) return;
    for (const [key, window] of this.windows) if (window.resetAt <= now) this.windows.delete(key);
  }
}
