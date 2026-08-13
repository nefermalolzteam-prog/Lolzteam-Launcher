/** Chrome stopped disclosing its build number in 113 — "User-Agent reduction". */
const PLATFORM_TOKENS = {
  win32: 'Windows NT 10.0; Win64; x64',
  darwin: 'Macintosh; Intel Mac OS X 10_15_7',
  linux: 'X11; Linux x86_64',
} as const;

type KnownPlatform = keyof typeof PLATFORM_TOKENS;

const isKnown = (platform: NodeJS.Platform): platform is KnownPlatform =>
  platform in PLATFORM_TOKENS;

/** Only reached if `process.versions.chrome` ever stops looking like a version. */
const FALLBACK_CHROME_MAJOR = '130';

/** A reduced Chrome User-Agent for the given engine version and platform. */
export const buildBrowserUserAgent = (chromeVersion: string, platform: NodeJS.Platform): string => {
  const major = /^(\d+)\./.exec(chromeVersion)?.[1] ?? FALLBACK_CHROME_MAJOR;
  const os = isKnown(platform) ? PLATFORM_TOKENS[platform] : PLATFORM_TOKENS.win32;
  return `Mozilla/5.0 (${os}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`;
};
