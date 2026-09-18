import icoUrl from '../../renderer/assets/favicon.ico?asset';
import pngUrl from '../../renderer/assets/icon.png?asset';

// Windows is the only platform whose native image loader reads `.ico`. On Linux
// it fails outright — `nativeImage.createFromPath` returns an empty image and
// `new Tray(path)` throws "Failed to load image from path", which used to leave
// the app with no tray icon while `minimizeToTray` still hid the window on
// close: the launcher vanished with no way to bring it back.
export const appIconPath = process.platform === 'win32' ? icoUrl : pngUrl;
