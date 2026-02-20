import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfigFromEnv } from "../src/env.js";
import { ConfigurationError } from "../src/errors.js";

const REQUIRED_ENV = {
  FM_HOST: "fm.example.com",
  FM_DATABASE: "IdP_Accounts",
  FM_SERVICE_USERNAME: "svc_user",
  FM_SERVICE_PASSWORD: "svc_pass",
};

function setEnv(vars: Record<string, string>) {
  for (const [k, v] of Object.entries(vars)) {
    process.env[k] = v;
  }
}

function clearEnv() {
  const ALL_VARS = [
    "FM_HOST",
    "FM_DATABASE",
    "FM_SERVICE_USERNAME",
    "FM_SERVICE_PASSWORD",
    "FM_USE_HTTPS",
    "FM_USER_LAYOUT",
    "FM_TIMEOUT",
    "FM_FIELD_ID_USER",
    "FM_FIELD_USERNAME",
    "FM_FIELD_NAME_FIRST",
    "FM_FIELD_NAME_LAST",
    "FM_FIELD_EMAIL",
    "FM_PORTAL_NAME",
    "FM_FIELD_PROJECT_ID",
    "FM_FIELD_PROJECT_NAME",
    "FM_FIELD_ROLE_NAME",
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
    expect(config.userLayout).toBe("DAPI_USER");
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
  });

  it("respects FM_USE_HTTPS=false", () => {
    setEnv({ ...REQUIRED_ENV, FM_USE_HTTPS: "false" });
    const config = loadConfigFromEnv();
    expect(config.useHttps).toBe(false);
  });

  it("respects custom FM_TIMEOUT", () => {
    setEnv({ ...REQUIRED_ENV, FM_TIMEOUT: "5000" });
    const config = loadConfigFromEnv();
    expect(config.timeout).toBe(5000);
  });

  it("respects custom field name overrides", () => {
    setEnv({
      ...REQUIRED_ENV,
      FM_USER_LAYOUT: "MY_USER_LAYOUT",
      FM_FIELD_ID_USER: "my_id",
      FM_FIELD_USERNAME: "myUserName",
      FM_PORTAL_NAME: "myPortal",
      FM_FIELD_PROJECT_ID: "proj::id",
      FM_FIELD_PROJECT_NAME: "proj::name",
      FM_FIELD_ROLE_NAME: "myRole::name",
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

  it("throws ConfigurationError when FM_HOST is missing", () => {
    setEnv({
      FM_DATABASE: "IdP_Accounts",
      FM_SERVICE_USERNAME: "svc",
      FM_SERVICE_PASSWORD: "pass",
    });
    expect(() => loadConfigFromEnv()).toThrow(ConfigurationError);
    expect(() => loadConfigFromEnv()).toThrow("FM_HOST");
  });

  it("throws ConfigurationError when multiple required vars are missing", () => {
    expect(() => loadConfigFromEnv()).toThrow(ConfigurationError);
    try {
      loadConfigFromEnv();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigurationError);
      const configErr = err as ConfigurationError;
      expect(configErr.missingVars).toContain("FM_HOST");
      expect(configErr.missingVars).toContain("FM_DATABASE");
      expect(configErr.missingVars).toContain("FM_SERVICE_USERNAME");
      expect(configErr.missingVars).toContain("FM_SERVICE_PASSWORD");
    }
  });

  it("merges programmatic overrides (fetch)", () => {
    setEnv(REQUIRED_ENV);
    const customFetch = vi.fn() as unknown as typeof globalThis.fetch;
    const config = loadConfigFromEnv({ fetch: customFetch });
    expect(config.fetch).toBe(customFetch);
  });

  it("merges programmatic timeout override", () => {
    setEnv({ ...REQUIRED_ENV, FM_TIMEOUT: "8000" });
    const config = loadConfigFromEnv({ timeout: 3000 });
    // programmatic override wins
    expect(config.timeout).toBe(3000);
  });
});
