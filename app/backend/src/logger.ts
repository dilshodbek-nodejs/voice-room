// Minimal structured logger (JSON lines). Swap for pino/winston without touching call sites.
type Fields = Record<string, unknown>;

function line(level: string, msg: string, fields: Fields = {}): void {
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ t: new Date().toISOString(), level, msg, ...fields }));
}

export const logger = {
  info: (msg: string, fields: Fields = {}) => line('info', msg, fields),
  warn: (msg: string, fields: Fields = {}) => line('warn', msg, fields),
  error: (msg: string, fields: Fields = {}) => line('error', msg, fields),
};
