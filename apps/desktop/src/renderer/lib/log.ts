import log from 'electron-log/renderer';

/** The renderer's half of the log file. */
export const rendererLog = log;

/** Sends what the window did not catch to the same file. */
export const startRendererLogging = (): void => {
  log.errorHandler.startCatching({ showDialog: false });
};
