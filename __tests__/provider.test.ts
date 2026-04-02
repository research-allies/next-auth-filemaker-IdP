import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFileMakerProvider } from "../src/provider.js";
import {
  FileMakerAuthError,
  FileMakerQueryError,
  FileMakerIdPError,
} from "../src/errors.js";
import { baseConfig as config } from "./helpers/config.js";

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
} from "../src/filemaker-client.js";

const mockFmLogin = vi.mocked(fmLogin);
const mockFmFindUser = vi.mocked(fmFindUserWithPrivileges);
const mockFmLogout = vi.mocked(fmLogout);

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
  if (typeof authorize !== "function") {
    throw new Error(
      "Could not resolve authorize from provider — @auth/core internals may have changed"
    );
  }
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
    mockFmLogin
      .mockRejectedValueOnce(new FileMakerAuthError())  // user login
      .mockResolvedValueOnce("svc_token");               // service login (parallel)

    const result = await callAuthorize({ username: "jdoe", password: "wrong" });
    expect(result).toBeNull();
    // Both logins fire in parallel, so fmLogin is called twice
    expect(mockFmLogin).toHaveBeenCalledTimes(2);
    // Service token should be cleaned up
    expect(mockFmLogout).toHaveBeenCalledWith(config, "svc_token");
  });

  it("returns null on generic error during user login", async () => {
    mockFmLogin
      .mockRejectedValueOnce(new FileMakerIdPError("server error"))  // user login
      .mockResolvedValueOnce("svc_token");                            // service login (parallel)

    const result = await callAuthorize({ username: "jdoe", password: "pass" });
    expect(result).toBeNull();
    expect(mockFmLogin).toHaveBeenCalledTimes(2);
    expect(mockFmLogout).toHaveBeenCalledWith(config, "svc_token");
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
