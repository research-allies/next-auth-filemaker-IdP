import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFileMakerProvider } from "../src/provider.js";
import {
  FileMakerAuthError,
  FileMakerQueryError,
  FileMakerIdPError,
} from "../src/errors.js";
import type { FileMakerIdPConfig } from "../src/types.js";

// Mock the filemaker-client module
vi.mock("../src/filemaker-client.js", () => ({
  fmLogin: vi.fn(),
  fmFindUserWithPrivileges: vi.fn(),
  fmLogout: vi.fn(),
  fmWriteEventLog: vi.fn().mockResolvedValue(undefined),
}));

import {
  fmLogin,
  fmFindUserWithPrivileges,
  fmLogout,
  fmWriteEventLog,
} from "../src/filemaker-client.js";

const mockFmLogin = vi.mocked(fmLogin);
const mockFmFindUser = vi.mocked(fmFindUserWithPrivileges);
const mockFmLogout = vi.mocked(fmLogout);
const mockFmWriteEventLog = vi.mocked(fmWriteEventLog);

const config: FileMakerIdPConfig = {
  host: "fm.example.com",
  database: "IdP_Accounts",
  useHttps: true,
  serviceUsername: "svc_user",
  servicePassword: "svc_pass",
  userLayout: "DAPI_USER",
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
};

const mockProfile = {
  id: "u001",
  userName: "jdoe",
  nameFirst: "John",
  nameLast: "Doe",
  email: "jdoe@example.com",
};

const mockProjects = [
  { projectId: "p1", projectName: "Monitor", roles: ["admin"] },
];

/**
 * Calls the `authorize` callback from the provider with given credentials.
 * In @auth/core, the real authorize is stored in `provider.options.authorize`
 * (the `provider.authorize` property is a stub that always returns null).
 */
async function callAuthorize(
  credentials: Record<string, string> | undefined
) {
  const provider = createFileMakerProvider(config);
  // @ts-expect-error — options is an internal @auth/core property
  const authorize = provider.options?.authorize ?? provider.authorize;
  return authorize(credentials, new Request("http://localhost"));
}

describe("createFileMakerProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFmLogout.mockResolvedValue(undefined);
  });

  it("returns FileMakerUser on full success", async () => {
    mockFmLogin
      .mockResolvedValueOnce("user_token")   // user login
      .mockResolvedValueOnce("svc_token");   // service login
    mockFmFindUser.mockResolvedValueOnce({
      profile: mockProfile,
      projects: mockProjects,
    });

    const result = await callAuthorize({ username: "jdoe", password: "pass" });

    expect(result).toEqual({
      ...mockProfile,
      projects: mockProjects,
    });
  });

  it("returns null when credentials are missing", async () => {
    expect(await callAuthorize(undefined)).toBeNull();
    expect(await callAuthorize({ username: "", password: "pass" })).toBeNull();
    expect(await callAuthorize({ username: "jdoe", password: "" })).toBeNull();
  });

  it("returns null on FileMakerAuthError (bad user credentials)", async () => {
    mockFmLogin.mockRejectedValueOnce(new FileMakerAuthError());

    const result = await callAuthorize({ username: "jdoe", password: "wrong" });
    expect(result).toBeNull();
    // Service login should NOT have been called
    expect(mockFmLogin).toHaveBeenCalledTimes(1);
  });

  it("returns null on generic error during user login", async () => {
    mockFmLogin.mockRejectedValueOnce(new FileMakerIdPError("server error"));

    const result = await callAuthorize({ username: "jdoe", password: "pass" });
    expect(result).toBeNull();
    expect(mockFmLogin).toHaveBeenCalledTimes(1);
  });

  it("discards user token (calls fmLogout) after user login", async () => {
    mockFmLogin
      .mockResolvedValueOnce("user_token")
      .mockResolvedValueOnce("svc_token");
    mockFmFindUser.mockResolvedValueOnce({
      profile: mockProfile,
      projects: mockProjects,
    });

    await callAuthorize({ username: "jdoe", password: "pass" });

    // fmLogout should be called with user_token (fire-and-forget)
    expect(mockFmLogout).toHaveBeenCalledWith(config, "user_token");
  });

  it("returns null when service account login fails", async () => {
    mockFmLogin
      .mockResolvedValueOnce("user_token")
      .mockRejectedValueOnce(new FileMakerAuthError("service account bad"));

    const result = await callAuthorize({ username: "jdoe", password: "pass" });
    expect(result).toBeNull();
    expect(mockFmFindUser).not.toHaveBeenCalled();
  });

  it("returns null when fmFindUserWithPrivileges fails", async () => {
    mockFmLogin
      .mockResolvedValueOnce("user_token")
      .mockResolvedValueOnce("svc_token");
    mockFmFindUser.mockRejectedValueOnce(
      new FileMakerQueryError("User not found")
    );

    const result = await callAuthorize({ username: "jdoe", password: "pass" });
    expect(result).toBeNull();
  });

  it("closes service session even when fmFindUserWithPrivileges fails", async () => {
    mockFmLogin
      .mockResolvedValueOnce("user_token")
      .mockResolvedValueOnce("svc_token");
    mockFmFindUser.mockRejectedValueOnce(new FileMakerQueryError("Not found"));

    await callAuthorize({ username: "jdoe", password: "pass" });

    expect(mockFmLogout).toHaveBeenCalledWith(config, "svc_token");
  });

  it("calls fmLogin with service credentials for profile lookup", async () => {
    mockFmLogin
      .mockResolvedValueOnce("user_token")
      .mockResolvedValueOnce("svc_token");
    mockFmFindUser.mockResolvedValueOnce({
      profile: mockProfile,
      projects: [],
    });

    await callAuthorize({ username: "jdoe", password: "pass" });

    expect(mockFmLogin).toHaveBeenNthCalledWith(2, config, "svc_user", "svc_pass");
    expect(mockFmFindUser).toHaveBeenCalledWith(config, "svc_token", "jdoe");
  });
});

// ─── fmWriteEventLog called on failure paths ──────────────────────────────────

describe("createFileMakerProvider — event logging on failure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFmLogout.mockResolvedValue(undefined);
    mockFmWriteEventLog.mockResolvedValue(undefined);
  });

  it("calls fmWriteEventLog with 'Invalid credentials' on FileMakerAuthError", async () => {
    mockFmLogin.mockRejectedValueOnce(new FileMakerAuthError());

    await callAuthorize({ username: "jdoe", password: "wrong" });

    expect(mockFmWriteEventLog).toHaveBeenCalledWith(config, {
      scriptName: "signInFailed",
      notes: "User jdoe sign in failed from IP undefined.",
      error: "Invalid credentials",
    });
  });

  it("calls fmWriteEventLog with 'Invalid credentials' on generic user login error", async () => {
    mockFmLogin.mockRejectedValueOnce(new FileMakerIdPError("server error"));

    await callAuthorize({ username: "jdoe", password: "pass" });

    expect(mockFmWriteEventLog).toHaveBeenCalledWith(config, {
      scriptName: "signInFailed",
      notes: "User jdoe sign in failed from IP undefined.",
      error: "Invalid credentials",
    });
  });

  it("calls fmWriteEventLog with 'Service account error' when service login fails", async () => {
    mockFmLogin
      .mockResolvedValueOnce("user_token")
      .mockRejectedValueOnce(new FileMakerAuthError("service bad"));

    await callAuthorize({ username: "jdoe", password: "pass" });

    expect(mockFmWriteEventLog).toHaveBeenCalledWith(config, {
      scriptName: "signInFailed",
      notes: "User jdoe sign in failed from IP undefined.",
      error: "Service account error",
    });
  });

  it("calls fmWriteEventLog with 'Profile lookup failed' when find fails", async () => {
    mockFmLogin
      .mockResolvedValueOnce("user_token")
      .mockResolvedValueOnce("svc_token");
    mockFmFindUser.mockRejectedValueOnce(new FileMakerQueryError("Not found"));

    await callAuthorize({ username: "jdoe", password: "pass" });

    expect(mockFmWriteEventLog).toHaveBeenCalledWith(config, {
      scriptName: "signInFailed",
      notes: "User jdoe sign in failed from IP undefined.",
      error: "Profile lookup failed",
    });
  });

  it("does not call fmWriteEventLog on success", async () => {
    mockFmLogin
      .mockResolvedValueOnce("user_token")
      .mockResolvedValueOnce("svc_token");
    mockFmFindUser.mockResolvedValueOnce({ profile: mockProfile, projects: mockProjects });

    await callAuthorize({ username: "jdoe", password: "pass" });

    expect(mockFmWriteEventLog).not.toHaveBeenCalled();
  });
});
