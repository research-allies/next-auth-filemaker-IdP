import type { FileMakerIdPConfig, ProjectAssignment } from "./types.js";
import {
  FileMakerAuthError,
  FileMakerQueryError,
  FileMakerIdPError,
} from "./errors.js";
import {
  encodeBasicAuth,
  buildDataApiBaseUrl,
  getFetch,
} from "./utils.js";

interface FmSessionResponse {
  response: {
    token: string;
  };
  messages: Array<{ code: string; message: string }>;
}

interface FmPortalRow {
  [key: string]: string | number;
}

interface FmRecord {
  fieldData: Record<string, string | number>;
  portalData: Record<string, FmPortalRow[]>;
}

interface FmFindResponse {
  response: {
    data: FmRecord[];
  };
  messages: Array<{ code: string; message: string }>;
}

interface UserProfile {
  id: string;
  userName: string;
  nameFirst: string;
  nameLast: string;
  email: string;
}

/**
 * Authenticates a user against FileMaker Server via the Data API sessions endpoint.
 * Returns the session token on success.
 *
 * @throws {FileMakerAuthError} on HTTP 401 (invalid credentials)
 * @throws {FileMakerIdPError} on network errors or unexpected responses
 */
export async function fmLogin(
  config: FileMakerIdPConfig,
  username: string,
  password: string
): Promise<string> {
  const baseUrl = buildDataApiBaseUrl(config);
  const fetchFn = getFetch(config);
  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), config.timeout);

  try {
    const response = await fetchFn(`${baseUrl}/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${encodeBasicAuth(username, password)}`,
      },
      body: JSON.stringify({}),
      signal: controller.signal,
    });

    if (response.status === 401) {
      throw new FileMakerAuthError("Invalid FileMaker credentials");
    }

    if (!response.ok) {
      throw new FileMakerIdPError(
        `FileMaker login failed with HTTP ${response.status}`
      );
    }

    const data = (await response.json()) as FmSessionResponse;
    const token = data?.response?.token;

    if (!token) {
      throw new FileMakerIdPError(
        "FileMaker login response did not include a session token"
      );
    }

    return token;
  } catch (err) {
    if (err instanceof FileMakerAuthError || err instanceof FileMakerIdPError) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new FileMakerIdPError(`FileMaker login network error: ${message}`);
  } finally {
    clearTimeout(timerId);
  }
}

/**
 * Finds a user record on the configured layout and returns their profile
 * along with project/role assignments from the portal.
 *
 * @throws {FileMakerQueryError} if the user is not found or the query fails
 */
export async function fmFindUserWithPrivileges(
  config: FileMakerIdPConfig,
  token: string,
  username: string
): Promise<{ profile: UserProfile; projects: ProjectAssignment[] }> {
  const baseUrl = buildDataApiBaseUrl(config);
  const fetchFn = getFetch(config);
  const { fields } = config;
  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), config.timeout);

  try {
    const response = await fetchFn(
      `${baseUrl}/layouts/${encodeURIComponent(config.userLayout)}/_find`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          query: [{ [fields.usernameField]: `=${username}` }],
          portal: [fields.portalName],
        }),
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      const errorData = (await response.json().catch(() => null)) as {
        messages?: Array<{ code: string; message: string }>;
      } | null;
      const fmCode = errorData?.messages?.[0]?.code;
      // FM error 401 = "No records match the request"
      if (fmCode === "401") {
        throw new FileMakerQueryError(
          `No user found with username: ${username}`,
          response.status
        );
      }
      throw new FileMakerQueryError(
        `FileMaker find failed with HTTP ${response.status}`,
        response.status
      );
    }

    const data = (await response.json()) as FmFindResponse;
    const records = data?.response?.data;

    if (!records || records.length === 0) {
      throw new FileMakerQueryError(`No user found with username: ${username}`);
    }

    const record = records[0];
    const fieldData = record.fieldData;

    const profile: UserProfile = {
      id: String(fieldData[fields.idUserField] ?? ""),
      userName: String(fieldData[fields.usernameField] ?? ""),
      nameFirst: String(fieldData[fields.nameFirstField] ?? ""),
      nameLast: String(fieldData[fields.nameLastField] ?? ""),
      email: String(fieldData[fields.emailField] ?? ""),
    };

    const portalRows: FmPortalRow[] =
      record.portalData?.[fields.portalName] ?? [];

    // Group portal rows by projectId, collecting all roles per project
    const projectMap = new Map<string, ProjectAssignment>();
    for (const row of portalRows) {
      const projectId = String(row[fields.projectIdField] ?? "");
      const projectName = String(row[fields.projectNameField] ?? "");
      const roleName = String(row[fields.roleNameField] ?? "");

      if (!projectId) continue;

      if (!projectMap.has(projectId)) {
        projectMap.set(projectId, { projectId, projectName, roles: [] });
      }
      if (roleName) {
        projectMap.get(projectId)!.roles.push(roleName);
      }
    }

    return {
      profile,
      projects: Array.from(projectMap.values()),
    };
  } catch (err) {
    if (
      err instanceof FileMakerQueryError ||
      err instanceof FileMakerIdPError
    ) {
      throw err;
    }
    const message = err instanceof Error ? err.message : String(err);
    throw new FileMakerQueryError(
      `FileMaker find user network error: ${message}`
    );
  } finally {
    clearTimeout(timerId);
  }
}

/**
 * Closes a FileMaker Data API session.
 * Fire-and-forget: logs warnings on failure but never throws.
 */
export async function fmLogout(
  config: FileMakerIdPConfig,
  token: string
): Promise<void> {
  const baseUrl = buildDataApiBaseUrl(config);
  const fetchFn = getFetch(config);
  const controller = new AbortController();
  const timerId = setTimeout(() => controller.abort(), config.timeout);

  try {
    const response = await fetchFn(`${baseUrl}/sessions/${token}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      console.warn(
        `[next-auth-filemaker-idp] fmLogout: HTTP ${response.status} — session may have already expired`
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[next-auth-filemaker-idp] fmLogout: failed to close session — ${message}`
    );
  } finally {
    clearTimeout(timerId);
  }
}
