/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APPINSIGHTS_CONNECTION_STRING?: string
  readonly VITE_APPINSIGHTS_ROLE_NAME?: string
  readonly VITE_WEB_PUSH_PUBLIC_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
