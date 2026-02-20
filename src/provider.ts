import Credentials from "next-auth/providers/credentials";
import type { FileMakerIdPConfig, FileMakerUser } from "./types.js";
import { fmLogin, fmFindUserWithPrivileges, fmLogout, fmWriteEventLog } from "./filemaker-client.js";
import { FileMakerAuthError } from "./errors.js";

/** Truncate and strip control characters for safe log interpolation. */
function safeLogValue(value: string, maxLength = 20): string {
  return value.slice(0, maxLength).replace(/[\x00-\x1f]/g, "");
}

/**
 * Creates a configured Auth.js v5 Credentials provider that authenticates
 * users against FileMaker Server.
 *
 * Auth flow:
 * 1. Validate user credentials via fmLogin (token immediately discarded)
 * 2. Open a service session for profile/privilege lookup
 * 3. Find user profile + portal data (project/role assignments)
 * 4. Close service session (fire-and-forget)
 * 5. Return FileMakerUser (identity + projects only — no FM token)
 *
 * @param config - FileMaker IdP configuration
 * @param options - Optional overrides (e.g. `{ id: "filemaker-2" }` for multi-server setups)
 */
export function createFileMakerProvider(
  config: FileMakerIdPConfig,
  options?: { id?: string },
) {
  const providerId = options?.id ?? "filemaker";
  return Credentials({
    id: providerId,
    name: "FileMaker",
    credentials: {
      username: { label: "Username", type: "text" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials, request): Promise<FileMakerUser | null> {
      const username = credentials?.username;
      const password = credentials?.password;

      if (!username || !password) {
        return null;
      }

      const clientIp =
        (request as Request | undefined)?.headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ??
        (request as Request | undefined)?.headers?.get("x-real-ip") ??
        undefined;

      // Step 1: Validate user credentials (token is immediately discarded)
      let userToken: string;
      try {
        userToken = await fmLogin(config, String(username), String(password));
      } catch (err) {
        if (err instanceof FileMakerAuthError) {
          void fmWriteEventLog(config, { scriptName: "signInFailed", notes: `User ${safeLogValue(String(username))} sign in failed from reported IP ${clientIp}.`, error: "Invalid credentials" });
          return null;
        }
        console.error(
          "[next-auth-filemaker-idp] User credential validation failed:",
          err
        );
        void fmWriteEventLog(config, { scriptName: "signInFailed", notes: `User ${safeLogValue(String(username))} sign in failed from reported IP ${clientIp}.`, error: "Invalid credentials" });
        return null;
      }

      // Discard user token immediately — we only needed it to validate identity
      void fmLogout(config, userToken);

      // Step 2: Open service session for profile/privilege lookup
      let serviceToken: string;
      try {
        serviceToken = await fmLogin(
          config,
          config.serviceUsername,
          config.servicePassword
        );
      } catch (err) {
        console.error(
          "[next-auth-filemaker-idp] Service account login failed:",
          err
        );
        void fmWriteEventLog(config, { scriptName: "signInFailed", notes: `User ${safeLogValue(String(username))} sign in failed from reported IP ${clientIp}.`, error: "Service account error" });
        return null;
      }

      // Steps 3–4: Find user profile + portal data, then close service session
      let user: FileMakerUser;
      try {
        const { profile, projects } = await fmFindUserWithPrivileges(
          config,
          serviceToken,
          String(username)
        );
        user = { ...profile, projects };
      } catch (err) {
        console.error(
          "[next-auth-filemaker-idp] User profile lookup failed:",
          err
        );
        void fmWriteEventLog(config, { scriptName: "signInFailed", notes: `User ${safeLogValue(String(username))} sign in failed from reported IP ${clientIp}.`, error: "Profile lookup failed" });
        return null;
      } finally {
        // Always close service session regardless of find success/failure
        void fmLogout(config, serviceToken);
      }

      return user;
    },
  });
}
