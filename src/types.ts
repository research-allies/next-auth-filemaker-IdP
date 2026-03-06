/**
 * A single project+role assignment for a user.
 * One entry per project; `roles` lists all roles the user holds in that project.
 */
export interface ProjectAssignment {
  projectId: string;
  projectName: string;
  roles: string[];
}

/**
 * Identity-only fields for a FileMaker user (no project/role assignments).
 * Returned as the `profile` field from `fmFindUserWithPrivileges`.
 */
export interface UserProfile {
  id: string;
  userName: string;
  nameFirst: string;
  nameLast: string;
  email: string;
}

/**
 * The authenticated user object returned from `authorize` and stored in the JWT.
 * Extends `UserProfile` with project/role assignments — no FM session tokens.
 */
export interface FileMakerUser extends UserProfile {
  projects: ProjectAssignment[];
}

/**
 * Maps env var overrides to FileMaker field/portal names.
 * All fields have defaults matching the standard IdP_Accounts.fmp12 schema.
 */
export interface FieldMapping {
  /** PK on the user table. Default: `"id_user"` */
  idUserField: string;
  /** Field used in Find queries. Default: `"userName"` */
  usernameField: string;
  /** Default: `"nameFirst"` */
  nameFirstField: string;
  /** Default: `"nameLast"` */
  nameLastField: string;
  /** Default: `"email"` */
  emailField: string;
  /** Portal name on the user layout (case-sensitive). Default: `"userProjectRole"` */
  portalName: string;
  /** Portal field in `TableName::fieldName` format. Default: `"project::id_project"` */
  projectIdField: string;
  /** Portal field in `TableName::fieldName` format. Default: `"project::projectName"` */
  projectNameField: string;
  /** Portal field in `TableName::fieldName` format. Default: `"role::roleName"` */
  roleNameField: string;
}

/**
 * Maps env var overrides to FileMaker event log field names.
 * All fields have defaults matching the standard IdP_Accounts.fmp12 schema.
 */
export interface EventLogFieldMapping {
  /** Field for event type (e.g. `"signIn"`). Default: `"action"` */
  actionField: string;
  /** Field for human-readable detail. Default: `"detail"` */
  detailField: string;
  /** Field for error messages. Default: `"error"` */
  errorField: string;
  /** Field for foreign key (user PK). Default: `"id_user"` */
  foreignKeyIdField: string;
  /** Field for additional notes. Default: `"notes"` */
  notesField: string;
}

/**
 * Payload written to the FileMaker event log layout on auth events.
 * Fields map to FM field names via `fmWriteEventLog`.
 */
export interface EventLogEntry {
  /** Event type mapped to `eventLogFields.actionField`. One of `"signIn"`, `"signOut"`, `"signInFailed"`. */
  action: string;
  /** Human-readable description mapped to `eventLogFields.detailField` (e.g. username or email). */
  detail?: string;
  /** Error message mapped to `eventLogFields.errorField` (failure events only). */
  error?: string;
  /** User PK mapped to `eventLogFields.foreignKeyIdField`. */
  foreignKeyId?: string;
  /** Additional context mapped to `eventLogFields.notesField`. */
  notes?: string;
}

/**
 * Full runtime configuration for the FileMaker IdP package.
 * Built from environment variables via `loadConfigFromEnv()`.
 */
export interface FileMakerIdPConfig {
  /** FileMaker Server hostname (e.g. `"fm.example.com"`) */
  host: string;
  /** Database name for Data API connections */
  database: string;
  /** Use HTTPS for Data API calls. Default: `true` */
  useHttps: boolean;
  /** Service account username for backend profile/privilege queries */
  serviceUsername: string;
  /** Service account password for backend profile/privilege queries */
  servicePassword: string;
  /** Data API layout name for user profile + portal. Default: `"IdP_user"` */
  userLayout: string;
  /** Field name mappings (with defaults matching IdP_Accounts.fmp12 schema) */
  fields: FieldMapping;
  /** Event log field name mappings (with defaults matching IdP_Accounts.fmp12 schema) */
  eventLogFields: EventLogFieldMapping;
  /** Request timeout in milliseconds. Default: `10000` */
  timeout: number;
  /**
   * Custom fetch implementation (e.g. for self-signed certs in dev).
   * Defaults to `globalThis.fetch`.
   */
  fetch?: typeof globalThis.fetch;
  /**
   * Data API layout name for event log record creation.
   * If `undefined` (or `FM_IdP_EVENT_LOG_LAYOUT` is unset), event logging is disabled.
   */
  eventLogLayout?: string;
}
