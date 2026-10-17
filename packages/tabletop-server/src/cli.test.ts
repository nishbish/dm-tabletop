import { afterEach, describe, expect, it } from 'vitest';
import { startFromEnv } from './cli';
import { TabletopServer } from './server';

let server: TabletopServer;
afterEach(async () => {
  if (server) await server.stop();
});

describe('startFromEnv', () => {
  it('builds a working server from environment variables', async () => {
    server = await startFromEnv({ STORAGE: 'memory', PORT: '0', LOG_LEVEL: 'silent' });
    const port = await server.start();
    const health = (await (await fetch(`http://127.0.0.1:${port}/health`)).json()) as {
      status: string;
      uptime: number;
    };
    expect(health.status).toBe('ok');
  });

  it('rejects bad configuration', async () => {
    await expect(startFromEnv({ STORAGE: 'carrier-pigeon' })).rejects.toThrow('STORAGE');
    await expect(startFromEnv({ STORAGE: 'postgres' })).rejects.toThrow('DATABASE_URL');
  });
});
