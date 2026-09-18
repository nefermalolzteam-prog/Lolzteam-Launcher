import type { LocalizedText, LoginMethod, LoginResult } from '@adapter-contract';

// Shared `fail` factory for adapter login results. Takes an i18n key (and
// optional params) rather than prose: the main process has no locale, so the
// renderer resolves the text. `method` defaults to 'native'.
export const failLogin = (
  key: string,
  params?: LocalizedText['params'],
  method: LoginMethod = 'native',
): LoginResult => ({
  ok: false,
  method,
  message: params ? { key, params } : { key },
});
