export interface SteamTokenClaims {
  /** steamID64. */
  readonly sub: string | null;
  /** Unix seconds. */
  readonly exp: number | null;
  readonly aud: readonly string[];
}

const decodeSegment = (segment: string): unknown => {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
};

export const readTokenClaims = (token: string): SteamTokenClaims | null => {
  const payload = token.split('.')[1];
  if (!payload) return null;
  const claims = decodeSegment(payload);
  if (!claims || typeof claims !== 'object') return null;
  const obj = claims as Record<string, unknown>;
  const aud = Array.isArray(obj.aud)
    ? obj.aud.filter((a): a is string => typeof a === 'string')
    : typeof obj.aud === 'string'
      ? [obj.aud]
      : [];
  return {
    sub: typeof obj.sub === 'string' ? obj.sub : null,
    exp: typeof obj.exp === 'number' ? obj.exp : null,
    aud,
  };
};

/** What `LoginApprover` demands: minted for the mobile app, and an access token rather than a refresh token. */
export const isMobileAccessToken = (token: string): boolean => {
  const claims = readTokenClaims(token);
  if (!claims) return false;
  return claims.aud.includes('mobile') && !claims.aud.includes('derive');
};

/** Treat a token as spent slightly early: a clock skew must not race a request. */
const EXPIRY_MARGIN_SECONDS = 300;

export const isTokenExpired = (token: string, nowSeconds = Date.now() / 1000): boolean => {
  const exp = readTokenClaims(token)?.exp;
  // A token with no expiry is not one we know how to reason about — replace it.
  if (exp === null || exp === undefined) return true;
  return exp - EXPIRY_MARGIN_SECONDS <= nowSeconds;
};
