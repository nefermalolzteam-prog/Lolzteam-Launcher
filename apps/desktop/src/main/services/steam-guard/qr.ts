/** `https://s.team/q/<version>/<client_id>` — the same shape LoginApprover parses. */
const QR_URL = /^https?:\/\/s\.team\/q\/(\d+)\/(\d+)(\?|$)/;

/** The same URL, but anywhere inside a longer string. */
const EMBEDDED_QR_URL = /https?:\/\/s\.team\/q\/\d+\/\d+/;

/** A QR decoder returns the bare URL, but a link copied out of a chat arrives wrapped in words. */
export const findQrChallengeUrl = (input: string): string | null => {
  const trimmed = input.trim();
  if (QR_URL.test(trimmed)) return trimmed;
  const embedded = trimmed.match(EMBEDDED_QR_URL);
  return embedded ? embedded[0] : null;
};

/** The same URL, built instead of parsed. */
export const buildQrChallengeUrl = (version: number, clientId: string): string =>
  `https://s.team/q/${version}/${clientId}`;
