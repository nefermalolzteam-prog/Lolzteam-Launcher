/** Which relationships a purge is allowed to drop. */
export type SteamFriendTarget = 'friends' | 'incoming' | 'outgoing';

export const STEAM_FRIEND_TARGETS = [
  'friends',
  'incoming',
  'outgoing',
] as const satisfies readonly SteamFriendTarget[];

export interface SteamFriendsRequest {
  readonly accountIds: readonly number[];
  /** Nothing selected is refused as `empty`: a run that would do nothing. */
  readonly targets: readonly SteamFriendTarget[];
  /** Block instead of merely unfriending. */
  readonly block: boolean;
  readonly proxyIds: readonly string[];
}

/** What one account's purge came to. */
export interface SteamFriendsResult {
  /** Relationships in the list, including the ones deliberately left alone. */
  readonly scanned: number;
  /** Unfriended and not blocked. */
  readonly removed: number;
  readonly blocked: number;
  /** Looked at and left alone — not a selected target. */
  readonly kept: number;
  /** Selected, attempted, refused. */
  readonly failed: number;
}
