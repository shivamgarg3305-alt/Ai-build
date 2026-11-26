export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogLevelSetting = LogLevel | 'silent';
export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  child(bindings: LogFields): Logger;
}

const RANK: Record<LogLevelSetting, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };
const SENSITIVE_KEY = /pass(word)?|secret|token|authorization|cookie|api[-_]?key|hash/i;

/** Replaces values of sensitive-looking keys and flattens Errors so they serialise. */
export function redact(value: unknown, depth = 0): unknown {
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (value === null || typeof value !== 'object') return value;
  if (depth >= 6) return '[truncated]';
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY.test(key) ? '[redacted]' : redact(item, depth + 1);
  }
  return out;
}

const bigintReplacer = (_key: string, value: unknown) => (typeof value === 'bigint' ? value.toString() : value);

function defaultSink(line: string, level: LogLevel): void {
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export interface LoggerOptions {
  level: LogLevelSetting;
  bindings?: LogFields;
  sink?: (line: string, level: LogLevel) => void;
}

/** Structured JSON-lines logger. Works unchanged on Node and Cloudflare Workers. */
export function createLogger(options: LoggerOptions): Logger {
  const { level, bindings = {}, sink = defaultSink } = options;
  const write = (lvl: LogLevel, msg: string, fields?: LogFields) => {
    if (RANK[lvl] < RANK[level]) return;
    const safe = redact({ ...bindings, ...fields }) as Record<string, unknown>;
    sink(JSON.stringify({ ...safe, time: new Date().toISOString(), level: lvl, msg }, bigintReplacer), lvl);
  };
  return {
    debug: (m, f) => write('debug', m, f),
    info: (m, f) => write('info', m, f),
    warn: (m, f) => write('warn', m, f),
    error: (m, f) => write('error', m, f),
    child: (extra) => createLogger({ level, bindings: { ...bindings, ...extra }, sink }),
  };
}
