/** `scheme://user:pass@host` → `scheme://***@host`. */
const URL_USERINFO = /([a-z][a-z0-9+.-]*:\/\/)[^\s/@]*:[^\s/@]*@/gi;

export const redactSecrets = (text: string): string => text.replace(URL_USERINFO, '$1***@');
