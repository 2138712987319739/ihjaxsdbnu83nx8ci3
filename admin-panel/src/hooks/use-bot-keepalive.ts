// Website or admin panel made by Clovic.
'use client';

import { useEffect } from 'react';
import { queueBotAction } from '@/lib/actions';

const PANEL_KEEPALIVE_INTERVAL_MS = 4 * 60 * 1000;
const KEEPALIVE_STORAGE_KEY = 'friendconnect:last-keepalive';

export function useBotKeepalive(enabled: boolean) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    let cancelled = false;

    async function queueKeepalive() {
      const now = Date.now();
      if (!shouldQueueKeepalive(now)) {
        return;
      }

      writeLastKeepalive(now);

      try {
        await queueBotAction('keepalive', {
          source: 'admin_panel',
          requestedAt: new Date(now).toISOString(),
          intervalMs: PANEL_KEEPALIVE_INTERVAL_MS,
        });
      } catch (error) {
        if (!cancelled) {
          console.warn('FriendConnect keepalive could not be queued', getErrorMessage(error));
        }
      }
    }

    void queueKeepalive();
    const timer = window.setInterval(() => void queueKeepalive(), PANEL_KEEPALIVE_INTERVAL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled]);
}

function shouldQueueKeepalive(now: number): boolean {
  const lastKeepalive = readLastKeepalive();
  return now - lastKeepalive >= PANEL_KEEPALIVE_INTERVAL_MS - 5000;
}

function readLastKeepalive(): number {
  try {
    const value = Number(localStorage.getItem(KEEPALIVE_STORAGE_KEY));
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function writeLastKeepalive(value: number): void {
  try {
    localStorage.setItem(KEEPALIVE_STORAGE_KEY, String(value));
  } catch {
    // The bot has its own keepalive. Browser storage only prevents duplicate panel pings.
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
