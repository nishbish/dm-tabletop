/* eslint-disable @typescript-eslint/no-explicit-any -- test helpers deal in loose JSON */
// Helpers for tests only: a tiny websocket client that records every message it receives.
import { WebSocket } from 'ws';
import { createTabletopServer, TabletopServerOptions } from './server';
import { createLogger } from './logger';

export class TestClient {
  messages: any[] = [];
  closeCode: number | null = null;
  private waiters: Array<() => void> = [];

  constructor(public socket: WebSocket) {
    socket.on('message', (data) => {
      this.messages.push(JSON.parse(data.toString()));
      this.waiters.forEach((w) => w());
    });
    socket.on('close', (code) => {
      this.closeCode = code;
      this.waiters.forEach((w) => w());
    });
  }

  static connect(port: number): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/anything`);
      const client = new TestClient(ws);
      ws.once('open', () => resolve(client));
      ws.once('error', reject);
    });
  }

  send(message: object): void {
    this.socket.send(JSON.stringify(message));
  }

  // Resolves with the first not-yet-consumed message matching the predicate.
  async next(match: (m: any) => boolean, timeoutMs = 2000): Promise<any> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const index = this.messages.findIndex(match);
      if (index !== -1) return this.messages.splice(index, 1)[0];
      if (Date.now() > deadline) {
        throw new Error('timed out waiting for message; have ' + JSON.stringify(this.messages));
      }
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 50);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  nextType(type: string): Promise<any> {
    return this.next((m) => m.type === type);
  }

  nextUpdate(name: string): Promise<any> {
    return this.next((m) => m.type === 'update' && m.name === name);
  }

  async waitForClose(timeoutMs = 2000): Promise<number> {
    const deadline = Date.now() + timeoutMs;
    while (this.closeCode === null) {
      if (Date.now() > deadline) throw new Error('socket did not close');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return this.closeCode;
  }

  // Connect + join, resolving with the client and its `joined` message.
  static async join(port: number, token: string, roomId: string) {
    const client = await TestClient.connect(port);
    client.send({ type: 'join', token, roomId });
    const joined = await client.nextType('joined');
    return { client, joined };
  }

  close(): void {
    this.socket.close();
  }
}

export async function startTestServer(options: TabletopServerOptions) {
  const server = createTabletopServer({
    saveDebounceMs: 50,
    logger: createLogger('silent'),
    ...options,
  });
  const port = await server.start();
  return { server, port };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
