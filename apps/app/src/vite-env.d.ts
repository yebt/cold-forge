/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the COLD FORGE API, e.g. https://api.coldforge.app */
  readonly VITE_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
