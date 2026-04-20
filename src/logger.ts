/**
 * Logger that writes to stderr only.
 * NEVER use console.log in an MCP stdio server — it corrupts the JSON-RPC transport.
 */

const LOG_LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
} as const;

type LogLevel = keyof typeof LOG_LEVELS;

const currentLevel: LogLevel = (process.env.MEM_LOG_LEVEL as LogLevel) ?? 'info';

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] <= LOG_LEVELS[currentLevel];
}

function log(level: LogLevel, message: string, ...args: unknown[]): void {
  if (!shouldLog(level)) return;
  const prefix = `[mem:${level}]`;
  const formatted =
    args.length > 0 ? `${prefix} ${message} ${JSON.stringify(args)}` : `${prefix} ${message}`;
  process.stderr.write(`${formatted}\n`);
}

export const logger = {
  error: (message: string, ...args: unknown[]) => log('error', message, ...args),
  warn: (message: string, ...args: unknown[]) => log('warn', message, ...args),
  info: (message: string, ...args: unknown[]) => log('info', message, ...args),
  debug: (message: string, ...args: unknown[]) => log('debug', message, ...args),
};
