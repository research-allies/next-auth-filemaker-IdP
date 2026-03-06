import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadConfigFromEnv } from "../src/env.js";
import { ConfigurationError } from "../src/errors.js";

const REQUIRED_ENV = {
  FM_IdP_HOST: "fm.example.com",
  FM_IdP_DATABASE: "IdP_Accounts",
  FM_IdP_SERVICE_USERNAME: "svc_user",
  FM_IdP_SERVICE_PASSWORD: "svc_pass",
};

function setEnv(vars: Record<string, string>) {
  for (const [k, v] of Object.entries(vars)) {
    process.env[k] = v;
  }
}

function clearEnv() {
  const ALL_VARS = [
    "FM_IdP_HOST",
    "FM_IdP_DATABASE",
    "FM_IdP_SERVICE_USERNAME",
    "FM_IdP_SERVICE_PASSWORD",
    "FM_IdP_USE_HTTPS",
    "FM_IdP_USER_LAYOUT",
    "FM_IdP_TIMEOUT",
    "FM_IdP_FIELD_ID_USER",
    "FM_IdP_FIELD_USERNAME",
    "FM_IdP_FIELD_NAME_FIRST",
    "FM_IdP_FIELD_NAME_LAST",
    "FM_IdP_FIELD_EMAIL",
    "FM_IdP_PORTAL_NAME",
    "FM_IdP_FIELD_PROJECT_ID",
    "FM_IdP_FIELD_PROJECT_NAME",
    "FM_IdP_FIELD_ROLE_NAME",
    "FM_IdP_EVENT_LOG_LAYOUT",
    "FM_IdP_EVENTLOG_FIELD_ACTION",
    "FM_IdP_EVENTLOG_FIELD_DETAIL",
    "FM_IdP_EVENTLOG_FIELD_ERROR",
    "FM_IdP_EVENTLOG_FIELD_USER_ID",
    "FM_IdP_EVENTLOG_FIELD_NOTES",
  ];
  for (const k of ALL_VARS) {
    delete process.env[k];
  }
}

describe("loadConfigFromEnv", () => {
  beforeEach(() => clearEnv());
  afterEach(() => clearEnv());

  it("returns a valid config with all required vars set", () => {
    setEnv(REQUIRED_ENV);
    const config = loadConfigFromEnv();

    expect(config.host).toBe("fm.example.com");
    expect(config.database).toBe("IdP_Accounts");
    expect(config.serviceUsername).toBe("svc_user");
    expect(config.servicePassword).toBe("svc_pass");
  });

  it("applies defaults for optional fields", () => {
    setEnv(REQUIRED_ENV);
    const config = loadConfigFromEnv();

    expect(config.useHttps).toBe(true);
    expect(config.userLayout).toBe("IdP_user");
    expect(config.timeout).toBe(10000);
    expect(config.fields.idUserField).toBe("id_user");
    expect(config.fields.usernameField).toBe("userName");
    expect(config.fields.nameFirstField).toBe("nameFirst");
    expect(config.fields.nameLastField).toBe("nameLast");
    expect(config.fields.emailField).toBe("email");
    expect(config.fields.portalName).toBe("userProjectRole");
    expect(config.fields.projectIdField).toBe("project::id_project");
    expect(config.fields.projectNameField).toBe("project::projectName");
    expect(config.fields.roleNameField).toBe("role::roleName");
    expect(config.eventLogFields.actionField).toBe("action");
    expect(config.eventLogFields.detailField).toBe("detail");
    expect(config.eventLogFields.errorField).toBe("error");
    expect(config.eventLogFields.foreignKeyIdField).toBe("id_user");
    expect(config.eventLogFields.notesField).toBe("notes");
    expect(config.eventLogLayout).toBeUndefined();
  });

  it("respects FM_IdP_USE_HTTPS=false", () => {
    setEnv({ ...REQUIRED_ENV, FM_IdP_USE_HTTPS: "false" });
    const config = loadConfigFromEnv();
    expect(config.useHttps).toBe(false);
  });

  it("respects custom FM_IdP_TIMEOUT", () => {
    setEnv({ ...REQUIRED_ENV, FM_IdP_TIMEOUT: "5000" });
    const config = loadConfigFromEnv();
    expect(config.timeout).toBe(5000);
  });

  it("respects custom field name overrides", () => {
    setEnv({
      ...REQUIRED_ENV,
      FM_IdP_USER_LAYOUT: "MY_USER_LAYOUT",
      FM_IdP_FIELD_ID_USER: "my_id",
      FM_IdP_FIELD_USERNAME: "myUserName",
      FM_IdP_PORTAL_NAME: "myPortal",
      FM_IdP_FIELD_PROJECT_ID: "proj::id",
      FM_IdP_FIELD_PROJECT_NAME: "proj::name",
      FM_IdP_FIELD_ROLE_NAME: "myRole::name",
    });
    const config = loadConfigFromEnv();
    expect(config.userLayout).toBe("MY_USER_LAYOUT");
    expect(config.fields.idUserField).toBe("my_id");
    expect(config.fields.usernameField).toBe("myUserName");
    expect(config.fields.portalName).toBe("myPortal");
    expect(config.fields.projectIdField).toBe("proj::id");
    expect(config.fields.projectNameField).toBe("proj::name");
    expect(config.fields.roleNameField).toBe("myRole::name");
  });

  it("respects custom event log field name overrides", () => {
    setEnv({
      ...REQUIRED_ENV,
      FM_IdP_EVENTLOG_FIELD_ACTION: "EventType",
      FM_IdP_EVENTLOG_FIELD_DETAIL: "Description",
      FM_IdP_EVENTLOG_FIELD_ERROR: "ErrorMsg",
      FM_IdP_EVENTLOG_FIELD_USER_ID: "fk_UserID",
      FM_IdP_EVENTLOG_FIELD_NOTES: "Comments",
    });
    const config = loadConfigFromEnv();
    expect(config.eventLogFields.actionField).toBe("EventType");
    expect(config.eventLogFields.detailField).toBe("Description");
    expect(config.eventLogFields.errorField).toBe("ErrorMsg");
    expect(config.eventLogFields.foreignKeyIdField).toBe("fk_UserID");
    expect(config.eventLogFields.notesField).toBe("Comments");
  });

  it("throws ConfigurationError when FM_IdP_HOST is missing", () => {
    setEnv({
      FM_IdP_DATABASE: "IdP_Accounts",
      FM_IdP_SERVICE_USERNAME: "svc",
      FM_IdP_SERVICE_PASSWORD: "pass",
    });
    expect(() => loadConfigFromEnv()).toThrow(ConfigurationError);
    expect(() => loadConfigFromEnv()).toThrow("FM_IdP_HOST");
  });

  it("throws ConfigurationError when multiple required vars are missing", () => {
    expect(() => loadConfigFromEnv()).toThrow(ConfigurationError);
    try {
      loadConfigFromEnv();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigurationError);
      const configErr = err as ConfigurationError;
      expect(configErr.missingVars).toContain("FM_IdP_HOST");
      expect(configErr.missingVars).toContain("FM_IdP_DATABASE");
      expect(configErr.missingVars).toContain("FM_IdP_SERVICE_USERNAME");
      expect(configErr.missingVars).toContain("FM_IdP_SERVICE_PASSWORD");
    }
  });

  it("sets eventLogLayout when FM_IdP_EVENT_LOG_LAYOUT is provided", () => {
    setEnv({ ...REQUIRED_ENV, FM_IdP_EVENT_LOG_LAYOUT: "IdP_eventlog" });
    const config = loadConfigFromEnv();
    expect(config.eventLogLayout).toBe("IdP_eventlog");
  });

  it("leaves eventLogLayout undefined when FM_IdP_EVENT_LOG_LAYOUT is empty string", () => {
    setEnv({ ...REQUIRED_ENV, FM_IdP_EVENT_LOG_LAYOUT: "" });
    const config = loadConfigFromEnv();
    expect(config.eventLogLayout).toBeUndefined();
  });

  it("merges programmatic overrides (fetch)", () => {
    setEnv(REQUIRED_ENV);
    const customFetch = vi.fn() as unknown as typeof globalThis.fetch;
    const config = loadConfigFromEnv({ fetch: customFetch });
    expect(config.fetch).toBe(customFetch);
  });

  it("merges programmatic timeout override", () => {
    setEnv({ ...REQUIRED_ENV, FM_IdP_TIMEOUT: "8000" });
    const config = loadConfigFromEnv({ timeout: 3000 });
    // programmatic override wins
    expect(config.timeout).toBe(3000);
  });

  it("normalizes FM_IdP_HOST to lowercase", () => {
    setEnv({ ...REQUIRED_ENV, FM_IdP_HOST: "FM.Example.com" });
    const config = loadConfigFromEnv();
    expect(config.host).toBe("fm.example.com");
  });
});
