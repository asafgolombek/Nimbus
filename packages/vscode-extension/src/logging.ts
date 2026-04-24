import type { LogLevel } from "./settings.js";
import type { OutputChannelHandle } from "./vscode-shim.js";

const ORDER: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

export interface Logger {
  error(msg: string): void;
  warn(msg: string): void;
  info(msg: string): void;
  debug(msg: string): void;
}

export function createLogger(channel: OutputChannelHandle, getLevel: () => LogLevel): Logger {
  const emit = (level: LogLevel, msg: string): void => {
    if (ORDER[level] > ORDER[getLevel()]) return;
    const ts = new Date().toISOString();
    channel.appendLine(`${ts} [${level}] ${msg}`);
  };
  return {
    error: (m) => emit("error", m),
    warn: (m) => emit("warn", m),
    info: (m) => emit("info", m),
    debug: (m) => emit("debug", m),
  };
}
