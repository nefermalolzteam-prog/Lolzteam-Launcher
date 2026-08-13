import { describe, expect, it } from 'vitest';
import { describeFailure, isNetworkFailure } from '../failure';

/** An errno error the way Node builds one. */
const errno = (code: string, message = 'boom'): Error =>
  Object.assign(new Error(message), { code });

describe('isNetworkFailure', () => {
  it('recognises what the platform calls a dead link', () => {
    for (const code of ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_SOCKET']) {
      expect(isNetworkFailure(errno(code)), code).toBe(true);
    }
  });

  it('recognises the classes that carry no code', () => {
    const timeout = new Error('timed out');
    timeout.name = 'MtTimeoutError';
    expect(isNetworkFailure(timeout)).toBe(true);
  });

  // `fetch` flattens everything it touches into `TypeError: fetch failed` and hides the errno underneath.
  it('looks under a wrapper for the real reason', () => {
    const wrapped = Object.assign(new TypeError('fetch failed'), {
      cause: errno('ECONNREFUSED'),
    });
    expect(isNetworkFailure(wrapped)).toBe(true);
  });

  it('does not loop on an error that is its own cause', () => {
    const self = new Error('round and round') as Error & { cause?: unknown };
    self.cause = self;
    expect(isNetworkFailure(self)).toBe(false);
  });

  // The two-node version of the same trap, which a self-check alone walks straight into.
  it('does not loop on a pair of errors that cause each other', () => {
    const a = new Error('a') as Error & { cause?: unknown };
    const b = new Error('b') as Error & { cause?: unknown };
    a.cause = b;
    b.cause = a;
    expect(isNetworkFailure(a)).toBe(false);
  });

  it('reads a proxy stack that only left a sentence', () => {
    expect(isNetworkFailure(new Error('socket hang up'))).toBe(true);
    expect(isNetworkFailure(new Error('Proxy connection timed out'))).toBe(true);
    expect(isNetworkFailure(new Error('tunneling socket could not be established'))).toBe(true);
  });

  // The half that matters: our own mistakes must not wear the network's name.
  it('leaves our own failures where they belong', () => {
    expect(isNetworkFailure(new TypeError('Cannot read properties of undefined'))).toBe(false);
    expect(isNetworkFailure(errno('ENOENT', 'no such file or directory'))).toBe(false);
    expect(isNetworkFailure(new Error('account is not linked'))).toBe(false);
    expect(isNetworkFailure('строка')).toBe(false);
    expect(isNetworkFailure(null)).toBe(false);
    expect(isNetworkFailure(undefined)).toBe(false);
  });
});

describe('describeFailure', () => {
  it('carries the message so the row has something to show', () => {
    expect(describeFailure(errno('ECONNRESET', 'read ECONNRESET'))).toEqual({
      error: 'network',
      detail: 'read ECONNRESET',
    });
    expect(describeFailure(new TypeError('x is not a function'))).toEqual({
      error: 'unknown',
      detail: 'x is not a function',
    });
  });

  it('says something about a thrown value that is not an error at all', () => {
    expect(describeFailure({ weird: true })).toEqual({
      error: 'unknown',
      detail: '[object Object]',
    });
  });
});
