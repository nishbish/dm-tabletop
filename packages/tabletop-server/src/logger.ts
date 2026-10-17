import { Logger } from './types';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 };

// JSON lines on stdout/stderr. Callers must never pass tokens or message payloads in `fields`.
export function createLogger(level = 'info'): Logger {
  const min = LEVELS[level] || LEVELS.info;
  function log(name: string, message: string, fields?: object) {
    if (LEVELS[name] < min) return;
    const line = JSON.stringify({
      time: new Date().toISOString(),
      level: name,
      msg: message,
      ...fields,
    });
    (name === 'error' ? process.stderr : process.stdout).write(line + '\n');
  }
  return {
    debug: (m, f) => log('debug', m, f),
    info: (m, f) => log('info', m, f),
    warn: (m, f) => log('warn', m, f),
    error: (m, f) => log('error', m, f),
  };
}
