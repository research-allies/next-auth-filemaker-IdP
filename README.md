# @research-allies/next-auth-filemaker-idp

Auth.js v5 Credentials provider for authenticating users against an on-premises FileMaker Server. Published to GitHub Packages, consumed by multiple NextJS apps.

## How it works

1. User submits credentials → FileMaker Data API validates them (session token immediately discarded)
2. A backend service account opens a session and fetches the user's profile + project/role assignments from the `DAPI_USER` layout (with `userProjectRole` portal)
3. The service session is closed
4. A JWT is issued containing identity fields and `projects: ProjectAssignment[]` — no FileMaker tokens ever stored in the JWT
5. Authentication events (sign-in, sign-out, failed sign-in) are written to the `DAPI_EVENTLOG` layout in FileMaker, providing a server-side audit trail — opt-in via `FM_IdP_EVENT_LOG_LAYOUT`

## FileMaker files

| Filename | Description |
|---|---|
| `IdP_Accounts.fmp12` | Manages identities, projects, and role assignments |
| `IdP_File1.fmp12` | Sample solution file that receives distributed FileMaker accounts |

| FileMaker files username | Password | Note |
|---|---|---|
| admin | admin883 | * |
| acct_dapi | acct_dapi | * |

* defaults only and must be changed before deploying to production.


The `IdP_Accounts.fmp12` database has four tables: `user`, `project`, `role`, and `userProjectRole` (join). All privilege sets assigned to users must have the `FM_DAPI` extended privilege enabled.

---

## Installation

Add a `.npmrc` to your consuming app's root so npm knows to fetch `@research-allies` packages from GitHub Packages:

```
@research-allies:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

Then install:

```bash
npm install @research-allies/next-auth-filemaker-idp
```

---

## Setup

### 1. Environment variables

Copy `.env.example` (shipped with the package) into your app's `.env.local`:

```bash
# Required
FM_IdP_HOST=your-filemaker-server.com
FM_IdP_DATABASE=IdP_Accounts
FM_IdP_SERVICE_USERNAME=acct_dapi
FM_IdP_SERVICE_PASSWORD=<service-account-password>
AUTH_SECRET=<random-secret>           # generate: openssl rand -base64 32

# Optional — defaults shown
FM_IdP_USE_HTTPS=true
FM_IdP_USER_LAYOUT=DAPI_USER
FM_IdP_TIMEOUT=10000
# FM_IdP_EVENT_LOG_LAYOUT=DAPI_EVENTLOG   # omit or leave blank to disable event logging

# Field names — only set if your schema differs from the defaults
FM_IdP_FIELD_ID_USER=id_user
FM_IdP_FIELD_USERNAME=userName
FM_IdP_FIELD_NAME_FIRST=nameFirst
FM_IdP_FIELD_NAME_LAST=nameLast
FM_IdP_FIELD_EMAIL=email
FM_IdP_PORTAL_NAME=userProjectRole
FM_IdP_FIELD_PROJECT_ID=project::id_project
FM_IdP_FIELD_PROJECT_NAME=project::projectName
FM_IdP_FIELD_ROLE_NAME=role::roleName
```

### 2. `auth.ts`

#### Next.js 16+ (recommended)

Since `proxy.ts` in Next.js 16 runs on the Node.js runtime (not the edge), everything can live in a single file:

```typescript
// src/auth.ts
import NextAuth from "next-auth";
import {
  loadConfigFromEnv,
  createFileMakerProvider,
  createJwtCallback,
  createSessionCallback,
  createEventHandlers,
} from "@research-allies/next-auth-filemaker-idp";

const fmConfig = loadConfigFromEnv();

export const { auth, handlers, signIn, signOut } = NextAuth({
  pages: { signIn: "/login" },
  providers: [createFileMakerProvider(fmConfig)],
  callbacks: {
    authorized({ auth }) {
      return !!auth?.user;
    },
    jwt: createJwtCallback(),
    session: createSessionCallback(),
  },
  events: createEventHandlers(fmConfig),
  session: { strategy: "jwt", maxAge: 60 * 60, updateAge: 5 * 60 },
});
```

#### Next.js 15 and earlier

Middleware runs on the edge runtime in Next.js 15, so you need to split the config into two files:

```typescript
// src/auth.config.ts — edge-safe, no Node.js APIs
import type { NextAuthConfig } from "next-auth";

export const authConfig = {
  pages: { signIn: "/login" },
  callbacks: {
    authorized({ auth }) {
      return !!auth?.user;
    },
  },
  providers: [],
} satisfies NextAuthConfig;
```

```typescript
// src/auth.ts
import NextAuth from "next-auth";
import {
  loadConfigFromEnv,
  createFileMakerProvider,
  createJwtCallback,
  createSessionCallback,
  createEventHandlers,
} from "@research-allies/next-auth-filemaker-idp";
import { authConfig } from "@/auth.config";

const fmConfig = loadConfigFromEnv();

export const { auth, handlers, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [createFileMakerProvider(fmConfig)],
  callbacks: {
    ...authConfig.callbacks,   // preserves the `authorized` callback from auth.config.ts
    jwt: createJwtCallback(),
    session: createSessionCallback(),
  },
  events: createEventHandlers(fmConfig),
  session: { strategy: "jwt", maxAge: 60 * 60, updateAge: 5 * 60 },
});
```

> **Warning (Next.js 15):** Always spread `...authConfig.callbacks` before adding `jwt` and `session`. Omitting the spread silently drops the `authorized` callback, causing an infinite redirect loop to `/login`.

> **Security:** `loadConfigFromEnv()` reads service account credentials from `process.env`. Only call it in server-side code — never in a `"use client"` component.

> **Event logging:** `createEventHandlers` is a no-op when `FM_IdP_EVENT_LOG_LAYOUT` is not set — safe to include in all configurations.

### 3. API route handler

```typescript
// app/api/auth/[...nextauth]/route.ts
import { handlers } from "@/auth";
export const { GET, POST } = handlers;
```

### 4. TypeScript augmentation

Create `types/next-auth.d.ts` in your app to extend Auth.js types with the FileMaker user shape:

```typescript
import { DefaultSession } from "next-auth";
import { ProjectAssignment } from "@research-allies/next-auth-filemaker-idp";

declare module "next-auth" {
  interface User {
    userName: string;
    nameFirst: string;
    nameLast: string;
    projects: ProjectAssignment[];
  }

  interface Session {
    user: {
      id: string;
      userName: string;
      nameFirst: string;
      nameLast: string;
      projects: ProjectAssignment[];
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    userName?: string;
    nameFirst?: string;
    nameLast?: string;
    projects?: ProjectAssignment[];
  }
}
```

---

## Login page

### Option A: Use the included component

The page itself can remain a Server Component — `FileMakerLoginForm` already declares its own `"use client"` boundary:

```typescript
// app/login/page.tsx
import { FileMakerLoginForm } from "@research-allies/next-auth-filemaker-idp/client";

export default function LoginPage() {
  return <FileMakerLoginForm callbackUrl="/dashboard" />;
}
```

Props: `providerId?: string`, `callbackUrl?: string`, `className?: string`, `onError?: (error: string) => void`

> **Why `/client`?** `FileMakerLoginForm` uses React hooks and is published under the `./client` subpath export so bundlers can correctly resolve the `"use client"` boundary. Importing from the main package path will cause a Server Component error.

### Option B: Custom form

```typescript
// app/login/page.tsx
"use client";
import { signIn } from "next-auth/react";
import { useState } from "react";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await signIn("filemaker", { username, password, callbackUrl: "/dashboard" });
  }

  return (
    <form onSubmit={handleSubmit}>
      <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" />
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
      <button type="submit">Sign in</button>
    </form>
  );
}
```

---

## Protecting routes

### Next.js 16+: `proxy.ts`

```typescript
// src/proxy.ts
import { auth } from "@/auth";

export default auth;

export const config = {
  matcher: [
    // Protect all paths except auth endpoints, login, and static assets
    "/((?!api/auth|login|_next/static|_next/image|favicon.ico).*)",
  ],
};
```

> **Warning:** Always import `auth` from your own `@/auth` module. Never create a separate NextAuth instance in `proxy.ts` (e.g. `export default NextAuth(config).auth`) — this produces a second instance with a different JWT signing context, causing silent signature mismatches and an infinite redirect loop to `/login`.

### Next.js 15 and earlier: `middleware.ts`

```typescript
// src/middleware.ts
import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

export default NextAuth(authConfig).auth;

export const config = {
  matcher: ["/dashboard/:path*"],
};
```

### Checking project-level roles in server components

```typescript
import { auth } from "@/auth";

export default async function AdminPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const session = await auth();
  const project = session?.user.projects.find((p) => p.projectId === projectId);

  if (!project?.roles.includes("admin")) return <p>Access denied</p>;

  return <div>Admin content</div>;
}
```

---

## Environment variables reference

| Variable | Required | Default | Description |
|---|---|---|---|
| `FM_IdP_HOST` | ✅ | — | FileMaker Server hostname |
| `FM_IdP_DATABASE` | ✅ | — | Database name |
| `FM_IdP_SERVICE_USERNAME` | ✅ | — | Service account for profile queries |
| `FM_IdP_SERVICE_PASSWORD` | ✅ | — | Service account password |
| `AUTH_SECRET` | ✅ | — | Auth.js encryption secret (standard NextAuth env var) |
| `FM_IdP_USE_HTTPS` | | `true` | Use HTTPS for Data API calls |
| `FM_IdP_USER_LAYOUT` | | `DAPI_USER` | Layout name for user profile + portal |
| `FM_IdP_TIMEOUT` | | `10000` | Request timeout in ms |
| `FM_IdP_EVENT_LOG_LAYOUT` | | *(disabled)* | Layout name for auth event log writes; omit or leave blank to disable |
| `FM_IdP_FIELD_ID_USER` | | `id_user` | User table PK field |
| `FM_IdP_FIELD_USERNAME` | | `userName` | Username field (used for Find queries) |
| `FM_IdP_FIELD_NAME_FIRST` | | `nameFirst` | First name field |
| `FM_IdP_FIELD_NAME_LAST` | | `nameLast` | Last name field |
| `FM_IdP_FIELD_EMAIL` | | `email` | Email field |
| `FM_IdP_PORTAL_NAME` | | `userProjectRole` | Portal name on the user layout |
| `FM_IdP_FIELD_PROJECT_ID` | | `project::id_project` | Portal field — project PK |
| `FM_IdP_FIELD_PROJECT_NAME` | | `project::projectName` | Portal field — project name |
| `FM_IdP_FIELD_ROLE_NAME` | | `role::roleName` | Portal field — role name |

---

## Advanced: self-signed certificates (development only)

If your dev FileMaker server uses a self-signed cert, pass a custom `fetch` to skip verification:

```typescript
// auth.ts
import { Agent } from "undici";

const dispatcher = new Agent({ connect: { rejectUnauthorized: false } });

const fmConfig = loadConfigFromEnv({
  fetch: (url, init) =>
    fetch(url, { ...init, dispatcher } as RequestInit),
});
```

> `undici` ships with Node.js 18+ (no extra install needed). Do not use self-signed certificates in production.

---

## Rate limiting

Each login attempt makes multiple calls to the FileMaker Data API. Add rate limiting to `/api/auth/callback/filemaker` at the middleware or infrastructure level to protect your FM server from brute-force attempts.

---

## License

GNU General Public License v3.0 — see [LICENSE](LICENSE).
