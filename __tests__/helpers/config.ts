import type { FileMakerIdPConfig } from "../../src/types.js";

/** Base config without event logging — used by most test files. */
export const baseConfig: FileMakerIdPConfig = {
  host: "fm.example.com",
  database: "IdP_Accounts",
  useHttps: true,
  serviceUsername: "svc_user",
  servicePassword: "svc_pass",
  userLayout: "IdP_user",
  timeout: 5000,
  fields: {
    idUserField: "id_user",
    usernameField: "userName",
    nameFirstField: "nameFirst",
    nameLastField: "nameLast",
    emailField: "email",
    portalName: "userProjectRole",
    projectIdField: "project::id_project",
    projectNameField: "project::projectName",
    roleNameField: "role::roleName",
  },
  eventLogFields: {
    actionField: "action",
    detailField: "detail",
    errorField: "error",
    idUserField: "id_user",
    notesField: "notes",
  },
};

/** Config with event logging enabled — used by event handler tests. */
export const eventConfig: FileMakerIdPConfig = {
  ...baseConfig,
  eventLogLayout: "IdP_eventlog",
};
