/**
 * Counts failures per key in a fixed window, in memory: enough for one
 * server process. Login uses two keys, so neither guessing one account from
 * many addresses nor many accounts from one address gets far.
 */
export class FailureLimiter {
  private readonly failures = new Map<string, { count: number; resetAt: number }>()

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /** Milliseconds until `key` may try again, or 0 if it may now. */
  retryAfterMs(key: string): number {
    const entry = this.failures.get(key)
    if (!entry) return 0
    const left = entry.resetAt - this.now()
    if (left <= 0) {
      this.failures.delete(key)
      return 0
    }
    return entry.count >= this.max ? left : 0
  }

  fail(key: string): void {
    const now = this.now()
    const entry = this.failures.get(key)
    if (!entry || entry.resetAt <= now) this.failures.set(key, { count: 1, resetAt: now + this.windowMs })
    else entry.count++
    if (this.failures.size > 10_000) this.prune(now)
  }

  reset(key: string): void {
    this.failures.delete(key)
  }

  private prune(now: number): void {
    for (const [key, entry] of this.failures) if (entry.resetAt <= now) this.failures.delete(key)
  }
}
