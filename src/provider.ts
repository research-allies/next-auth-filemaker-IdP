import Credentials from "next-auth/providers/credentials";
import type { FileMakerIdPConfig, FileMakerUser } from "./types.js";
import { fmLogin, fmFindUserWithPrivileges, fmLogout } from "./filemaker-client.js";
import { FileMakerAuthError } from "./errors.js";

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
    async authorize(credentials): Promise<FileMakerUser | null> {
      const username = credentials?.username;
      const password = credentials?.password;

      if (!username || !password) {
        return null;
      }

      // Step 1: Validate user credentials (token is immediately discarded)
      let userToken: string;
      try {
        userToken = await fmLogin(config, String(username), String(password));
      } catch (err) {
        if (err instanceof FileMakerAuthError) {
          return null;
        }
        console.error(
          "[next-auth-filemaker-idp] User credential validation failed:",
          err
        );
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
        return null;
      } finally {
        // Always close service session regardless of find success/failure
        void fmLogout(config, serviceToken);
      }

      return user;
    },
  });
}
