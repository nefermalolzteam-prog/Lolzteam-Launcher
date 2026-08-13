import { LOLZ_CONFIG } from '@lolzteam/shared-ipc';
import ky, { HTTPError, type KyInstance } from 'ky';
import type {
  CheckAccountResponse,
  EmailCodeResponse,
  RawEditMeResponse,
  RawLettersResponse,
  RawMarketItem,
  RawOrdersResponse,
  RawProfileResponse,
  RawStatusResponse,
  RawTagOpResponse,
  RawUserTagResponse,
  RawUserTagsResponse,
} from './types';

export interface MarketClientOptions {
  baseUrl?: string;
  getToken: () => Promise<string | null> | string | null;
  userAgent?: string;
  fetch?: typeof globalThis.fetch;
}

/** Longest we will sit on a `429`. */
const MAX_RETRY_WAIT_MS = 70_000;

/** Enough that the window has demonstrably rolled over when we ask again. */
const RESET_SLACK_MS = 500;

const sleep = (ms: number, signal?: AbortSignal | null): Promise<void> =>
  new Promise((resolve) => {
    if (ms <= 0 || signal?.aborted) {
      resolve();
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/** How long to hold off after a `429`, from the response that carried it. */
const waitAfterRateLimit = (response: Response, now: number): number => {
  const reset = Number(response.headers.get('X-RateLimit-Reset'));
  if (!Number.isFinite(reset) || reset <= 0) return MAX_RETRY_WAIT_MS;
  return Math.min(Math.max(reset * 1000 - now + RESET_SLACK_MS, 0), MAX_RETRY_WAIT_MS);
};

export class MarketClient {
  private readonly http: KyInstance;
  private readonly getToken: MarketClientOptions['getToken'];

  constructor(opts: MarketClientOptions) {
    this.getToken = opts.getToken;
    this.http = ky.create({
      prefixUrl: opts.baseUrl ?? LOLZ_CONFIG.marketApiUrl,
      timeout: 20_000,
      retry: { limit: 2, methods: ['get'], statusCodes: [429, 500, 502, 503, 504] },
      ...(opts.fetch ? { fetch: opts.fetch } : {}),
      hooks: {
        beforeRequest: [
          async (req) => {
            const token = await this.getToken();
            if (token) req.headers.set('Authorization', `Bearer ${token}`);
            if (opts.userAgent) req.headers.set('User-Agent', opts.userAgent);
            req.headers.set('Accept', 'application/json');
          },
        ],
        beforeRetry: [
          async ({ request, error }) => {
            if (!(error instanceof HTTPError) || error.response.status !== 429) return;
            await sleep(waitAfterRateLimit(error.response, Date.now()), request.signal);
          },
        ],
      },
    });
  }

  /** `List.Orders` — accounts the user has purchased. */
  async listOrders(
    params: { page?: number; categoryId?: number } = {},
    signal?: AbortSignal,
  ): Promise<RawOrdersResponse> {
    const search = new URLSearchParams();
    if (params.page) search.set('page', String(params.page));
    if (params.categoryId) search.set('category_id', String(params.categoryId));
    return this.http.get('user/orders', { searchParams: search, signal }).json<RawOrdersResponse>();
  }

  /** `Get Proxy` — the user's saved proxy list. */
  async listProxies(signal?: AbortSignal): Promise<unknown> {
    return this.http.get('proxy', { signal }).json<unknown>();
  }

  /** `List.User` — accounts the authenticated user owns (listings + purchases). */
  async listUser(
    params: { page?: number; categoryId?: number; show?: string } = {},
    signal?: AbortSignal,
  ): Promise<RawOrdersResponse> {
    const search = new URLSearchParams();
    if (params.page) search.set('page', String(params.page));
    if (params.categoryId) search.set('category_id', String(params.categoryId));
    if (params.show) search.set('show', params.show);
    return this.http.get('user/items', { searchParams: search, signal }).json<RawOrdersResponse>();
  }

  /** `Managing.Get` — full details for a single item (login/password/etc). */
  async getItem(itemId: number, signal?: AbortSignal): Promise<{ item?: RawMarketItem }> {
    return this.http.get(String(itemId), { signal }).json<{ item?: RawMarketItem }>();
  }

  /** `Managing.Steam.GetMafile` — Steam Guard mafile for the item. */
  async getSteamMafile(itemId: number, signal?: AbortSignal): Promise<unknown> {
    return this.http.get(`${itemId}/mafile`, { signal }).json<unknown>();
  }

  async checkAccount(itemId: number, signal?: AbortSignal): Promise<CheckAccountResponse> {
    return this.http
      .post(`${itemId}/check-account`, { throwHttpErrors: false, signal })
      .json<CheckAccountResponse>();
  }

  /** `Managing.EmailCode` — fetch parsed email confirmation code for the item. */
  async getEmailCode(itemId: number, signal?: AbortSignal): Promise<EmailCodeResponse> {
    return this.http
      .get(`${itemId}/email-code`, { throwHttpErrors: false, signal })
      .json<EmailCodeResponse>();
  }

  async getLetters(
    params: {
      emailPassword?: string;
      email?: string;
      password?: string;
      limit?: number;
    },
    signal?: AbortSignal,
  ): Promise<RawLettersResponse> {
    const search = new URLSearchParams();
    if (params.emailPassword) search.set('email_password', params.emailPassword);
    if (params.email) search.set('email', params.email);
    if (params.password) search.set('password', params.password);
    if (params.limit) search.set('limit', String(params.limit));
    return this.http
      .get('letters2', { searchParams: search, throwHttpErrors: false, signal })
      .json<RawLettersResponse>();
  }

  /** `Managing.Tag.Add` — attach one of the user's labels to the item. */
  async addItemTag(itemId: number, tagId: number): Promise<RawTagOpResponse> {
    return this.http
      .post(`${itemId}/tag`, { json: { tag_id: tagId }, throwHttpErrors: false })
      .json<RawTagOpResponse>();
  }

  /** `Managing.Tag.Delete` — detach a label from the item. */
  async removeItemTag(itemId: number, tagId: number): Promise<RawTagOpResponse> {
    return this.http
      .delete(`${itemId}/tag`, { json: { tag_id: tagId }, throwHttpErrors: false })
      .json<RawTagOpResponse>();
  }

  /** `EditMarketSettings` — change the account currency (PUT /me). */
  async updateCurrency(currency: string): Promise<RawEditMeResponse> {
    return this.http
      .put('me', { json: { user: { currency } }, throwHttpErrors: false })
      .json<RawEditMeResponse>();
  }

  /** `Managing.NoteEdit` — replace the private note on an item. */
  async setItemNote(itemId: number, text: string): Promise<RawStatusResponse> {
    return this.http
      .put(`${itemId}/note`, { json: { text }, throwHttpErrors: false })
      .json<RawStatusResponse>();
  }

  /** `Managing.NoteDelete` — remove it. */
  async deleteItemNote(itemId: number): Promise<RawStatusResponse> {
    return this.http.delete(`${itemId}/note`, { throwHttpErrors: false }).json<RawStatusResponse>();
  }

  /** `Market.UserTags.Get` — the user's own tag palette. */
  async getUserTags(): Promise<RawUserTagsResponse> {
    return this.http.get('user/tags', { throwHttpErrors: false }).json<RawUserTagsResponse>();
  }

  /** `Market.UserTags.Create` — create a new tag (title ≤16 chars, bc colour). */
  async createUserTag(title: string, bc: string): Promise<RawUserTagResponse> {
    return this.http
      .post('user/tags', { json: { title, bc }, throwHttpErrors: false })
      .json<RawUserTagResponse>();
  }

  /** `Market.UserTags.Update` — edit a custom tag (tag_id ≥ 4). */
  async updateUserTag(tagId: number, title: string, bc: string): Promise<RawUserTagResponse> {
    return this.http
      .put('user/tags', { json: { tag_id: tagId, title, bc }, throwHttpErrors: false })
      .json<RawUserTagResponse>();
  }

  /** `Market.UserTags.Delete` — delete a custom tag (also detaches it everywhere). */
  async deleteUserTag(tagId: number): Promise<RawStatusResponse> {
    return this.http
      .delete('user/tags', { json: { tag_id: tagId }, throwHttpErrors: false })
      .json<RawStatusResponse>();
  }

  /** `Market.UserTags.Order` — set the tag order. */
  async reorderUserTags(tagOrder: number[]): Promise<RawStatusResponse> {
    return this.http
      .post('user/tags/order', { json: { tag_order: tagOrder }, throwHttpErrors: false })
      .json<RawStatusResponse>();
  }

  /** Current authenticated user (market API — no avatar URL, only `avatar_date`). */
  async me(): Promise<RawProfileResponse> {
    return this.http.get('me').json<RawProfileResponse>();
  }

  /** Current authenticated user from the forum API (`/users/me`). */
  async meForum(): Promise<RawProfileResponse> {
    return this.http
      .get('users/me', { prefixUrl: LOLZ_CONFIG.forumApiUrl })
      .json<RawProfileResponse>();
  }
}
