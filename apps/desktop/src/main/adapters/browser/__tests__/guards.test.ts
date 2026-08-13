import { describe, expect, it, vi } from 'vitest';

// `guards.ts` imports `shell` for the one user-initiated "open outside" path.
vi.mock('electron', () => ({ shell: { openExternal: vi.fn() } }));

const { isAllowedPermission, isWebUrl } = await import('../guards');

/** The two predicates behind the account browser's guards. */
describe('isWebUrl', () => {
  it('accepts http and https', () => {
    expect(isWebUrl('https://steamcommunity.com/login')).toBe(true);
    expect(isWebUrl('http://example.com')).toBe(true);
    expect(isWebUrl('HTTPS://EXAMPLE.COM')).toBe(true);
  });

  it('rejects the schemes a page could redirect itself into', () => {
    // Reading the disk with the page's own scripts.
    expect(isWebUrl('file:///C:/Users/Vladimir/AppData/Roaming')).toBe(false);
    // Running in whatever document is currently loaded.
    expect(isWebUrl('javascript:alert(document.cookie)')).toBe(false);
    expect(isWebUrl('data:text/html,<script>1</script>')).toBe(false);
    // A protocol handler is an arbitrary program on the user's machine.
    expect(isWebUrl('steam://run/730')).toBe(false);
    expect(isWebUrl('ms-msdt:/id')).toBe(false);
  });

  it('rejects anything that is not a URL at all', () => {
    expect(isWebUrl('')).toBe(false);
    expect(isWebUrl('   ')).toBe(false);
    expect(isWebUrl('not a url')).toBe(false);
    // Scheme-relative: no protocol to check, so it cannot be vouched for here.
    expect(isWebUrl('//evil.example')).toBe(false);
  });
});

describe('isAllowedPermission', () => {
  it('allows only what a login page legitimately needs', () => {
    expect(isAllowedPermission('clipboard-sanitized-write')).toBe(true);
    expect(isAllowedPermission('fullscreen')).toBe(true);
  });

  it('denies clipboard-read even though the write is allowed', () => {
    // The asymmetry is the point: writing is the site's own data going out.
    expect(isAllowedPermission('clipboard-read')).toBe(false);
  });

  it('denies the rest', () => {
    for (const p of [
      'media',
      'geolocation',
      'notifications',
      'midi',
      'midiSysex',
      'pointerLock',
      'openExternal',
      'display-capture',
      'idle-detection',
      'window-management',
      'unknown-future-permission',
    ]) {
      expect(isAllowedPermission(p), p).toBe(false);
    }
  });
});
