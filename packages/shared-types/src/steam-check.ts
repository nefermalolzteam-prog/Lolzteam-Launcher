/** What became of the account. */
export type SteamCheckStatus = 'alive' | 'dead' | 'unlinked';

/** Why an account is `dead`, as a word of ours rather than one of Steam's. */
export type SteamCheckDetail = 'refused' | 'unknown';

/** The verdict, plus whatever the public profile page was willing to say. */
export interface SteamCheckInfo {
  readonly status: SteamCheckStatus;
  /** steamID64, once a session proved which account this is. */
  readonly steamId: string | null;
  /** The display name Steam shows, which is not the login. */
  readonly nickname: string | null;
  readonly vacBanned: boolean | null;
  /** Steam's own wording: `None`, `Probation`, `Banned`. */
  readonly tradeBanState: string | null;
  /** No purchase has ever been made on this account — it cannot trade or chat. */
  readonly limited: boolean | null;
  /** `public`, `friendsonly`, `private`. */
  readonly privacy: string | null;
  /** The join date as the page prints it; only public profiles carry one. */
  readonly memberSince: string | null;
  /** URL of the 64×64 avatar. */
  readonly avatarUrl: string | null;
  /** Why the account is `dead`, in our own words. */
  readonly detail: SteamCheckDetail | null;
}

/** The same verdict, kept on disk between runs. */
export interface SteamCheckRecord extends SteamCheckInfo {
  readonly accountId: number;
  /** Unix milliseconds. */
  readonly checkedAt: number;
}

export interface SteamCheckRequest {
  readonly accountIds: readonly number[];
  /** Proxies to spread the run across: empty = straight out, one = everything through it, several = round-robin. */
  readonly proxyIds: readonly string[];
}
