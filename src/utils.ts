import type { FileMakerIdPConfig } from "./types.js";

/**
 * Base64-encodes `username:password` for HTTP Basic Auth headers.
 */
export function encodeBasicAuth(username: string, password: string): string {
  const credentials = `${username}:${password}`;
  return Buffer.from(credentials, "utf8").toString("base64");
}

/**
 * Builds the Data API base URL for a given config.
 * Returns `https://{host}/fmi/data/vLatest/databases/{database}` by default.
 */
export function buildDataApiBaseUrl(config: FileMakerIdPConfig): string {
  const scheme = config.useHttps ? "https" : "http";
  return `${scheme}://${config.host}/fmi/data/vLatest/databases/${encodeURIComponent(config.database)}`;
}

/**
 * Returns the fetch implementation to use — either a custom one from the
 * config (e.g. for self-signed cert handling) or the global `fetch`.
 */
export function getFetch(config: FileMakerIdPConfig): typeof globalThis.fetch {
  return config.fetch ?? globalThis.fetch;
}

/**
 * Strips FileMaker Find operator characters from a string to prevent
 * query injection when used in `_find` requests.
 *
 * FM Find operators: `=`, `==`, `!`, `<`, `>`, `≤`, `≥`, `...`, `//`, `~`, `*`, `@`, `#`
 */
export function sanitizeFmFindValue(value: string): string {
  return value.replace(/[=!<>≤≥~*@#/\\]/g, "");
}
