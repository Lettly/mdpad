/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Client id of the GitHub OAuth App used for the device flow. */
  readonly VITE_OAUTH_CLIENT_ID?: string
  /** Base URL of the CORS relay in oauth-proxy/. */
  readonly VITE_OAUTH_PROXY?: string
}
