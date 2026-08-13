import { IPC_CHANNELS } from '@shared-ipc';
import type { DesktopNotification } from '@shared-types';
import { Notification, ipcMain } from 'electron';
import log from 'electron-log/main';
import { getMainWindow, showMainWindow } from '../window/main-window';

/** Windows draws nothing for a toast whose text is longer than the balloon. */
const MAX = 200;

const clip = (value: unknown): string => {
  if (typeof value !== 'string') return '';
  const text = value.trim();
  return text.length > MAX ? `${text.slice(0, MAX - 1)}…` : text;
};

/** Is the user already looking at us? */
const inFront = (): boolean => {
  const win = getMainWindow();
  if (win === null) return false;
  return win.isVisible() && !win.isMinimized() && win.isFocused();
};

export const registerNotifyIpc = () => {
  ipcMain.handle(IPC_CHANNELS.NOTIFY_SHOW, (_event, payload: DesktopNotification) => {
    // A headless session, a Linux box with no notification daemon, a Windows install with toasts turned off at the OS level.
    if (!Notification.isSupported()) return;
    const title = clip(payload?.title);
    if (!title) return;
    if (payload?.onlyWhenHidden && inFront()) return;

    try {
      const toast = new Notification({ title, body: clip(payload?.body) });
      // The point of a toast is to be a way back in.
      toast.on('click', () => showMainWindow());
      toast.show();
    } catch (err) {
      log.warn('[notify] toast failed', err);
    }
  });
};
