export type LogLevel = "log" | "warn" | "error";
export type LogData = Record<string, unknown>;

export interface EdgeLogger {
  requestId: string;
  info(step: string, data?: LogData): void;
  warn(step: string, data?: LogData): void;
  error(step: string, data?: LogData): void;
}

export type RedactLogData = (data: LogData) => LogData;

export interface ConsoleLoggerOptions {
  requestId?: string;
  redact?: RedactLogData;
}
