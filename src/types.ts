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
  /** Portal name on the user layout (case-sensitive). Default: `"user_project_role"` */
  portalName: string;
  /** Portal field in `TableName::fieldName` format. Default: `"project::id_project"` */
  projectIdField: string;
  /** Portal field in `TableName::fieldName` format. Default: `"project::projectName"` */
  projectNameField: string;
  /** Portal field in `TableName::fieldName` format. Default: `"role::roleName"` */
  roleNameField: string;
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
  /** Request timeout in milliseconds. Default: `10000` */
  timeout: number;
  /**
   * Custom fetch implementation (e.g. for self-signed certs in dev).
   * Defaults to `globalThis.fetch`.
   */
  fetch?: typeof globalThis.fetch;
}
