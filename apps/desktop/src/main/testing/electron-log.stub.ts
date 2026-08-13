/** Замена `electron-log/main` под тестами: настоящий тянет `electron`, а тот — бинарник, которого в CI нет. */
const noop = (): void => undefined;

const transport = { level: 'info' as string | false };

const log = {
  error: noop,
  warn: noop,
  info: noop,
  verbose: noop,
  debug: noop,
  silly: noop,
  log: noop,
  initialize: noop,
  transports: { file: { ...transport }, console: { ...transport }, ipc: { ...transport } },
  errorHandler: { startCatching: noop, stopCatching: noop },
  scope: () => log,
};

export default log;
