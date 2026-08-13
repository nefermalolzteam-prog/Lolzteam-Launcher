import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  confirmationHash,
  confirmationParams,
  parseConfirmationList,
  parseConfirmationOp,
} from '../mobileconf';

/** Any valid base64; the value only has to be stable, not real. */
const SECRET = 'MTIzNDU2Nzg5MGFiY2RlZg==';

describe('confirmationHash', () => {
  it('matches a hash computed the long way', () => {
    const time = 1_700_000_000;
    const message = Buffer.alloc(8 + 4);
    message.writeBigUInt64BE(BigInt(time), 0);
    Buffer.from('list', 'utf8').copy(message, 8);
    const expected = createHmac('sha1', Buffer.from(SECRET, 'base64'))
      .update(message)
      .digest('base64');

    expect(confirmationHash(SECRET, time, 'list')).toBe(expected);
  });

  it('uses raw seconds, not 30-second buckets', () => {
    // The TOTP mistake: if the time were divided by 30, these two would collide.
    expect(confirmationHash(SECRET, 1_700_000_000, 'list')).not.toBe(
      confirmationHash(SECRET, 1_700_000_001, 'list'),
    );
  });

  it('folds the tag into the same message', () => {
    expect(confirmationHash(SECRET, 1_700_000_000, 'allow')).not.toBe(
      confirmationHash(SECRET, 1_700_000_000, 'cancel'),
    );
  });

  it('truncates the tag at 32 bytes, as Steam does', () => {
    const time = 1_700_000_000;
    const long = 'x'.repeat(40);
    expect(confirmationHash(SECRET, time, long)).toBe(
      confirmationHash(SECRET, time, 'x'.repeat(32)),
    );
  });

  it('ignores a fractional clock', () => {
    expect(confirmationHash(SECRET, 1_700_000_000.9, 'list')).toBe(
      confirmationHash(SECRET, 1_700_000_000, 'list'),
    );
  });
});

describe('confirmationParams', () => {
  it('sends every field Steam looks for, including m=react', () => {
    const params = confirmationParams({
      identitySecret: SECRET,
      steamId: '76561198012345678',
      deviceId: 'android:11111111-2222-3333-4444-555555555555',
      time: 1_700_000_000,
      tag: 'list',
    });

    expect(params.get('p')).toBe('android:11111111-2222-3333-4444-555555555555');
    expect(params.get('a')).toBe('76561198012345678');
    expect(params.get('t')).toBe('1700000000');
    expect(params.get('m')).toBe('react');
    expect(params.get('tag')).toBe('list');
    expect(params.get('k')).toBe(confirmationHash(SECRET, 1_700_000_000, 'list'));
  });
});

describe('parseConfirmationList', () => {
  it('keeps 64-bit ids as the strings Steam sent', () => {
    // Both of these lose their last digits through Number.
    const body = JSON.stringify({
      success: true,
      conf: [
        {
          id: '15138595942',
          nonce: '9223372036854775807',
          creator_id: '7656119811223344556',
          type: 2,
          type_name: 'Trade Offer',
          headline: 'SomeBuyer',
          summary: ['You will give up 1 item'],
          icon: 'https://avatars.example/1.jpg',
          creation_time: 1_700_000_000,
        },
      ],
    });

    const result = parseConfirmationList(body);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [conf] = result.confirmations;
    expect(conf?.id).toBe('15138595942');
    expect(conf?.nonce).toBe('9223372036854775807');
    expect(conf?.creatorId).toBe('7656119811223344556');
    expect(conf?.type).toBe(2);
    expect(conf?.summary).toEqual(['You will give up 1 item']);
    expect(conf?.warning).toBeNull();
  });

  it('accepts numeric ids without rounding them', () => {
    // Steam has been seen sending these unquoted; stringify before anything else touches them or the value is already wrong.
    const body = '{"success":true,"conf":[{"id":15138595942,"nonce":123,"type":3}]}';
    const result = parseConfirmationList(body);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.confirmations[0]?.id).toBe('15138595942');
    expect(result.confirmations[0]?.nonce).toBe('123');
  });

  it('reads an empty list as an empty list, not a failure', () => {
    const result = parseConfirmationList('{"success":true,"conf":[]}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.confirmations).toEqual([]);
  });

  it('drops entries with no usable id or nonce', () => {
    const body = JSON.stringify({
      success: true,
      conf: [{ id: '1', nonce: '2' }, { id: '3' }, { nonce: '4' }, null, 'nope'],
    });
    const result = parseConfirmationList(body);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.confirmations).toHaveLength(1);
  });

  it('flags needauth so the caller re-mints cookies', () => {
    const result = parseConfirmationList('{"success":false,"needauth":true}');
    expect(result).toEqual({ ok: false, needAuth: true, message: null });
  });

  it('treats an HTML login page as a dead session', () => {
    const result = parseConfirmationList('<!DOCTYPE html><html>Sign In</html>');
    expect(result).toEqual({ ok: false, needAuth: true, message: null });
  });

  it("passes Steam's own refusal through without calling it an auth problem", () => {
    const result = parseConfirmationList('{"success":false,"message":"Oh nooooooes!"}');
    expect(result).toEqual({ ok: false, needAuth: false, message: 'Oh nooooooes!' });
  });
});

describe('parseConfirmationOp', () => {
  it('accepts success', () => {
    expect(parseConfirmationOp('{"success":true}')).toEqual({ ok: true });
  });

  it('separates a dead session from a refusal', () => {
    expect(parseConfirmationOp('{"success":false,"needauth":true}')).toEqual({
      ok: false,
      needAuth: true,
      message: null,
    });
    expect(parseConfirmationOp('{"success":false,"message":"nope"}')).toEqual({
      ok: false,
      needAuth: false,
      message: 'nope',
    });
  });

  it('treats an unparseable body as a dead session', () => {
    expect(parseConfirmationOp('<html>login</html>')).toEqual({
      ok: false,
      needAuth: true,
      message: null,
    });
  });
});
