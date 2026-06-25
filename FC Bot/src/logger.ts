import type { LogLevel } from './config';

const weights: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export type LogFields = Record<string, string | number | boolean | null | undefined>;

export class Logger {
  constructor(private readonly level: LogLevel) {}

  debug(message: string, fields: LogFields = {}): void {
    this.write('debug', message, fields);
  }

  info(message: string, fields: LogFields = {}): void {
    this.write('info', message, fields);
  }

  warn(message: string, fields: LogFields = {}): void {
    this.write('warn', message, fields);
  }

  error(message: string, fields: LogFields = {}): void {
    this.write('error', message, fields);
  }

  private write(level: LogLevel, message: string, fields: LogFields): void {
    if (weights[level] < weights[this.level]) {
      return;
    }

    const record = {
      time: new Date().toISOString(),
      level,
      message,
      ...sanitizeFields(fields),
    };

    const line = JSON.stringify(record);
    if (level === 'error') {
      console.error(line);
      return;
    }

    console.log(line);
  }
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
const SENSITIVE_FIELD_PATTERN = /token|secret|password|cookie|auth|key|credential|bearer|api[_-]?key|access[_-]?token|refresh[_-]?token|private[_-]?key|session[_-]?id/i;

function sanitizeFields(fields: LogFields): LogFields {
  const sanitized: LogFields = {};

  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) {
      continue;
    }

    if (SENSITIVE_FIELD_PATTERN.test(key)) {
      sanitized[key] = '[redacted]';
      continue;
    }

    sanitized[key] = value;
  }

  return sanitized;
}
