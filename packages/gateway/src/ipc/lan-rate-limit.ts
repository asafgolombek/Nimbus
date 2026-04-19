export interface RateLimitConfig {
  maxFailures: number;
  windowMs: number;
  lockoutMs: number;
}

export class LanRateLimiter {
  private readonly failures = new Map<string, number[]>();
  private readonly lockoutUntil = new Map<string, number>();
  private readonly now: () => number;

  constructor(
    private readonly cfg: RateLimitConfig,
    now?: () => number,
  ) {
    this.now = now ?? (() => Date.now());
  }

  checkAllowed(ip: string): boolean {
    const lockEnd = this.lockoutUntil.get(ip);
    const t = this.now();
    if (lockEnd !== undefined && t < lockEnd) return false;
    if (lockEnd !== undefined && t >= lockEnd) {
      this.lockoutUntil.delete(ip);
      this.failures.delete(ip);
    }
    return true;
  }

  recordFailure(ip: string): void {
    const t = this.now();
    const arr = this.failures.get(ip) ?? [];
    arr.push(t);
    const cutoff = t - this.cfg.windowMs;
    const pruned = arr.filter((ts) => ts >= cutoff);
    this.failures.set(ip, pruned);
    if (pruned.length >= this.cfg.maxFailures) {
      this.lockoutUntil.set(ip, t + this.cfg.lockoutMs);
    }
  }

  recordSuccess(ip: string): void {
    this.failures.delete(ip);
    this.lockoutUntil.delete(ip);
  }
}
