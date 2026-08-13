import { isProxyHost } from '@shared-types';
import { describe, expect, it } from 'vitest';
import { parseProxyLine } from '../proxy';

describe('parseProxyLine', () => {
  it('reads host:port', () => {
    expect(parseProxyLine('1.2.3.4:8080')).toEqual({
      protocol: 'http',
      host: '1.2.3.4',
      port: 8080,
    });
  });

  it('reads host:port:user:pass and keeps colons in the password', () => {
    expect(parseProxyLine('proxy.example.com:3128:bob:p:a:ss')).toEqual({
      protocol: 'http',
      host: 'proxy.example.com',
      port: 3128,
      username: 'bob',
      password: 'p:a:ss',
    });
  });

  it('takes the scheme off the front', () => {
    expect(parseProxyLine('https://1.2.3.4:443')?.protocol).toBe('https');
    expect(parseProxyLine('socks5://1.2.3.4:1080')?.host).toBe('1.2.3.4');
  });

  // The line that produced `getaddrinfo ENOTFOUND 11` on every connection: an address typed with colons instead of dots.
  it('refuses a line whose host is not a host', () => {
    expect(parseProxyLine('11:22:33:44')).toBeNull();
    expect(parseProxyLine('11:8080')).toBeNull();
    expect(parseProxyLine('1.2.3:8080')).toBeNull();
  });

  it('refuses a line without a usable port', () => {
    expect(parseProxyLine('1.2.3.4')).toBeNull();
    expect(parseProxyLine('1.2.3.4:0')).toBeNull();
    expect(parseProxyLine('1.2.3.4:70000')).toBeNull();
    expect(parseProxyLine('')).toBeNull();
  });
});

describe('isProxyHost', () => {
  it('accepts addresses and names', () => {
    expect(isProxyHost('127.0.0.1')).toBe(true);
    expect(isProxyHost('255.255.255.255')).toBe(true);
    expect(isProxyHost('gate.smartproxy.net')).toBe(true);
    expect(isProxyHost('localhost')).toBe(true);
  });

  it('rejects bare numbers, half-written addresses and junk', () => {
    expect(isProxyHost('11')).toBe(false);
    expect(isProxyHost('1.2.3')).toBe(false);
    expect(isProxyHost('256.1.1.1')).toBe(false);
    expect(isProxyHost('has space.com')).toBe(false);
    expect(isProxyHost('')).toBe(false);
  });
});
