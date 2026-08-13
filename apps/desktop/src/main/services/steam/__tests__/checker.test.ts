import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron-log/main', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const getGuardAccessToken = vi.fn();
const guardHttp = vi.fn();

vi.mock('../../steam-guard/session', () => ({
  getGuardAccessToken,
  // The real one reads the steamID64 out of the JWT; the id is not what any of these cases is about.
  getGuardSteamId: (record: { steamId: string }) => record.steamId,
}));

vi.mock('../../steam-guard/http', () => ({ guardHttp }));

const { checkSteamAccount, parseSteamProfileXml } = await import('../checker');

const RECORD = { steamId: '76561198012345678' } as never;

const ok = () => {
  getGuardAccessToken.mockResolvedValue({ ok: true, token: 'access', record: RECORD });
};

const page = (body: string, status = 200) => {
  guardHttp.mockResolvedValue({ status, body });
};

const FULL_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<profile>
  <steamID64>76561198012345678</steamID64>
  <steamID><![CDATA[Ivan & Co]]></steamID>
  <avatarMedium><![CDATA[https://avatars.steamstatic.com/abc_medium.jpg]]></avatarMedium>
  <vacBanned>0</vacBanned>
  <tradeBanState>None</tradeBanState>
  <isLimitedAccount>1</isLimitedAccount>
  <privacyState>public</privacyState>
  <memberSince>March 3, 2013</memberSince>
</profile>`;

/** What Steam serves for a profile nobody may look at: the name and the ban flags are still there. */
const PRIVATE_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<profile>
  <steamID64>76561198012345678</steamID64>
  <steamID><![CDATA[quiet]]></steamID>
  <privacyState>private</privacyState>
  <vacBanned>0</vacBanned>
  <tradeBanState>None</tradeBanState>
  <isLimitedAccount>0</isLimitedAccount>
</profile>`;

afterEach(() => {
  vi.clearAllMocks();
});

describe('parseSteamProfileXml', () => {
  it('reads every field, with the CDATA unwrapped', () => {
    const facts = parseSteamProfileXml(FULL_XML);
    expect(facts).toEqual({
      nickname: 'Ivan & Co',
      vacBanned: false,
      tradeBanState: 'None',
      limited: true,
      privacy: 'public',
      memberSince: 'March 3, 2013',
      avatarUrl: 'https://avatars.steamstatic.com/abc_medium.jpg',
    });
  });

  it('leaves a private profile null where the page said nothing', () => {
    // `memberSince` absent is the normal shape of a private profile, not a parse failure.
    const facts = parseSteamProfileXml(PRIVATE_XML);
    expect(facts.privacy).toBe('private');
    expect(facts.memberSince).toBeNull();
    expect(facts.nickname).toBe('quiet');
    expect(facts.vacBanned).toBe(false);
  });

  it('turns garbage into nulls rather than throwing', () => {
    // A login page, an error body or half a response all arrive here as text.
    expect(parseSteamProfileXml('<html><body>Steam is down</body></html>')).toEqual({
      nickname: null,
      vacBanned: null,
      tradeBanState: null,
      limited: null,
      privacy: null,
      memberSince: null,
      avatarUrl: null,
    });
  });

  it('reads a flag it does not understand as unknown', () => {
    // Only `1` and `0` mean anything here.
    expect(parseSteamProfileXml('<vacBanned>maybe</vacBanned>').vacBanned).toBeNull();
  });
});

describe('checkSteamAccount', () => {
  it('calls an account we never linked unlinked, not dead', async () => {
    // The whole point of the third status.
    getGuardAccessToken.mockResolvedValue({ ok: false, reason: 'not_linked' });

    const result = await checkSteamAccount(-1, null);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.info.status).toBe('unlinked');
    expect(result.info.steamId).toBeNull();
    expect(guardHttp).not.toHaveBeenCalled();
  });

  it('calls a refused refresh token dead, and names the reason the panel can translate', async () => {
    getGuardAccessToken.mockResolvedValue({
      ok: false,
      reason: 'session_expired',
      message: 'Refresh token was revoked',
    });

    const result = await checkSteamAccount(-1, null);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.info.status).toBe('dead');
    // `detail` is a key (`base.steam.detail.refused`), not prose.
    expect(result.info.detail).toBe('refused');
  });

  it('does not claim to know why a refusal it could not read happened', async () => {
    // Anything that is neither «не привязан», nor the network, nor an outright refusal: the session is not usable.
    getGuardAccessToken.mockResolvedValue({ ok: false, reason: 'no_credentials' });

    const result = await checkSteamAccount(-1, null);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.info.status).toBe('dead');
    expect(result.info.detail).toBe('unknown');
  });

  it('calls a successful refresh alive and fills in the profile', async () => {
    ok();
    page(FULL_XML);

    const result = await checkSteamAccount(-1, null);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.info.status).toBe('alive');
    expect(result.info.steamId).toBe('76561198012345678');
    expect(result.info.nickname).toBe('Ivan & Co');
    expect(result.info.limited).toBe(true);
  });

  it('keeps the verdict when the profile page cannot be reached', async () => {
    // The liveness answer is the one the user asked for and it is already in hand.
    ok();
    guardHttp.mockRejectedValue(new Error('ETIMEDOUT'));

    const result = await checkSteamAccount(-1, null);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.info.status).toBe('alive');
    expect(result.info.steamId).toBe('76561198012345678');
    expect(result.info.nickname).toBeNull();
  });

  it('keeps the verdict when the profile page answers with an error status', async () => {
    ok();
    page('<html>429</html>', 429);

    const result = await checkSteamAccount(-1, null);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.info.status).toBe('alive');
    expect(result.info.nickname).toBeNull();
  });

  it('takes the run’s proxy to the profile page', async () => {
    // The spread only works if this half honours it too: the token refresh and the page must leave by the same route.
    ok();
    page(FULL_XML);
    const proxy = { id: 'p1', host: '10.0.0.1' } as never;

    await checkSteamAccount(-1, proxy);

    expect(guardHttp).toHaveBeenCalledWith(expect.objectContaining({ proxy }));
  });

  it('refuses a bought account instead of judging it', async () => {
    // Positive ids belong to the market's own checker, which knows the order behind the account.
    const result = await checkSteamAccount(42, null);

    expect(result).toEqual({ ok: false, reason: 'market_account' });
    expect(getGuardAccessToken).not.toHaveBeenCalled();
  });
});
