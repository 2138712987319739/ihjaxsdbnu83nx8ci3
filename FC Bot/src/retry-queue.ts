import type { Logger } from './logger';
import { getErrorMessage } from './logger';

type RetryConfig = {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
};

type QueuedItem<T> = {
  id: string;
  data: T;
  attempts: number;
  nextRetryAt: number;
};

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

    enqueue(id: string, data: T): void {
    if (this.queue.has(id)) {
      return;
    }

    this.queue.set(id, {
      id,
      data,
      attempts: 0,
      nextRetryAt: Date.now(),
    });

    this.logger.debug('Item added to retry queue', { id, queueSize: this.queue.size });
  }

    dequeue(id: string): boolean {
    return this.queue.delete(id);
  }

    start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.timer = setInterval(() => void this.processQueue(), this.checkIntervalMs);
    this.logger.info(`${this.queueName} started`);
  }

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

    size(): number {
    return this.queue.size;
  }

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
