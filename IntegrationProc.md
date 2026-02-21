# Integration Procedure for a Consuming App

Outline of steps needed to deploy the package in a Next.js app.

> **Next.js version note:** This guide is written for **Next.js 16+** as the primary path. Next.js 15 (and earlier) differences are called out where they apply — look for the "Next.js 15" callouts.

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
> # In the consuming app (use --legacy-peer-deps to avoid peer resolution issues)
> npm install ../next-auth-filemaker-IdP/*.tgz --legacy-peer-deps
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
FM_IdP_TIMEOUT=10000                                # request timeout in milliseconds
# FM_IdP_EVENT_LOG_LAYOUT=DAPI_EVENTLOG             # omit or leave blank to disable event logging

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

## 4. Create `auth.ts`

### Next.js 16+ (recommended)

Since `proxy.ts` in Next.js 16 runs on the Node.js runtime (not edge), there is no need for a separate edge-safe `auth.config.ts`. Put everything in a single `auth.ts`:

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
  providers: [createFileMakerProvider(fmConfig)],  // optionally: createFileMakerProvider(fmConfig, { id: "custom-id" })
  callbacks: {
    authorized({ auth }) {
      return !!auth?.user;
    },
    jwt: createJwtCallback(),
    session: createSessionCallback(),
  },
  events: createEventHandlers(fmConfig),
  session: {
    strategy: "jwt",
    maxAge: 60 * 60,   // session expires 60 minutes after last activity
    updateAge: 5 * 60, // re-sign the JWT at most once every 5 minutes
  },
});
```

> **Session expiry:** `maxAge` sets how long the JWT lives from when it was last issued. `updateAge` controls how often Auth.js re-issues it — on each authenticated request that arrives more than `updateAge` seconds after the previous re-issue, the JWT is re-signed and the `maxAge` clock resets. This creates a sliding idle timeout: the session expires only if the user is inactive for the full `maxAge` duration.

### Next.js 15 and earlier

Next.js 15 middleware runs on the edge runtime, which cannot import Node.js APIs. You need to split your config into two files:

**`auth.config.ts`** — edge-safe, no Node.js APIs:

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

**`auth.ts`** — server-only, full config:

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
  session: {
    strategy: "jwt",
    maxAge: 60 * 60,
    updateAge: 5 * 60,
  },
});
```

> **Warning:** Do NOT write `callbacks: { jwt: ..., session: ... }` without spreading `...authConfig.callbacks` first. This silently drops the `authorized` callback from `auth.config.ts`, causing an infinite redirect loop to `/login`. Always spread `authConfig.callbacks` before adding `jwt` and `session`.

## 5. Wire up the API route handler

Create `app/api/auth/[...nextauth]/route.ts` that re-exports the handlers:

```typescript
import { handlers } from "@/auth";
export const { GET, POST } = handlers;
```

## 6. Add type augmentation

Create `types/next-auth.d.ts` to extend the Session and JWT types with the FileMaker user fields:

```typescript
import { DefaultSession } from "next-auth";
import { FileMakerUser, ProjectAssignment } from "@research-allies/next-auth-filemaker-idp";

declare module "next-auth" {
  // Extend User with all FileMaker identity + project fields
  interface User extends FileMakerUser {}

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
    // Optional: these are populated on signIn; making them optional avoids
    // a type conflict with FileMakerJWT (which also declares them optional).
    id?: string;
    userName?: string;
    nameFirst?: string;
    nameLast?: string;
    projects?: ProjectAssignment[];
  }
}
```

## 7. Protect routes

### Next.js 16+: use `proxy.ts`

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

> **Warning:** Always import `auth` from your own `@/auth` module. **Never** create a separate NextAuth instance in `proxy.ts` (e.g., `export default NextAuth(config).auth`) — this produces a second instance with a different JWT signing context, causing silent JWT signature mismatches and an infinite redirect loop to `/login`.

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

> **Note (Next.js 15):** The middleware creates a *separate* NextAuth instance solely for the `authorized` check. This is expected in Next.js 15 — the edge runtime instance only reads the JWT, it doesn't sign new ones. However, this same pattern in `proxy.ts` (Next.js 16+) will cause JWT signature mismatches. Always use `import { auth } from "@/auth"` in `proxy.ts`.

### Defense-in-depth and accessing session data in pages

The proxy/middleware is the outer gate — it redirects unauthenticated users before any page renders. However, it does **not** enforce project- or role-level access. For any page that shows role-gated content or needs user identity server-side, call `auth()` directly:

```typescript
// Any server component or async layout
import { auth } from "@/auth";

export default async function SomePage() {
  const session = await auth();
  // session.user is fully typed: id, userName, nameFirst, nameLast, projects
}
```

This serves two purposes:
1. **Session data** — read the user's identity and project assignments without a round-trip to the client
2. **Defense-in-depth** — even if the proxy matcher is misconfigured, the page itself enforces access

#### Checking project-level roles in server components

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

#### Accessing session data in Client Components

Use `useSession()` from `next-auth/react`. Wrap the relevant subtree in `<SessionProvider>` (typically in your root layout):

```typescript
// app/layout.tsx
import { SessionProvider } from "next-auth/react";

export default function RootLayout({ children }) {
  return <SessionProvider>{children}</SessionProvider>;
}
```

```typescript
// Any client component
"use client";
import { useSession } from "next-auth/react";

export function UserGreeting() {
  const { data: session } = useSession();
  return <span>Hello, {session?.user.nameFirst}</span>;
}
```

> **Note:** `useSession()` reads the already-issued JWT from the browser — it does not make a new server call. Role enforcement must still happen server-side; never trust client-readable session data as a security boundary.

## 8. Add a login page

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
- `callbackUrl` — Where to redirect after successful login (default: the originating page, or `/` if none)
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

## 9. Add a sign-out action

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

## 10. Rate limiting

> **Warning:** Each login attempt opens **up to 3 Data API sessions** (user validation, service profile lookup, event logging). FileMaker Server has a finite session pool (default: 500 for FM Cloud). Without rate limiting, a brute-force attack can exhaust the session pool within minutes, locking out all Data API consumers — not just this app.

Implement rate limiting on the login route at the application level. Some options:

- **Reverse proxy / WAF (recommended)** — configure rate limits on `/api/auth/callback/filemaker` at the infrastructure level (e.g., Cloudflare, nginx, AWS WAF). This is the most robust approach since it blocks requests before they reach your app.

- **Third-party packages** — libraries like `@upstash/ratelimit` (serverless-friendly) or `rate-limiter-flexible` can be added to your API route:

  ```typescript
  // Example: Upstash rate limiter in the auth route
  import { Ratelimit } from "@upstash/ratelimit";
  import { Redis } from "@upstash/redis";

  const ratelimit = new Ratelimit({
    redis: Redis.fromEnv(),
    limiter: Ratelimit.slidingWindow(5, "60 s"), // 5 attempts per minute
  });

  // In your route handler, check before processing:
  const ip = request.headers.get("x-forwarded-for") ?? "unknown";
  const { success } = await ratelimit.limit(ip);
  if (!success) return new Response("Too many requests", { status: 429 });
  ```

- **Middleware/proxy** — track login attempts by IP and block after a threshold.

## 11. Client IP logging

Failed sign-in events are logged with the client IP extracted from the `x-forwarded-for` or `x-real-ip` request headers. These headers are **trivially spoofable** unless your reverse proxy overwrites them from the actual TCP connection. To ensure accurate IP data in your event logs:

- **Cloudflare / Vercel / AWS ALB** — these platforms set trusted `x-forwarded-for` automatically; no action needed.
- **nginx** — ensure your config includes `proxy_set_header X-Forwarded-For $remote_addr;` (not `$proxy_add_x_forwarded_for`, which preserves client-supplied values).
- **No reverse proxy** — the logged IP will be whatever the client sends and should not be trusted for security decisions.

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

> **Note:** `loadConfigFromEnv()` accepts programmatic overrides for `fetch` and `timeout` only. All other configuration comes from environment variables.

Alternatively, set `NODE_TLS_REJECT_UNAUTHORIZED=0` in `.env.local` (applies globally — use with caution).

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Infinite redirect loop to `/login` | `authorized` callback dropped by `callbacks: { ... }` overwrite in `auth.ts` (Next.js 15 split-config pattern) | Spread `...authConfig.callbacks` before adding `jwt`/`session` callbacks |
| Infinite redirect loop to `/login` (Next.js 16 `proxy.ts`) | Separate NextAuth instance created in `proxy.ts` — JWT signature mismatch | Use `import { auth } from "@/auth"; export default auth;` |
| `401` error on profile lookup after successful login | Wrong layout name — Data API layout names are case-sensitive | Verify `FM_IdP_USER_LAYOUT` matches the exact layout name in FileMaker (default: `DAPI_USER`) |
| User authenticates but `projects` array is empty | Wrong portal name — portal names are case-sensitive | Verify `FM_IdP_PORTAL_NAME` matches the exact portal object name on the layout (default: `userProjectRole`) |
| `ConfigurationError: Missing required environment variables` | Required `FM_IdP_*` env vars not set | Check that `FM_IdP_HOST`, `FM_IdP_DATABASE`, `FM_IdP_SERVICE_USERNAME`, and `FM_IdP_SERVICE_PASSWORD` are all set in `.env.local` |
| `FileMakerAuthError: Invalid FileMaker credentials` | Service account credentials are wrong, or user credentials are wrong | For service account errors (during profile lookup), check `FM_IdP_SERVICE_USERNAME`/`FM_IdP_SERVICE_PASSWORD`. For user errors, the login form will show an error message. |
| Session data missing fields (e.g., `userName` is `undefined`) | Type augmentation not set up, or JWT callback not wired | Ensure `types/next-auth.d.ts` exists (step 6) and `createJwtCallback()` + `createSessionCallback()` are both in the `callbacks` object |
