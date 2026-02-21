import type { Session } from "next-auth";
import type { JWT } from "next-auth/jwt";
import type { FileMakerIdPConfig, FileMakerUser, ProjectAssignment } from "./types.js";
import { fmWriteEventLog } from "./filemaker-client.js";

/**
 * Augmented JWT shape used internally by this package.
 * `email` is intentionally not redeclared here — it is inherited from Auth.js's
 * JWT base type as `string | null | undefined`, which we coerce to string when
 * building the session.
 */
export interface FileMakerJWT extends JWT {
  id?: string;
  userName?: string;
  nameFirst?: string;
  nameLast?: string;
  projects?: ProjectAssignment[];
}

/**
 * Augmented Session shape exposed to the consuming app.
 */
export interface FileMakerSession extends Session {
  user: {
    id: string;
    userName: string;
    nameFirst: string;
    nameLast: string;
    email: string;
    projects: ProjectAssignment[];
  };
}

/**
 * Creates the JWT callback for Auth.js.
 *
 * On `signIn` (when `user` is present), copies identity and project/role
 * assignments from the FileMakerUser into the JWT token.
 * On subsequent calls, the token is returned unchanged.
 */
export function createJwtCallback() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return function jwt({ token, user }: { token: FileMakerJWT; user?: any }): FileMakerJWT {
    if (user) {
      const fmUser = user as FileMakerUser;
      token.id = fmUser.id;
      token.userName = fmUser.userName;
      token.nameFirst = fmUser.nameFirst;
      token.nameLast = fmUser.nameLast;
      token.email = fmUser.email;
      token.projects = fmUser.projects;
    }
    return token;
  };
}

/**
 * Creates the Session callback for Auth.js.
 *
 * Forwards identity fields and project/role assignments from the JWT token
 * to the session object exposed to client code.
 */
export function createSessionCallback() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return function session({ session, token }: { session: any; token: FileMakerJWT }): FileMakerSession {
    return {
      ...session,
      user: {
        id: token.id ?? "",
        userName: token.userName ?? "",
        nameFirst: token.nameFirst ?? "",
        nameLast: token.nameLast ?? "",
        email: token.email ?? "",
        projects: token.projects ?? [],
      },
    };
  };
}

/**
 * Creates Auth.js event handlers that write sign-in and sign-out events to
 * the FileMaker event log layout. No-op if `config.eventLogLayout` is unset.
 */
export function createEventHandlers(config: FileMakerIdPConfig) {
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    signIn({ user }: { user: any }) {
      const fmUser = user as FileMakerUser;
      void fmWriteEventLog(config, {
        scriptName: "signIn",
        foreignKeyId: fmUser?.id,
        notes: fmUser?.userName ? `User ${fmUser.userName} signed in.` : undefined,
      });
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    signOut(message: { session: any } | { token?: any }) {
      const fmToken = ("token" in message ? message.token : undefined) as FileMakerJWT | undefined;
      void fmWriteEventLog(config, {
        scriptName: "signOut",
        foreignKeyId: fmToken?.id,
        notes: fmToken?.userName ? `User ${fmToken.userName} signed out.` : undefined,
      });
    },
  };
}
