// S3-6: minimal structured JSON logger (no external dep). One line per event to stdout:
//   {"ts":"2026-...","level":"info","msg":"server.start","port":8787}
// Keep it small; production can still redirect stdout and pipe to journald/loki as JSON.

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  [k: string]: unknown;
}

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let threshold = LEVELS.info;
const envLevel = (process.env.LOG_LEVEL ?? "").toLowerCase();
if (envLevel in LEVELS) threshold = LEVELS[envLevel as LogLevel];

function write(level: LogLevel, msg: string, fields?: LogFields): void {
  if (LEVELS[level] < threshold) return;
  const entry: LogFields = {
    ts: new Date().toISOString(),
    level,
    msg,
  };
  if (fields) for (const [k, v] of Object.entries(fields)) entry[k] = v;
  try {
    process.stdout.write(JSON.stringify(entry) + "\n");
  } catch {
    // stdout can throw if the process is mid-shutdown; swallow rather than mask the real error.
  }
}

export const log = {
  debug: (msg: string, fields?: LogFields) => write("debug", msg, fields),
  info: (msg: string, fields?: LogFields) => write("info", msg, fields),
  warn: (msg: string, fields?: LogFields) => write("warn", msg, fields),
  error: (msg: string, fields?: LogFields) => write("error", msg, fields),
};
