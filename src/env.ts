/**
 * @fileoverview Environment variable loader for FileMaker IdP config.
 *
 * ⚠️ SECURITY: SERVER-ONLY
 * This module reads process.env including service account credentials.
 * NEVER import or call `loadConfigFromEnv` from client components or
 * any code marked with "use client". Doing so would expose service
 * credentials to the browser.
 */

import type { FileMakerIdPConfig, FieldMapping } from "./types.js";
import { ConfigurationError } from "./errors.js";

const REQUIRED_VARS = [
  "FM_HOST",
  "FM_DATABASE",
  "FM_SERVICE_USERNAME",
  "FM_SERVICE_PASSWORD",
] as const;

type Overrides = Partial<Pick<FileMakerIdPConfig, "fetch" | "timeout">>;

/**
 * Reads all `FM_*` environment variables from `process.env` and returns a
 * validated `FileMakerIdPConfig`. Applies sensible defaults for optional vars.
 *
 * ⚠️ Call this only in server-side code (e.g. `auth.ts`).
 *
 * @param overrides - Optional programmatic overrides (e.g. custom `fetch` for self-signed certs)
 * @throws {ConfigurationError} if any required env vars are missing
 */
export function loadConfigFromEnv(overrides?: Overrides): FileMakerIdPConfig {
  const missing = REQUIRED_VARS.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    throw new ConfigurationError(missing);
  }

  const fields: FieldMapping = {
    idUserField: process.env.FM_FIELD_ID_USER ?? "id_user",
    usernameField: process.env.FM_FIELD_USERNAME ?? "userName",
    nameFirstField: process.env.FM_FIELD_NAME_FIRST ?? "nameFirst",
    nameLastField: process.env.FM_FIELD_NAME_LAST ?? "nameLast",
    emailField: process.env.FM_FIELD_EMAIL ?? "email",
    portalName: process.env.FM_PORTAL_NAME ?? "userProjectRole",
    projectIdField: process.env.FM_FIELD_PROJECT_ID ?? "project::id_project",
    projectNameField:
      process.env.FM_FIELD_PROJECT_NAME ?? "project::projectName",
    roleNameField: process.env.FM_FIELD_ROLE_NAME ?? "role::roleName",
  };

  const useHttps = process.env.FM_USE_HTTPS !== "false";
  const timeout = process.env.FM_TIMEOUT
    ? parseInt(process.env.FM_TIMEOUT, 10)
    : 10000;

  return {
    host: process.env.FM_HOST!,
    database: process.env.FM_DATABASE!,
    useHttps,
    serviceUsername: process.env.FM_SERVICE_USERNAME!,
    servicePassword: process.env.FM_SERVICE_PASSWORD!,
    userLayout: process.env.FM_USER_LAYOUT ?? "DAPI_USER",
    fields,
    timeout,
    ...overrides,
  };
}
