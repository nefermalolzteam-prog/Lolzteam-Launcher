import log from 'electron-log/main';
import { LoginApprover } from 'steam-session';
import { getSettings } from '../../settings/settings-store';
import { proxyUrlFor } from '../proxy';
import { buildQrChallengeUrl, findQrChallengeUrl } from './qr';
import { type GuardFailure, getGuardAccessToken, getGuardSteamId } from './session';

export { findQrChallengeUrl };

export interface ApprovalPreview {
  readonly ip: string;
  readonly city: string;
  readonly state: string;
  readonly country: string;
  readonly deviceFriendlyName: string;
  readonly platformType: number;
  /** Steam's own judgement that the request came from somewhere unusual. */
  readonly locationMismatch: boolean;
  readonly highUsageLogin: boolean;
}

export type ApprovalResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: GuardFailure | 'bad_qr'; message?: string };

const approverFor = async (
  accountId: number,
): Promise<ApprovalResult<{ approver: LoginApprover; steamId: string }>> => {
  const token = await getGuardAccessToken(accountId);
  if (!token.ok) return { ok: false, reason: token.reason, message: token.message };
  if (!token.record.sharedSecret) return { ok: false, reason: 'no_credentials' };

  const settings = await getSettings();
  const proxy = token.record.proxyId
    ? settings.proxies.find((p) => p.id === token.record.proxyId)
    : undefined;

  const approver = new LoginApprover(token.token, token.record.sharedSecret, {
    ...(settings.proxyEnabled && proxy ? { httpProxy: proxyUrlFor(proxy) } : {}),
  });
  return { ok: true, data: { approver, steamId: getGuardSteamId(token.record, token.token) } };
};

/** What is actually being approved, so the user can refuse it. */
export const previewAuthSession = async (
  accountId: number,
  rawUrl: string,
): Promise<ApprovalResult<ApprovalPreview>> => {
  const url = findQrChallengeUrl(rawUrl);
  if (!url) return { ok: false, reason: 'bad_qr' };

  const built = await approverFor(accountId);
  if (!built.ok) return built;

  try {
    const info = await built.data.approver.getAuthSessionInfo(url);
    return {
      ok: true,
      data: {
        ip: info.ip ?? '',
        city: info.location?.city ?? '',
        state: info.location?.state ?? '',
        country: info.location?.geoloc ?? '',
        deviceFriendlyName: info.deviceFriendlyName ?? '',
        platformType: info.platformType ?? 0,
        locationMismatch: info.locationMismatch === true,
        highUsageLogin: info.highUsageLogin === true,
      },
    };
  } catch (err) {
    log.warn(`[steam-guard] session info failed for account ${accountId}`, err);
    return {
      ok: false,
      reason: 'bad_qr',
      message: err instanceof Error ? err.message : String(err),
    };
  }
};

/** Approves or refuses the pending login the QR points at. */
export const approveAuthSession = async (
  accountId: number,
  rawUrl: string,
  approve: boolean,
): Promise<ApprovalResult<{ approved: boolean }>> => {
  const url = findQrChallengeUrl(rawUrl);
  if (!url) return { ok: false, reason: 'bad_qr' };

  const built = await approverFor(accountId);
  if (!built.ok) return built;

  try {
    await built.data.approver.approveAuthSession({ qrChallengeUrl: url, approve });
    log.info(`[steam-guard] account ${accountId} ${approve ? 'approved' : 'denied'} a login`);
    return { ok: true, data: { approved: approve } };
  } catch (err) {
    log.warn(`[steam-guard] approval failed for account ${accountId}`, err);
    return {
      ok: false,
      reason: 'login_failed',
      message: err instanceof Error ? err.message : String(err),
    };
  }
};

/** Approves a login this launcher started itself. */
export const approveOwnLoginSession = async (
  accountId: number,
  clientId: string,
  expectedSteamId: string,
): Promise<ApprovalResult<{ approved: true }>> => {
  if (!/^\d+$/.test(clientId)) return { ok: false, reason: 'bad_qr' };

  const built = await approverFor(accountId);
  if (!built.ok) return built;

  if (!expectedSteamId || built.data.steamId !== expectedSteamId) {
    log.warn(
      `[steam-guard] account ${accountId} is linked to ${built.data.steamId || '(unknown)'}, but the login is for ${expectedSteamId || '(unknown)'}`,
    );
    return { ok: false, reason: 'no_account' };
  }

  try {
    // The version in this URL is discarded — `getAuthSessionInfo` reads only the client id.
    const info = await built.data.approver.getAuthSessionInfo(buildQrChallengeUrl(1, clientId));
    const version = Number.isInteger(info.version) && info.version > 0 ? info.version : 1;
    await built.data.approver.approveAuthSession({
      qrChallengeUrl: buildQrChallengeUrl(version, clientId),
      approve: true,
    });
    log.info(`[steam-guard] auto-approved the launcher's own login for account ${accountId}`);
    return { ok: true, data: { approved: true } };
  } catch (err) {
    log.warn(`[steam-guard] auto-approval failed for account ${accountId}`, err);
    return {
      ok: false,
      reason: 'login_failed',
      message: err instanceof Error ? err.message : String(err),
    };
  }
};
