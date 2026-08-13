import { generateSteamGuardCode } from '../../adapters/steam/mafile';
import { getSteamTime } from './time';

/** How long one code is valid; Steam's TOTP step, not a choice of ours. */
export const CODE_PERIOD_SECONDS = 30;

export interface GuardCode {
  readonly code: string;
  /** Seconds until this code is replaced — drives the countdown ring. */
  readonly secondsRemaining: number;
  /** Steam-clock second the code was produced for; lets the UI tick without re-asking. */
  readonly generatedAt: number;
}

/** A code plus the countdown to go with it, both on Steam's clock rather than the machine's. */
export const getGuardCode = async (sharedSecret: string): Promise<GuardCode> => {
  const now = await getSteamTime();
  return {
    code: generateSteamGuardCode(sharedSecret, now * 1000),
    secondsRemaining: CODE_PERIOD_SECONDS - (now % CODE_PERIOD_SECONDS),
    generatedAt: now,
  };
};
