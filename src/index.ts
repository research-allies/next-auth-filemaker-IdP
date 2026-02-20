// Types
export type {
  FileMakerIdPConfig,
  FieldMapping,
  UserProfile,
  FileMakerUser,
  ProjectAssignment,
  EventLogEntry,
} from "./types.js";

// Errors
export {
  FileMakerIdPError,
  FileMakerAuthError,
  FileMakerQueryError,
  ConfigurationError,
} from "./errors.js";

// Config loader (server-only — never import from client code)
export { loadConfigFromEnv } from "./env.js";

// Provider factory
export { createFileMakerProvider } from "./provider.js";

// Callback factories
export {
  createJwtCallback,
  createSessionCallback,
  createEventHandlers,
} from "./callbacks.js";
export type { FileMakerJWT, FileMakerSession } from "./callbacks.js";

// FM Data API client (for advanced/custom use)
export {
  fmLogin,
  fmLogout,
  fmFindUserWithPrivileges,
  fmWriteEventLog,
} from "./filemaker-client.js";

// Login form component — import from "@research-allies/next-auth-filemaker-idp/client"
