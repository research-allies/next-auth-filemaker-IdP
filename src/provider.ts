import Credentials from "next-auth/providers/credentials";
import type { FileMakerIdPConfig, FileMakerUser } from "./types.js";
import { fmLogin, fmFindUserWithPrivileges, fmLogout } from "./filemaker-client.js";
import { FileMakerAuthError } from "./errors.js";

/**
 * Creates a configured Auth.js v5 Credentials provider that authenticates
 * users against FileMaker Server.
 *
 * Auth flow:
 * 1. Validate user credentials + open service session in parallel
 * 2. Discard user token (identity validated), keep service token
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

      const user = String(username);
      const pass = String(password);

      // Step 1: Validate user credentials + open service session in parallel
      const [userResult, serviceResult] = await Promise.allSettled([
        fmLogin(config, user, pass),
        fmLogin(config, config.serviceUsername, config.servicePassword),
      ]);

      // If user login failed, clean up any service token and bail
      if (userResult.status === "rejected") {
        if (!(userResult.reason instanceof FileMakerAuthError)) {
          console.error(
            "[next-auth-filemaker-idp] User credential validation failed:",
            userResult.reason
          );
        }
        const svcToken = serviceResult.status === "fulfilled" ? serviceResult.value : undefined;
        if (svcToken) void fmLogout(config, svcToken);
        return null;
      }

      // Discard user token immediately — we only needed it to validate identity
      void fmLogout(config, userResult.value);

      // If service login failed, bail
      if (serviceResult.status === "rejected") {
        console.error(
          "[next-auth-filemaker-idp] Service account login failed:",
          serviceResult.reason
        );
        return null;
      }

      const serviceToken = serviceResult.value;

      // Steps 3–4: Find user profile + portal data, then close service session
      try {
        const { profile, projects } = await fmFindUserWithPrivileges(
          config,
          serviceToken,
          user
        );
        void fmLogout(config, serviceToken);
        return { ...profile, projects };
      } catch (err) {
        console.error(
          "[next-auth-filemaker-idp] User profile lookup failed:",
          err
        );
        void fmLogout(config, serviceToken);
        return null;
      }
    },
  });
}
