# Integration Procedure for a Consuming App

Outline of steps needed to deploy the package in a NextJS App

## 1. Configure `.npmrc` for GitHub Packages

The package is published to GitHub Packages. Add an `.npmrc` in the consuming app root (or your global `~/.npmrc`) with a GitHub Personal Access Token:

```
@research-allies:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_PAT
```

The PAT needs `read:packages` scope.

## 2. Install the package

```bash
npm install @research-allies/next-auth-filemaker-idp
```

> **Local development tip:** When testing against a local build of the package, use `npm pack` to create a tarball and install from that rather than a `file:` or symlink install — Turbopack cannot resolve symlinks:
> ```bash
> # In the IdP package directory
> npm run build && npm pack
> # In the consuming app
> npm install ../next-auth-filemaker-IdP/research-allies-next-auth-filemaker-idp-0.1.0.tgz
> ```

## 3. Set environment variables

Copy `.env.example` from the package and add to `.env.local`:

```
# ── Required ────────────────────────────────────────────────
FM_IdP_HOST=your-filemaker-server.com
FM_IdP_DATABASE=YourDatabase.fmp12
FM_IdP_SERVICE_USERNAME=
FM_IdP_SERVICE_PASSWORD=
AUTH_SECRET=<random-secret>

# ── Optional (defaults shown) ────────────────────────────────
FM_IdP_USE_HTTPS=true
FM_IdP_USER_LAYOUT=DAPI_USER

# Field names — only set if your schema differs from defaults
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

Generate `AUTH_SECRET` with:

```bash
npx auth secret
# or
openssl rand -base64 32
```

## 4. Create `auth.config.ts` (edge-safe, no Node.js APIs)

This minimal config is used by the middleware/proxy (edge runtime). It must not import any Node.js APIs or the FM package:

```typescript
// src/auth.config.ts
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

## 5. Create `auth.ts` (server-only, full config)

Import `loadConfigFromEnv` and the factory functions. Spread `authConfig` so pages/callbacks are shared:

```typescript
// src/auth.ts
import NextAuth from "next-auth";
import {
  loadConfigFromEnv,
  createFileMakerProvider,
  createJwtCallback,
  createSessionCallback,
} from "@research-allies/next-auth-filemaker-idp";
import { authConfig } from "@/auth.config";

const fmConfig = loadConfigFromEnv();

export const { auth, handlers, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [createFileMakerProvider(fmConfig)],  // optionally: createFileMakerProvider(fmConfig, { id: "custom-id" })
  callbacks: {
    jwt: createJwtCallback(),
    session: createSessionCallback(),
  },
  session: {
    strategy: "jwt",
    maxAge: 30 * 60,   // session expires 30 minutes after last activity
    updateAge: 5 * 60, // re-sign the JWT at most once every 5 minutes
  },
});
```

> **Session expiry:** `maxAge` sets how long the JWT lives from when it was last issued. `updateAge` controls how often Auth.js re-issues it — on each authenticated request that arrives more than `updateAge` seconds after the previous re-issue, the JWT is re-signed and the `maxAge` clock resets. This creates a sliding idle timeout: the session expires only if the user is inactive for the full `maxAge` duration.

## 6. Wire up the API route handler

Create `app/api/auth/[...nextauth]/route.ts` that re-exports the handlers:

```typescript
import { handlers } from "@/auth";
export const { GET, POST } = handlers;
```

## 7. Add type augmentation

Create `types/next-auth.d.ts` to extend the Session and JWT types with the FileMaker user fields:

```typescript
import { DefaultSession } from "next-auth";
import { ProjectAssignment } from "@research-allies/next-auth-filemaker-idp";

declare module "next-auth" {
  interface User {
    userName: string;
    nameFirst: string;
    nameLast: string;
    // email is already declared by Auth.js as email?: string | null
    projects: ProjectAssignment[];
  }

  interface Session {
    user: {
      id: string;
      userName: string;
      nameFirst: string;
      nameLast: string;
      // email is already provided by DefaultSession["user"]
      projects: ProjectAssignment[];
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userName: string;
    nameFirst: string;
    nameLast: string;
    // email is already declared by Auth.js as email?: string | null
    projects: ProjectAssignment[];
  }
}
```

## 8. Protect routes with middleware

### Next.js 16+: use `proxy.ts`

Next.js 16 replaced `middleware.ts` with `proxy.ts`, which runs on the **Node.js runtime** (not edge). This means you can use the full `auth` export directly — no need for a separate edge-safe `authConfig`:

```typescript
// src/proxy.ts
import { auth } from "@/auth";

export default auth;

export const config = {
  matcher: [
    "/dashboard/:path*",
    // Add other protected paths
    "/((?!api/auth|login|_next/static|_next/image|favicon.ico).*)",
  ],
};
```

### Next.js 15 and earlier: use `middleware.ts`

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

export default async function ProjectAdminPage({ params }: { params: { projectId: string } }) {
  const session = await auth();
  const project = session?.user.projects.find((p) => p.projectId === params.projectId);
  const isAdmin = project?.roles?.includes("admin");

  if (!isAdmin) {
    return <p>Access denied</p>;
  }

  return <div>Project admin content</div>;
}
```

## 9. Add a login page

The package includes a ready-to-use login form component. You can either use it directly or build your own.

### Option A: Use the included `FileMakerLoginForm` component

Import from the `/client` subpath. The login page must be a Client Component (`"use client"`):

```typescript
// app/login/page.tsx
"use client";
import { FileMakerLoginForm } from "@research-allies/next-auth-filemaker-idp/client";

export default function LoginPage() {
  return (
    <div>
      <h1>Sign In</h1>
      <FileMakerLoginForm callbackUrl="/dashboard" />
    </div>
  );
}
```

The component accepts optional props:
- `providerId` — Provider ID to sign in with (default: `"filemaker"`). Must match the `id` passed to `createFileMakerProvider`.
- `callbackUrl` — Where to redirect after successful login (default: `/`)
- `className` — CSS class for the outer `<form>` element
- `onError` — Callback for custom error handling

> **Why `/client`?** The `FileMakerLoginForm` uses React hooks (`useState`). It is published under the `./client` subpath export so bundlers can correctly resolve the `"use client"` boundary. Importing from the main package path will cause a Server Component error.

### Option B: Build a custom login page

If you need full control over the UI, create your own form that calls `signIn("filemaker", ...)` (replace `"filemaker"` with your custom ID if you set one):

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
    await signIn("filemaker", {
      username,
      password,
      callbackUrl: "/dashboard",
    });
  }

  return (
    <form onSubmit={handleSubmit}>
      <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" />
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
      <button type="submit">Sign In</button>
    </form>
  );
}
```

## 10. Add a sign-out action

Call `signOut` from `next-auth/react` directly in any Client Component:

```typescript
"use client";
import { signOut } from "next-auth/react";

// Minimal button
<button onClick={() => signOut({ callbackUrl: "/login" })}>Sign out</button>

// With a design-system component (e.g. MUI)
<IconButton onClick={() => signOut({ callbackUrl: "/login" })}>
  <LogoutIcon />
</IconButton>
```

For server-side sign-out (e.g. from a Server Action), import `signOut` from `@/auth` instead:

```typescript
import { signOut } from "@/auth";

export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}
```

## 11. Rate limiting

Each login attempt makes multiple calls to the FileMaker Data API. Without rate limiting, brute-force attacks could overwhelm your FM server. Implement rate limiting on the login route at the application level — for example:

- **Middleware/proxy** — track login attempts by IP and block after a threshold
- **Reverse proxy / WAF** — configure rate limits on `/api/auth/callback/filemaker` at the infrastructure level (e.g., Cloudflare, nginx, AWS WAF)
- **Third-party packages** — libraries like `rate-limiter-flexible` or `upstash/ratelimit` can be added to your API route

## 12. Self-signed certificates (development only)

> **Warning:** Self-signed certificates should NOT be used in production. Always use a valid, CA-signed certificate for production FileMaker servers.

If your development FileMaker server uses a self-signed certificate, Data API requests will fail with a certificate error. You can work around this by passing a custom `fetch` via the config overrides:

```typescript
// auth.ts
import { Agent } from "undici";

const dispatcher = new Agent({ connect: { rejectUnauthorized: false } });

const fmConfig = loadConfigFromEnv({
  fetch: (url, init) =>
    fetch(url, { ...init, dispatcher } as RequestInit),
});
```

> `undici` ships with Node.js 18+ (no extra install needed).

Alternatively, set `NODE_TLS_REJECT_UNAUTHORIZED=0` in `.env.local` (applies globally — use with caution).
