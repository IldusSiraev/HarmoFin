const MAX_TRACKED_CHATS = 10_000;

/**
 * Fixed-window counter per chat, in process memory like AuthRateLimitGuard: production runs one
 * API instance. Updates over the limit are dropped without a reply.
 */
export class ChatRateLimiter {
  private readonly windows = new Map<bigint, { count: number; resetAt: number }>();

  constructor(
    private readonly max = 30,
    private readonly windowMs = 60_000,
  ) {}

  allow(chatId: bigint, now: number): boolean {
    const current = this.windows.get(chatId);
    if (!current || current.resetAt <= now) {
      if (this.windows.size >= MAX_TRACKED_CHATS) this.prune(now);
      this.windows.set(chatId, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    current.count += 1;
    return current.count <= this.max;
  }

  private prune(now: number): void {
    for (const [chatId, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(chatId);
    }
  }
}
