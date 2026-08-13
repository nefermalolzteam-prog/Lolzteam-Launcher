import { describe, expect, it, vi } from 'vitest';

vi.mock('electron-log/main', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const { createTelegramClient } = await import('../runtime');
const { transportFor } = await import('../transport');
const { LauncherTelegramPlatform } = await import('../platform');
const { buildOfflineSession } = await import('../../../adapters/telegram/session');

const AUTH_KEY_HEX = 'ab'.repeat(256);

describe('telegram runtime', () => {
  it('builds a client without loading better-sqlite3', () => {
    const client = createTelegramClient({
      session: buildOfflineSession({ authKeyHex: AUTH_KEY_HEX, dcId: 2, userId: 777 }),
    });
    // No connect() — reaching this line at all is the assertion.
    expect(client).toBeTruthy();
  });

  it('accepts the api pair from telegram_json when the item carries one', () => {
    const client = createTelegramClient({
      session: buildOfflineSession({ authKeyHex: AUTH_KEY_HEX, dcId: 1, userId: null }),
      apiId: 12345,
      apiHash: 'deadbeef',
      deviceModel: 'Desktop',
    });
    expect(client).toBeTruthy();
  });
});

describe('transportFor', () => {
  it('goes direct when no proxy is given', () => {
    expect(transportFor(null).constructor.name).toBe('TcpTransport');
    expect(transportFor(undefined).constructor.name).toBe('TcpTransport');
  });

  it('routes through CONNECT when a proxy is given', () => {
    const t = transportFor({ id: 'p1', host: '127.0.0.1', port: 8080 });
    expect(t.constructor.name).toBe('HttpProxyTcpTransport');
  });

  it('hands out a fresh packet codec per connection', () => {
    const dc = { id: 2, ipAddress: '149.154.167.50', port: 443, ipv6: false, testMode: false };
    const t = transportFor(null);
    expect(t.packetCodec(dc)).not.toBe(t.packetCodec(dc));
  });
});

describe('LauncherTelegramPlatform', () => {
  it('reports a device model and no default log level', () => {
    const platform = new LauncherTelegramPlatform();
    expect(platform.getDeviceModel()).toContain('Lolzteam Launcher');
    expect(platform.getDefaultLogLevel()).toBeNull();
  });

  it('returns a no-op unsubscribe from beforeExit', () => {
    const platform = new LauncherTelegramPlatform();
    expect(() => platform.beforeExit(() => {})()).not.toThrow();
  });
});
