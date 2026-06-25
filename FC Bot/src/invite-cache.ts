export class InviteCache {
  private readonly entries = new Map<string, number>();
  private lastPruneTime = 0;
  private readonly pruneIntervalMs = 60000;

  constructor(private readonly cooldownMs: number) {}

    claim(key: string): boolean {
    const now = Date.now();
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

    clear(): void {
    this.entries.clear();
    this.lastPruneTime = 0;
  }

    size(): number {
    return this.entries.size;
  }

    private prune(now: number): void {
    for (const [key, expiresAt] of this.entries) {
      if (expiresAt <= now) {
        this.entries.delete(key);
      }
    }
  }
}
