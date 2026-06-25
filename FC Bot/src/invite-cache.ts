/**
 * Cache for tracking invite cooldowns to prevent spam
 * Uses lazy pruning to optimize performance
 */
export class InviteCache {
  private readonly entries = new Map<string, number>();
  private lastPruneTime = 0;
  private readonly pruneIntervalMs = 60000; // Prune every 60 seconds

  constructor(private readonly cooldownMs: number) {}

  /**
   * Attempt to claim an invite slot for the given key
   * @param key - Unique identifier (typically XUID)
   * @returns true if invite can be sent, false if still in cooldown
   */
  claim(key: string): boolean {
    const now = Date.now();
    
    // Lazy pruning: only prune periodically instead of on every claim
    if (now - this.lastPruneTime > this.pruneIntervalMs) {
      this.prune(now);
      this.lastPruneTime = now;
    }

    const expiresAt = this.entries.get(key);
    if (expiresAt && expiresAt > now) {
      return false;
    }

    this.entries.set(key, now + this.cooldownMs);
    return true;
  }

  /**
   * Clear all cooldown entries
   */
  clear(): void {
    this.entries.clear();
    this.lastPruneTime = 0;
  }

  /**
   * Get current cache size (includes expired entries until next prune)
   */
  size(): number {
    return this.entries.size;
  }

  /**
   * Remove expired entries from the cache
   */
  private prune(now: number): void {
    for (const [key, expiresAt] of this.entries) {
      if (expiresAt <= now) {
        this.entries.delete(key);
      }
    }
  }
}
