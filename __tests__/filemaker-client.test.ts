import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  fmLogin,
  fmFindUserWithPrivileges,
  fmLogout,
} from "../src/filemaker-client.js";
import {
  FileMakerAuthError,
  FileMakerQueryError,
  FileMakerIdPError,
} from "../src/errors.js";
import type { FileMakerIdPConfig } from "../src/types.js";

const baseConfig: FileMakerIdPConfig = {
  host: "fm.example.com",
  database: "IdP_Accounts",
  useHttps: true,
  serviceUsername: "svc",
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

function makeFetch(status: number, body: unknown): typeof globalThis.fetch {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }) as unknown as typeof globalThis.fetch;
}

// ─── fmLogin ─────────────────────────────────────────────────────────────────

describe("fmLogin", () => {
  it("returns token on success", async () => {
    const config = {
      ...baseConfig,
      fetch: makeFetch(200, { response: { token: "abc123" }, messages: [] }),
    };
    const token = await fmLogin(config, "user", "pass");
    expect(token).toBe("abc123");
  });

  it("throws FileMakerAuthError on 401", async () => {
    const config = {
      ...baseConfig,
      fetch: makeFetch(401, { messages: [{ code: "212", message: "Invalid user account and/or password" }] }),
    };
    await expect(fmLogin(config, "user", "bad")).rejects.toThrow(
      FileMakerAuthError
    );
  });

  it("throws FileMakerIdPError on non-401 HTTP error", async () => {
    const config = {
      ...baseConfig,
      fetch: makeFetch(500, {}),
    };
    await expect(fmLogin(config, "user", "pass")).rejects.toThrow(
      FileMakerIdPError
    );
  });

  it("throws FileMakerIdPError when response has no token", async () => {
    const config = {
      ...baseConfig,
      fetch: makeFetch(200, { response: {}, messages: [] }),
    };
    await expect(fmLogin(config, "user", "pass")).rejects.toThrow(
      FileMakerIdPError
    );
  });

  it("throws FileMakerIdPError on network failure", async () => {
    const config = {
      ...baseConfig,
      fetch: vi.fn().mockRejectedValue(new Error("Network down")) as unknown as typeof globalThis.fetch,
    };
    await expect(fmLogin(config, "user", "pass")).rejects.toThrow(
      FileMakerIdPError
    );
  });

  it("calls the correct URL and headers", async () => {
    const mockFetch = makeFetch(200, { response: { token: "tok" }, messages: [] });
    const config = { ...baseConfig, fetch: mockFetch };
    await fmLogin(config, "myUser", "myPass");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://fm.example.com/fmi/data/vLatest/databases/IdP_Accounts/sessions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: expect.stringMatching(/^Basic /),
        }),
      })
    );
  });
});

// ─── fmFindUserWithPrivileges ─────────────────────────────────────────────────

const userRecord = {
  fieldData: {
    id_user: "u001",
    userName: "jdoe",
    nameFirst: "John",
    nameLast: "Doe",
    email: "jdoe@example.com",
  },
  portalData: {
    userProjectRole: [
      {
        "project::id_project": "p1",
        "project::projectName": "Monitor",
        "role::roleName": "admin",
      },
      {
        "project::id_project": "p1",
        "project::projectName": "Monitor",
        "role::roleName": "editor",
      },
      {
        "project::id_project": "p2",
        "project::projectName": "Design",
        "role::roleName": "viewer",
      },
    ],
  },
};

describe("fmFindUserWithPrivileges", () => {
  it("returns profile and projects on success", async () => {
    const config = {
      ...baseConfig,
      fetch: makeFetch(200, {
        response: { data: [userRecord] },
        messages: [],
      }),
    };
    const result = await fmFindUserWithPrivileges(config, "tok", "jdoe");

    expect(result.profile).toEqual({
      id: "u001",
      userName: "jdoe",
      nameFirst: "John",
      nameLast: "Doe",
      email: "jdoe@example.com",
    });

    expect(result.projects).toHaveLength(2);
    expect(result.projects[0]).toMatchObject({
      projectId: "p1",
      projectName: "Monitor",
      roles: ["admin", "editor"],
    });
    expect(result.projects[1]).toMatchObject({
      projectId: "p2",
      projectName: "Design",
      roles: ["viewer"],
    });
  });

  it("returns empty projects array when user has no portal rows", async () => {
    const recordNoPortal = {
      fieldData: userRecord.fieldData,
      portalData: { userProjectRole: [] },
    };
    const config = {
      ...baseConfig,
      fetch: makeFetch(200, {
        response: { data: [recordNoPortal] },
        messages: [],
      }),
    };
    const result = await fmFindUserWithPrivileges(config, "tok", "jdoe");
    expect(result.projects).toEqual([]);
  });

  it("throws FileMakerQueryError when FM returns error code 401 (no records)", async () => {
    const config = {
      ...baseConfig,
      fetch: makeFetch(500, {
        messages: [{ code: "401", message: "No records match the request" }],
      }),
    };
    await expect(
      fmFindUserWithPrivileges(config, "tok", "ghost")
    ).rejects.toThrow(FileMakerQueryError);
  });

  it("throws FileMakerQueryError on empty data array", async () => {
    const config = {
      ...baseConfig,
      fetch: makeFetch(200, { response: { data: [] }, messages: [] }),
    };
    await expect(
      fmFindUserWithPrivileges(config, "tok", "jdoe")
    ).rejects.toThrow(FileMakerQueryError);
  });

  it("throws FileMakerQueryError on non-401 HTTP error without FM code", async () => {
    const config = {
      ...baseConfig,
      fetch: makeFetch(503, { messages: [] }),
    };
    await expect(
      fmFindUserWithPrivileges(config, "tok", "jdoe")
    ).rejects.toThrow(FileMakerQueryError);
  });

  it("throws FileMakerQueryError on network failure", async () => {
    const config = {
      ...baseConfig,
      fetch: vi.fn().mockRejectedValue(new Error("timeout")) as unknown as typeof globalThis.fetch,
    };
    await expect(
      fmFindUserWithPrivileges(config, "tok", "jdoe")
    ).rejects.toThrow(FileMakerQueryError);
  });

  it("calls the correct layout URL", async () => {
    const mockFetch = makeFetch(200, { response: { data: [userRecord] }, messages: [] });
    const config = { ...baseConfig, fetch: mockFetch };
    await fmFindUserWithPrivileges(config, "myToken", "jdoe");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://fm.example.com/fmi/data/vLatest/databases/IdP_Accounts/layouts/DAPI_USER/_find",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer myToken",
        }),
      })
    );
  });
});

// ─── fmLogout ─────────────────────────────────────────────────────────────────

describe("fmLogout", () => {
  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("resolves without throwing on success", async () => {
    const config = {
      ...baseConfig,
      fetch: makeFetch(200, { response: {}, messages: [] }),
    };
    await expect(fmLogout(config, "tok")).resolves.toBeUndefined();
  });

  it("does not throw on HTTP error — warns instead", async () => {
    const config = {
      ...baseConfig,
      fetch: makeFetch(404, {}),
    };
    await expect(fmLogout(config, "tok")).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalled();
  });

  it("does not throw on network error — warns instead", async () => {
    const config = {
      ...baseConfig,
      fetch: vi.fn().mockRejectedValue(new Error("network down")) as unknown as typeof globalThis.fetch,
    };
    await expect(fmLogout(config, "tok")).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalled();
  });

  it("calls the correct DELETE URL with token", async () => {
    const mockFetch = makeFetch(200, {});
    const config = { ...baseConfig, fetch: mockFetch };
    await fmLogout(config, "mySession123");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://fm.example.com/fmi/data/vLatest/databases/IdP_Accounts/sessions/mySession123",
      expect.objectContaining({ method: "DELETE" })
    );
  });
});
