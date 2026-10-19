/**
 * Test helpers.
 */

import { createLogger, type Logger, type LoggerOptions } from './logger';

export interface MemoryLogSink {
  lines: Record<string, unknown>[];
  raw: string[];
  logger: Logger;
}

export function createMemoryLogger(options: Omit<LoggerOptions, 'sink'>): MemoryLogSink {
  const lines: Record<string, unknown>[] = [];
  const raw: string[] = [];
  const logger = createLogger({
    ...options,
    sink: (line, record) => {
      raw.push(line);
      lines.push(record);
    },
  });
  return { lines, raw, logger };
}

export function findLog(
  sink: MemoryLogSink,
  predicate: (record: Record<string, unknown>) => boolean,
): Record<string, unknown> | undefined {
  return sink.lines.find(predicate);
}

export { createLogger };
