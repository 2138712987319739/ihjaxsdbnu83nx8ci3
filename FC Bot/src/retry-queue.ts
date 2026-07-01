import type { Logger } from './logger';
import { getErrorMessage } from './logger';

/**
 * Retry configuration for failed operations
 */
type RetryConfig = {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
};

/**
 * A queued item waiting for retry
 */
type QueuedItem<T> = {
  id: string;
  data: T;
  attempts: number;
  nextRetryAt: number;
};

/**
 * Generic retry queue with exponential backoff
 * Useful for operations that may fail temporarily (network issues, rate limits, etc.)
 */
export class RetryQueue<T> {
  private readonly queue = new Map<string, QueuedItem<T>>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly config: RetryConfig,
    private readonly processor: (item: T) => Promise<void>,
    private readonly logger: Logger,
    private readonly queueName = 'Retry queue',
    private readonly checkIntervalMs = 5000,
  ) {}

  /**
   * Add an item to the retry queue
   */
  enqueue(id: string, data: T): void {
    if (this.queue.has(id)) {
      return; // Already queued
    }

    this.queue.set(id, {
      id,
      data,
      attempts: 0,
      nextRetryAt: Date.now(),
    });

    this.logger.debug('Item added to retry queue', { id, queueSize: this.queue.size });
  }

  /**
   * Remove an item from the queue (e.g., after manual success)
   */
  dequeue(id: string): boolean {
    return this.queue.delete(id);
  }

  /**
   * Start processing the queue
   */
  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.timer = setInterval(() => void this.processQueue(), this.checkIntervalMs);
    this.logger.info(`${this.queueName} started`);
  }

  /**
   * Stop processing the queue
   */
  stop(): void {
    const wasRunning = this.running || this.timer !== null;
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (wasRunning) {
      this.logger.info(`${this.queueName} stopped`, { remainingItems: this.queue.size });
    }
  }

  /**
   * Get current queue size
   */
  size(): number {
    return this.queue.size;
  }

  /**
   * Clear all items from the queue
   */
  clear(): void {
    this.queue.clear();
    this.logger.info('Retry queue cleared');
  }

  private async processQueue(): Promise<void> {
    if (!this.running) {
      return;
    }

    const now = Date.now();
    const itemsToProcess: QueuedItem<T>[] = [];

    for (const item of this.queue.values()) {
      if (item.nextRetryAt <= now) {
        itemsToProcess.push(item);
      }
    }

    for (const item of itemsToProcess) {
      await this.processItem(item);
    }
  }

  private async processItem(item: QueuedItem<T>): Promise<void> {
    item.attempts += 1;

    try {
      await this.processor(item.data);
      this.queue.delete(item.id);
      this.logger.info('Retry queue item processed successfully', {
        id: item.id,
        attempts: item.attempts,
      });
    } catch (error) {
      if (item.attempts >= this.config.maxRetries) {
        this.queue.delete(item.id);
        this.logger.error('Retry queue item failed permanently', {
          id: item.id,
          attempts: item.attempts,
          error: getErrorMessage(error),
        });
        return;
      }

      const delay = Math.min(
        this.config.initialDelayMs * Math.pow(this.config.backoffMultiplier, item.attempts - 1),
        this.config.maxDelayMs,
      );

      item.nextRetryAt = Date.now() + delay;
      this.logger.warn('Retry queue item failed, will retry', {
        id: item.id,
        attempts: item.attempts,
        nextRetryIn: delay,
        error: getErrorMessage(error),
      });
    }
  }
}

// Made with Bob
