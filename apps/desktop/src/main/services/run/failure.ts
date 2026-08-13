/** What Node, undici and the TLS stack call a link that did not hold. */
const NETWORK_CODES: ReadonlySet<string> = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'EHOSTDOWN',
  'ENETUNREACH',
  'ENETDOWN',
  'ENETRESET',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'EPROTO',
  'EADDRNOTAVAIL',
  'ERR_SOCKET_CLOSED',
  'ERR_SOCKET_CONNECTION_TIMEOUT',
  'ERR_STREAM_PREMATURE_CLOSE',
  'ERR_SSL_WRONG_VERSION_NUMBER',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
]);

/** Error classes that mean the same thing without carrying a code. */
const NETWORK_NAMES: ReadonlySet<string> = new Set([
  'TimeoutError',
  'MtTimeoutError',
  'ConnectTimeoutError',
  'FetchError',
  'ProxyConnectionError',
]);

/** The last resort, and the only part of this that guesses. */
const NETWORK_PHRASES: readonly RegExp[] = [
  /socket hang up/i,
  /socket closed/i,
  /connection (?:closed|reset|refused|timed out|failed)/i,
  /(?:^|\W)proxy\b.*\b(?:fail|refus|timed out|error|unreachable)/i,
  /network (?:is )?(?:unreachable|error|down)/i,
  /getaddrinfo/i,
  /tunneling socket could not be established/i,
];

/** Whether this failure is about the link rather than about us. */
export const isNetworkFailure = (err: unknown, depth = 3): boolean => {
  if (!err || typeof err !== 'object') return false;

  const e = err as { code?: unknown; name?: unknown; message?: unknown; cause?: unknown };
  if (typeof e.code === 'string' && NETWORK_CODES.has(e.code)) return true;
  if (typeof e.name === 'string' && NETWORK_NAMES.has(e.name)) return true;
  if (typeof e.message === 'string' && NETWORK_PHRASES.some((re) => re.test(e.message as string)))
    return true;

  // `fetch` wraps everything it touches in a flat `TypeError: fetch failed` and puts the real errno underneath.
  if (depth <= 0 || e.cause === undefined || e.cause === err) return false;
  return isNetworkFailure(e.cause, depth - 1);
};

/** The message a row shows behind its one-word verdict. */
export const detailOf = (err: unknown): string =>
  err instanceof Error ? err.message : String(err);

/** One word and one sentence for a failure nobody classified any closer. */
export const describeFailure = (
  err: unknown,
): { error: 'network' | 'unknown'; detail: string } => ({
  error: isNetworkFailure(err) ? 'network' : 'unknown',
  detail: detailOf(err),
});
