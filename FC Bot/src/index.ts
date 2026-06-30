import { FriendConnectService } from './service';
import { AdminBridge } from './admin/bridge';
import { loadConfig, loadEnvFile } from './config';
import { getErrorMessage, Logger } from './logger';
import { SHUTDOWN_TIMEOUT_MS } from './constants';

loadEnvFile();

const config = loadConfig();
const logger = new Logger(config.logLevel);
const service = new FriendConnectService(config, logger);
const adminBridge = config.admin.enabled ? new AdminBridge(config.admin, service, logger) : null;

if (adminBridge) {
  service.setEventSink(adminBridge);
}

let stopping = false;
let unhandledRejectionCount = 0;
const MAX_UNHANDLED_REJECTIONS = 10;

async function main(): Promise<void> {
  await service.start();
  adminBridge?.start();
  logger.info('Friend connect service is ready');
}
async function shutdown(signal: string): Promise<void> {
  if (stopping) {
    return;
  }

  stopping = true;
  logger.info('Shutdown requested', { signal });
  const forceExitTimer = setTimeout(() => {
    logger.error('Shutdown timeout exceeded, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  try {
    adminBridge?.stop();
    await service.stop();
    clearTimeout(forceExitTimer);
  } catch (error) {
    logger.error('Error during shutdown', { error: getErrorMessage(error) });
    clearTimeout(forceExitTimer);
    throw error;
  }
}

process.on('SIGINT', () => {
  void shutdown('SIGINT').finally(() => process.exit(0));
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM').finally(() => process.exit(0));
});
process.on('unhandledRejection', (reason: unknown) => {
  if (service.handleRuntimeRejection(reason)) {
    logger.warn('Recovered stale Xbox session rejection', {
      error: getErrorMessage(reason),
    });
    return;
  }

  unhandledRejectionCount++;
  logger.error('Unhandled promise rejection', {
    error: getErrorMessage(reason),
    count: unhandledRejectionCount,
  });

  if (unhandledRejectionCount >= MAX_UNHANDLED_REJECTIONS) {
    logger.error('Too many unhandled rejections, initiating shutdown');
    void shutdown('unhandledRejection').finally(() => process.exit(1));
  }
  setTimeout(() => {
    if (unhandledRejectionCount > 0) {
      unhandledRejectionCount--;
    }
  }, 60000);
});

process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught exception', { error: getErrorMessage(error) });
  void shutdown('uncaughtException').finally(() => process.exit(1));
});

void main().catch((error: unknown) => {
  logger.error('Startup failed', { error: getErrorMessage(error) });
  process.exit(1);
});
