import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createJwtCallback,
  createSessionCallback,
  createEventHandlers,
} from "../src/callbacks.js";
import type { FileMakerJWT } from "../src/callbacks.js";
import type { FileMakerIdPConfig, ProjectAssignment } from "../src/types.js";

// Mock fmWriteEventLog so event handler tests don't make real FM calls
vi.mock("../src/filemaker-client.js", () => ({
  fmWriteEventLog: vi.fn().mockResolvedValue(undefined),
}));

import { fmWriteEventLog } from "../src/filemaker-client.js";
const mockFmWriteEventLog = vi.mocked(fmWriteEventLog);

const projects: ProjectAssignment[] = [
  { projectId: "p1", projectName: "Monitor", roles: ["admin", "editor"] },
  { projectId: "p2", projectName: "Design", roles: ["viewer"] },
];

const fmUser = {
  id: "u001",
  userName: "jdoe",
  nameFirst: "John",
  nameLast: "Doe",
  email: "jdoe@example.com",
  projects,
};

// ─── JWT Callback ──────────────────────────────────────────────────────────

describe("createJwtCallback", () => {
  it("populates token from user on signIn", () => {
    const jwt = createJwtCallback();
    const token = jwt({ token: {} as FileMakerJWT, user: fmUser });

    expect(token.id).toBe("u001");
    expect(token.userName).toBe("jdoe");
    expect(token.nameFirst).toBe("John");
    expect(token.nameLast).toBe("Doe");
    expect(token.email).toBe("jdoe@example.com");
    expect(token.projects).toEqual(projects);
  });

  it("returns token unchanged when no user (subsequent requests)", () => {
    const jwt = createJwtCallback();
    const existingToken: FileMakerJWT = {
      id: "u001",
      userName: "jdoe",
      nameFirst: "John",
      nameLast: "Doe",
      email: "jdoe@example.com",
      projects,
    };
    const result = jwt({ token: existingToken });

    expect(result).toEqual(existingToken);
  });

  it("preserves other token fields when user is present", () => {
    const jwt = createJwtCallback();
    const token = jwt({
      token: { sub: "auth-sub-123" } as FileMakerJWT,
      user: fmUser,
    });

    expect(token.sub).toBe("auth-sub-123");
    expect(token.id).toBe("u001");
  });
});

// ─── Session Callback ──────────────────────────────────────────────────────

describe("createSessionCallback", () => {
  const baseSession = {
    expires: "2030-01-01T00:00:00.000Z",
    user: { name: null, email: null, image: null },
  };

  it("populates session.user from JWT token", () => {
    const sessionCb = createSessionCallback();
    const token: FileMakerJWT = {
      id: "u001",
      userName: "jdoe",
      nameFirst: "John",
      nameLast: "Doe",
      email: "jdoe@example.com",
      projects,
    };

    const result = sessionCb({ session: baseSession, token });

    expect(result.user.id).toBe("u001");
    expect(result.user.userName).toBe("jdoe");
    expect(result.user.nameFirst).toBe("John");
    expect(result.user.nameLast).toBe("Doe");
    expect(result.user.email).toBe("jdoe@example.com");
    expect(result.user.projects).toEqual(projects);
  });

  it("preserves session.expires", () => {
    const sessionCb = createSessionCallback();
    const token: FileMakerJWT = {
      id: "u001",
      userName: "jdoe",
      nameFirst: "John",
      nameLast: "Doe",
      email: "jdoe@example.com",
      projects: [],
    };

    const result = sessionCb({ session: baseSession, token });
    expect(result.expires).toBe("2030-01-01T00:00:00.000Z");
  });

  it("uses empty defaults when token fields are missing", () => {
    const sessionCb = createSessionCallback();
    const result = sessionCb({
      session: baseSession,
      token: {} as FileMakerJWT,
    });

    expect(result.user.id).toBe("");
    expect(result.user.userName).toBe("");
    expect(result.user.projects).toEqual([]);
  });
});

// ─── createEventHandlers ───────────────────────────────────────────────────

const eventConfig: FileMakerIdPConfig = {
  host: "fm.example.com",
  database: "IdP_Accounts",
  useHttps: true,
  serviceUsername: "svc",
  servicePassword: "svc_pass",
  userLayout: "DAPI_USER",
  timeout: 5000,
  eventLogLayout: "DAPI_EVENTLOG",
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

describe("createEventHandlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("signIn calls fmWriteEventLog with user ID and notes (no PII in detail)", () => {
    const { signIn } = createEventHandlers(eventConfig);
    signIn({ user: fmUser });

    expect(mockFmWriteEventLog).toHaveBeenCalledWith(eventConfig, {
      scriptName: "signIn",
      foreignKeyId: "u001",
      notes: "User jdoe signed in.",
    });
  });

  it("signOut calls fmWriteEventLog with username in notes", () => {
    const { signOut } = createEventHandlers(eventConfig);
    signOut({ token: { id: "u001", userName: "jdoe" } });

    expect(mockFmWriteEventLog).toHaveBeenCalledWith(eventConfig, {
      scriptName: "signOut",
      foreignKeyId: "u001",
      notes: "User jdoe signed out.",
    });
  });

  it("signOut handles missing token gracefully", () => {
    const { signOut } = createEventHandlers(eventConfig);
    signOut({ token: undefined });

    expect(mockFmWriteEventLog).toHaveBeenCalledWith(eventConfig, {
      scriptName: "signOut",
      foreignKeyId: undefined,
      notes: undefined,
    });
  });
});
