#!/usr/bin/env node
import { createLogger } from './logger';
import { createTabletopServer, TabletopServer } from './server';
import { FileStorage } from './storage/file';
import { MemoryStorage } from './storage/memory';
import { PostgresStorage } from './storage/postgres';
import { SqliteStorage } from './storage/sqlite';
import { RoomStorage } from './types';

// Builds a server from environment variables (see .env.example). Does not start it.
export async function startFromEnv(env = process.env): Promise<TabletopServer> {
  const logger = createLogger(env.LOG_LEVEL || 'info');
  const kind = env.STORAGE || 'file';
  const dataDir = env.DATA_DIR || './data';

  let storage: RoomStorage;
  if (kind === 'memory') {
    storage = new MemoryStorage();
  } else if (kind === 'file') {
    storage = new FileStorage(dataDir);
  } else if (kind === 'sqlite') {
    storage = new SqliteStorage(dataDir + '/rooms.sqlite');
  } else if (kind === 'postgres') {
    if (!env.DATABASE_URL) throw new Error('STORAGE=postgres needs DATABASE_URL');
    // Loaded only when needed, so file/sqlite users never touch the pg driver.
    const { Pool } = await import('pg');
    const pg = new PostgresStorage(new Pool({ connectionString: env.DATABASE_URL }));
    await pg.init(); // fail at startup, not on the first join
    storage = pg;
  } else {
    throw new Error(`unknown STORAGE "${kind}" (use file, sqlite, postgres or memory)`);
  }

  const debounce = env.SAVE_DEBOUNCE_MS === undefined ? 3000 : Number(env.SAVE_DEBOUNCE_MS);
  if (!Number.isFinite(debounce) || debounce < 0) throw new Error('SAVE_DEBOUNCE_MS must be >= 0');
  const port = env.PORT === undefined ? 3000 : Number(env.PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('PORT is invalid');

  return createTabletopServer({ storage, saveDebounceMs: debounce, port, logger });
}

async function main(): Promise<void> {
  const logger = createLogger(process.env.LOG_LEVEL || 'info');
  const server = await startFromEnv();
  await server.start();

  let shuttingDown = false;
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutting down', { signal });
    // If a save hangs, don't hang forever.
    setTimeout(() => {
      logger.error('shutdown timed out');
      process.exit(1);
    }, 10000).unref();
    try {
      await server.stop();
      process.exit(0);
    } catch (err) {
      logger.error('shutdown failed', { error: err.message });
      process.exit(1);
    }
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(
      JSON.stringify({ level: 'error', msg: 'startup failed', error: err.message }) + '\n',
    );
    process.exit(1);
  });
}
