declare module '*?asset' {
  const path: string;
  export default path;
}

/** The metric's ingest key, substituted by `electron.vite.config.ts` at build time from `LAUNCHER_TELEMETRY_KEY`. */
declare const __TELEMETRY_KEY__: string;
