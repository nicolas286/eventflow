import type {
  ConsoleLoggerOptions,
  EdgeLogger,
  LogData,
  LogLevel,
} from "./types.ts";

export function createEdgeLogger(
  scope: string,
  requestId = crypto.randomUUID(),
): EdgeLogger {
  return createConsoleLogger(scope, { requestId });
}

export function createConsoleLogger(
  scope: string,
  options: ConsoleLoggerOptions = {},
): EdgeLogger {
  const requestId = options.requestId ?? crypto.randomUUID();

  function write(level: LogLevel, step: string, data: LogData = {}): void {
    const safeData = options.redact ? options.redact(data) : data;

    console[level](`[${scope}]`, {
      ...safeData,
      requestId,
      step,
    });
  }

  return {
    requestId,
    info: (step, data) => write("log", step, data),
    warn: (step, data) => write("warn", step, data),
    error: (step, data) => write("error", step, data),
  };
}
