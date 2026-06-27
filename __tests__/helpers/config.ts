import type { FileMakerIdPConfig } from "../../src/types.js";

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
    portalName: "user_project_role",
    projectIdField: "project::id_project",
    projectNameField: "project::projectName",
    roleNameField: "role::roleName",
    projectDatabaseField: "project::database_project_data",
  },
};
