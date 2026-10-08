import chalk from "chalk";

export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
}

type LogListener = (entry: LogEntry) => void;
const listeners = new Set<LogListener>();

export function subscribeLogs(listener: LogListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const COLORS: Record<LogLevel, (s: string) => string> = {
  DEBUG: chalk.gray,
  INFO: chalk.blue,
  WARN: chalk.yellow,
  ERROR: chalk.red,
};

function timestamp(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

function log(level: LogLevel, module: string, message: string, ...args: unknown[]) {
  const time = timestamp();
  const color = COLORS[level];
  const prefix = `${chalk.dim(time)} ${color(`[${level}]`)} ${chalk.cyan(`[${module}]`)}`;
  console.log(`${prefix} ${message}`, ...args);

  const entry: LogEntry = { timestamp: time, level, module, message };
  for (const listener of listeners) {
    try {
      listener(entry);
    } catch {
      // ignore listener errors
    }
  }
}

export function createLogger(module: string) {
  return {
    debug: (msg: string, ...args: unknown[]) => log("DEBUG", module, msg, ...args),
    info: (msg: string, ...args: unknown[]) => log("INFO", module, msg, ...args),
    warn: (msg: string, ...args: unknown[]) => log("WARN", module, msg, ...args),
    error: (msg: string, ...args: unknown[]) => log("ERROR", module, msg, ...args),
  };
}
