import type { ScreenCapture } from '@shared-types';
import { desktopCapturer, screen } from 'electron';
import log from 'electron-log/main';

/** Screenshots of the user's displays, for reading a login QR that is on screen rather than in a file. */
export const captureScreens = async (): Promise<ScreenCapture[]> => {
  const displays = screen.getAllDisplays();
  const width = Math.max(1280, ...displays.map((d) => Math.round(d.size.width * d.scaleFactor)));
  const height = Math.max(720, ...displays.map((d) => Math.round(d.size.height * d.scaleFactor)));

  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width, height },
      fetchWindowIcons: false,
    });
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
    // Wayland and macOS both refuse without a permission the user grants outside the app.
    log.warn('[steam-guard] screen capture failed', err);
    return [];
  }
};
