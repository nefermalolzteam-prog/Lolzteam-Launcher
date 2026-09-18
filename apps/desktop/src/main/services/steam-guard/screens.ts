import type { ScreenCapture } from '@shared-types';
import { desktopCapturer, screen } from 'electron';
import log from 'electron-log/main';

// On Wayland the capture goes through xdg-desktop-portal, which puts a picker
// in front of the user — and, if no portal is running or the request is never
// answered, leaves `getSources()` pending forever. That would wedge the IPC
// handler and leave the QR dialog spinning with nothing to show and no error,
// so the wait is bounded. The budget is generous on purpose: it has to outlast
// a human reading the portal prompt and choosing a screen.
const CAPTURE_TIMEOUT_MS = 60_000;

const withTimeout = <T>(work: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`screen capture did not respond within ${ms / 1000}s`)),
      ms,
    );
    timer.unref?.();
    work.then(resolve, reject).finally(() => clearTimeout(timer));
  });

/** Screenshots of the user's displays, for reading a login QR that is on screen rather than in a file. */
export const captureScreens = async (): Promise<ScreenCapture[]> => {
  const displays = screen.getAllDisplays();
  const width = Math.max(1280, ...displays.map((d) => Math.round(d.size.width * d.scaleFactor)));
  const height = Math.max(720, ...displays.map((d) => Math.round(d.size.height * d.scaleFactor)));

  try {
    const sources = await withTimeout(
      desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width, height },
        fetchWindowIcons: false,
      }),
      CAPTURE_TIMEOUT_MS,
    );
    return sources
      .filter((source) => !source.thumbnail.isEmpty())
      .map((source) => {
        const size = source.thumbnail.getSize();
        return {
          id: source.id,
          name: source.name,
          dataUrl: source.thumbnail.toDataURL(),
          width: size.width,
          height: size.height,
        };
      });
  } catch (err) {
    // Wayland and macOS both refuse — or stall — without a permission the user
    // grants outside the app.
    log.warn('[steam-guard] screen capture failed', err);
    return [];
  }
};
