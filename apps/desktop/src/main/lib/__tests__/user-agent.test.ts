import { describe, expect, it } from 'vitest';
import { buildBrowserUserAgent } from '../user-agent';

describe('buildBrowserUserAgent', () => {
  it('is the exact string a reduced Chrome sends on Windows', () => {
    expect(buildBrowserUserAgent('130.0.6723.191', 'win32')).toBe(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    );
  });

  it('drops the tokens that gave the app away', () => {
    // The report that started this — what `navigator.userAgent` actually read.
    const ua = buildBrowserUserAgent('130.0.6723.191', 'win32');
    expect(ua).not.toMatch(/Electron/i);
    expect(ua).not.toMatch(/lolzteam/i);
    // The build number is a tell of its own: no current Chrome reports one.
    expect(ua).not.toContain('6723');
  });

  it('follows the engine instead of a hard-coded number', () => {
    expect(buildBrowserUserAgent('142.0.7444.60', 'win32')).toContain('Chrome/142.0.0.0');
  });

  it('freezes the OS the way Chrome freezes it', () => {
    // Deliberately wrong about the machine: Chrome says 10_15_7 on Apple Silicon and NT 10.0 on Windows 11.
    expect(buildBrowserUserAgent('130.0.6723.191', 'darwin')).toContain(
      '(Macintosh; Intel Mac OS X 10_15_7)',
    );
    expect(buildBrowserUserAgent('130.0.6723.191', 'linux')).toContain('(X11; Linux x86_64)');
  });

  it('falls back to Windows on a platform the app does not ship for', () => {
    expect(buildBrowserUserAgent('130.0.6723.191', 'freebsd')).toContain(
      '(Windows NT 10.0; Win64; x64)',
    );
  });

  it('still yields a well-formed string if the engine version is unreadable', () => {
    // Never `Chrome/undefined.0.0.0`: a malformed user agent is worse than a slightly stale one.
    expect(buildBrowserUserAgent('', 'win32')).toMatch(/ Chrome\/\d+\.0\.0\.0 Safari\/537\.36$/);
    expect(buildBrowserUserAgent('nonsense', 'win32')).toMatch(
      / Chrome\/\d+\.0\.0\.0 Safari\/537\.36$/,
    );
  });
});
