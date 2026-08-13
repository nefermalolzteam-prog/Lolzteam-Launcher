import { IPC_CHANNELS } from '@shared-ipc';
import { ipcMain } from 'electron';
import {
  getMetricsState,
  previewMetricsPayload,
  resetMetricsInstallId,
  setMetricsEnabled,
} from '../services/metrics';

/** The four things the window may ask of the metric: what it is doing, turn it on or off, forget who I am. */
export const registerMetricsIpc = () => {
  ipcMain.handle(IPC_CHANNELS.METRICS_STATE, () => getMetricsState());

  ipcMain.handle(IPC_CHANNELS.METRICS_SET_ENABLED, (_e, enabled?: boolean) =>
    setMetricsEnabled(enabled === true),
  );

  ipcMain.handle(IPC_CHANNELS.METRICS_RESET_ID, () => resetMetricsInstallId());

  ipcMain.handle(IPC_CHANNELS.METRICS_PREVIEW, () => previewMetricsPayload());
};
