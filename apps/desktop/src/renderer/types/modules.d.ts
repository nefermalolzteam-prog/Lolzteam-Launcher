declare module '*.module.scss' {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}

declare module '*.module.css' {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}

declare module '*.svg' {
  const src: string;
  export default src;
}

declare module '*.png' {
  const src: string;
  export default src;
}

declare module '*.webm' {
  const src: string;
  export default src;
}

// biome-ignore lint/correctness/noUnusedVariables: ambient augmentation of the global ImportMeta
interface ImportMeta {
  glob<T = unknown>(
    pattern: string,
    options?: { eager?: boolean; query?: string; import?: string },
  ): Record<string, T>;

  readonly env: {
    /** `true` under `pnpm dev`, `false` in anything that ships. */
    readonly DEV: boolean;
    readonly PROD: boolean;
    /** `development` / `production`, or whatever `--mode` was given. */
    readonly MODE: string;
  };
}
