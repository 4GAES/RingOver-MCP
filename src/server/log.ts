// Log en una línea JSON por evento: fácil de leer con pm2 logs y de filtrar con jq.
type Level = "debug" | "info" | "warn" | "error";

const quiet = process.env.NODE_ENV === "test";

function write(level: Level, msg: string, extra?: Record<string, unknown>) {
  if (quiet && level !== "error") return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...extra });
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
}

export const log = {
  debug: (msg: string, extra?: Record<string, unknown>) => write("debug", msg, extra),
  info: (msg: string, extra?: Record<string, unknown>) => write("info", msg, extra),
  warn: (msg: string, extra?: Record<string, unknown>) => write("warn", msg, extra),
  error: (msg: string, extra?: Record<string, unknown>) => write("error", msg, extra),
};

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
