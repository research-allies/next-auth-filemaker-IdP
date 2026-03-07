# Integration Procedure for a Consuming App

Outline of steps needed to deploy the package in a Next.js app.

> **Next.js version note:** This guide is written for **Next.js 16+** as the primary path. Next.js 15 (and earlier) differences are called out where they apply — look for the "Next.js 15" callouts.

## 1. Configure `.npmrc` for GitHub Packages

The package is published to GitHub Packages. Add an `.npmrc` in the consuming app root (or your global `~/.npmrc`) with a GitHub Personal Access Token:

```ini
@research-allies:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=YOUR_GITHUB_PAT
```

The PAT needs `read:packages` scope.

## 2. Install the package

Install `next-auth` and the IdP package together. Auth.js v5 is still in beta — there is no stable `5.x` release on npm yet, so you must pin the beta explicitly:

```bash
npm install "next-auth@5.0.0-beta.30" @research-allies/next-auth-filemaker-idp
```

> **Why pin the beta?** `npm install next-auth` resolves to the latest stable release (v4), which uses a different API and is incompatible with this package. `next-auth@^5` produces an `ETARGET` error because no stable 5.x exists. Pin to the latest beta listed at [npmjs.com/package/next-auth](https://www.npmjs.com/package/next-auth?activeTab=versions).

> **Local development tip:** When testing against a local build of the package, use `npm pack` to create a tarball and install from that rather than a `file:` or symlink install — Turbopack cannot resolve symlinks:
> ```bash
> # In the IdP package directory
> npm run build && npm pack
> # In the consuming app (use --legacy-peer-deps to avoid peer resolution issues)
> npm install "next-auth@5.0.0-beta.30" ../next-auth-filemaker-IdP/*.tgz --legacy-peer-deps
> ```

## 3. Set environment variables

Bootstrap your `.env.local` from the package's `.env.example`, which is the canonical list of all supported variables with their defaults:

```bash
cp node_modules/@research-allies/next-auth-filemaker-idp/.env.example .env.local
```

Fill in the required values:

```shell
FM_IdP_HOST=your-filemaker-server.com
FM_IdP_DATABASE=YourDatabase.fmp12
FM_IdP_SERVICE_USERNAME=your-service-account
FM_IdP_SERVICE_PASSWORD=your-service-password
AUTH_SECRET=<paste generated secret here>
```

The optional variables (field name overrides, portal name, event log layout, etc.) are documented with their defaults in `.env.example` — uncomment and change only the ones that differ from your schema.

> **Important:** Whether you use `cp` or create `.env.local` manually, the file must contain all variables from `.env.example` — required ones filled in, optional ones present and commented out. Do not create a minimal `.env.local` with only the required vars. The commented-out optional vars serve as inline documentation of what can be configured without having to consult external docs.

Generate `AUTH_SECRET` — the app will not start without it:

```bash
openssl rand -base64 32
```

## 4. Create `auth.ts`

### Next.js 16+ (recommended)

Since `proxy.ts` in Next.js 16 runs on the Node.js runtime (not edge), there is no need for a separate edge-safe `auth.config.ts`. Put everything in a single `auth.ts`:

```typescript
// auth.ts  (root of project; use src/auth.ts if your project has a src/ layout)
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
  events: createEventHandlers(fmConfig),  // no-op if FM_IdP_EVENT_LOG_LAYOUT is unset
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
// auth.config.ts
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
// auth.ts
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
// app/api/auth/[...nextauth]/route.ts
import { handlers } from "@/auth";
export const { GET, POST } = handlers;
```

## 6. Add type augmentation

Create `types/next-auth.d.ts` to extend the Session and JWT types with the FileMaker user fields.

> **`tsconfig.json` prerequisite:** The default Next.js `tsconfig.json` includes `"**/*.ts"`, which picks up `types/next-auth.d.ts` automatically. If your project scopes includes to a subdirectory (e.g., `"src/**/*.ts"`), add `"types/**/*.ts"` to the `include` array, or TypeScript will silently ignore the augmentation.

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
      email: string;  // narrows DefaultSession["user"].email from string | null | undefined
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
// proxy.ts  (root of project; use src/proxy.ts if your project has a src/ layout)
import { auth } from "@/auth";

export { auth as proxy };

export const config = {
  matcher: [
    // Protect all paths except auth endpoints, login, and static assets
    "/((?!api/auth|login|_next/static|_next/image|favicon.ico).*)",
  ],
};
```

> **Warning:** Always import `auth` from your own `@/auth` module. **Never** create a separate NextAuth instance in `proxy.ts` (e.g., `export default NextAuth(config).auth`) — this produces a second instance with a different JWT signing context, causing silent JWT signature mismatches and an infinite redirect loop to `/login`.

> **Note:** Use `export { auth as proxy }` rather than `export default auth`. Next.js 16 requires the proxy handler to be a named export called `proxy` — exporting `auth` as the default does not satisfy this requirement.

### Next.js 15 and earlier: use `middleware.ts`

```typescript
// middleware.ts
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

export default async function ProjectAdminPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const session = await auth();
  const project = session?.user.projects.find((p) => p.projectId === projectId);
  const isAdmin = project?.roles?.includes("admin");

  if (!isAdmin) {
    return <p>Access denied</p>;
  }

  return <div>Project admin content</div>;
}
```

#### Accessing session data in Client Components

Use `useSession()` from `next-auth/react` in any client component (requires `<SessionProvider>` — see step 8):

```typescript
"use client";
import { useSession } from "next-auth/react";

export function UserGreeting() {
  const { data: session } = useSession();
  return <span>Hello, {session?.user.nameFirst}</span>;
}
```

> **Note:** `useSession()` reads the already-issued JWT from the browser — it does not make a new server call. Role enforcement must still happen server-side; never trust client-readable session data as a security boundary.

## 8. Wrap the root layout with `<SessionProvider>`

`useSession()` and client-side session access require a `<SessionProvider>` ancestor. Add it to your root layout:

```typescript
// app/layout.tsx
import { SessionProvider } from "next-auth/react";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
```

> **Why required?** Without `<SessionProvider>`, any component calling `useSession()` will throw a context error at runtime. The login page itself doesn't need it, but most app pages will.

## 9. Add a login page

The package includes a ready-to-use login form component. You can either use it directly or build your own.

### Option A: Use the included `FileMakerLoginForm` component

Import from the `/client` subpath. The page itself can remain a Server Component — `FileMakerLoginForm` already declares its own `"use client"` boundary:

```typescript
// app/login/page.tsx
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
- `callbackUrl` — Where to redirect after successful login (default: `/`; pass the URL's `callbackUrl` search param to redirect back to the originating page)
- `className` — CSS class for the outer `<form>` element
- `onError` — Callback for custom error handling

> **Why `/client`?** The `FileMakerLoginForm` uses React hooks (`useState`). It is published under the `./client` subpath export so bundlers can correctly resolve the `"use client"` boundary. Importing from the main package path will cause a Server Component error.

> **Styling:** `FileMakerLoginForm` renders a `<form>` containing `<label>`/`<input>` pairs for username and password, a `<p role="alert">` for error messages, and a `<button>`. It ships with no CSS classes or inline styles, and disables the inputs and button while a sign-in request is in flight (button text changes to `"Signing in…"`). The `className` prop applies to the outer `<form>` tag only. How far you can go with Option A depends on your styling approach:
> - **Plain CSS / CSS Modules** — works well. Standard descendant selectors (`form input`, `form button`) reach the component's internals from your login page's stylesheet.
> - **Tailwind** — Tailwind's preflight normalizes the inputs and button to a consistent baseline. For further styling, use `className` on the form and descendant selectors in a CSS module alongside Tailwind, or switch to Option B where you can apply utility classes to every element directly.
> - **Component libraries (MUI, Chakra, etc.)** — global resets (`CssBaseline`, etc.) apply, but the component's inputs and button won't inherit library component styles because they're plain HTML elements, not `TextField` or `Button`. The form will look out of place next to the rest of the app. Use Option B and build the form with your library's components instead.

### Option B: Build a custom login page

If you need full control over the UI — or if your app uses a component library — create your own form that calls `signIn("filemaker", ...)` (replace `"filemaker"` with your custom ID if you set one):

```typescript
// app/login/page.tsx
"use client";
import { signIn } from "next-auth/react";
import { useState } from "react";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: { preventDefault(): void }) {
    e.preventDefault();
    setError(null);
    const result = await signIn("filemaker", {
      username,
      password,
      callbackUrl: "/dashboard",
      redirect: false,
    });
    if (result?.error) {
      setError("Invalid username or password.");
    } else if (result?.url) {
      window.location.href = result.url;
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" />
      <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" />
      {error && <p>{error}</p>}
      <button type="submit">Sign In</button>
    </form>
  );
}
```

## 10. Add a sign-out button

After login, the user lands on the app's home page (`/`). Without this step there is no sign-out button visible anywhere. Create a `"use client"` component for the button, then add it to your existing home page:

```typescript
// app/SignOutButton.tsx
"use client";
import { signOut } from "next-auth/react";

export function SignOutButton() {
  return (
    <button onClick={() => signOut({ callbackUrl: "/login" })}>Sign out</button>
  );
}
```

Then add it to your existing `app/page.tsx` — import `auth` and `SignOutButton`, make the function `async`, and insert the greeting and button at the top of the page (or in your app's title bar / navigation header if one exists):

> **Warning:** Do NOT replace the contents of `app/page.tsx`. Only add the three lines shown (two imports + `async`) and insert the greeting and `<SignOutButton />` into the existing JSX. The comment `{/* ...your existing page content... */}` represents your existing JSX — leave it in place.

> **Placement:** Put the greeting and sign-out button *above* the rest of the page content. If your app has a title bar or nav header, place them on the right side of it. If there is no header yet, place them as the first element inside your page's main container.

```typescript
// app/page.tsx  (additions shown; keep your existing JSX)
import { auth } from "@/auth";
import { SignOutButton } from "./SignOutButton";

export default async function Home() {
  const session = await auth();

  return (
    <main>
      <p>Hello {session?.user.nameFirst}</p>
      <SignOutButton />
      {/* ...your existing page content... */}
    </main>
  );
}
```

> **Why two files?** `signOut` from `next-auth/react` is a client-side function. The page itself is a Server Component so it can call `auth()` directly. Keeping the button in a separate `"use client"` file maintains the server/client boundary.

For server-side sign-out (e.g. from a Server Action), import `signOut` from `@/auth` instead:

```typescript
import { signOut } from "@/auth";

export async function signOutAction() {
  await signOut({ redirectTo: "/login" });
}
```

## 11. Rate limiting

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

> **Performance tip:** Each `fmWriteEventLog` call (triggered by `createEventHandlers`) opens its own service session (login → write → logout). If your app logs a high volume of auth events, you can reduce this overhead by caching the service account token in your app with a short TTL (e.g. 60 seconds) and calling `fmWriteEventLog(config, entry, cachedToken)` directly — bypassing `createEventHandlers` — so the cached token is reused instead of opening a new session per event. The package intentionally does not do this internally — a stateful token cache belongs in the consuming app where session lifetime, concurrency, and invalidation strategy can be tailored to the deployment.

## 12. Client IP logging

Failed sign-in events are logged with the client IP extracted from the `x-forwarded-for` or `x-real-ip` request headers. These headers are **trivially spoofable** unless your reverse proxy overwrites them from the actual TCP connection. To ensure accurate IP data in your event logs:

- **Cloudflare / Vercel / AWS ALB** — these platforms set trusted `x-forwarded-for` automatically; no action needed.
- **nginx** — ensure your config includes `proxy_set_header X-Forwarded-For $remote_addr;` (not `$proxy_add_x_forwarded_for`, which preserves client-supplied values).
- **No reverse proxy** — the logged IP will be whatever the client sends and should not be trusted for security decisions.

## 13. Self-signed certificates (development only)

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
| `npm error notarget No matching version found for next-auth@^5` | No stable 5.x exists on npm yet | Pin the beta explicitly: `npm install "next-auth@5.0.0-beta.30"` (check npmjs.com for the latest beta) |
| Auth API returns 500 / `TypeError: NextAuth is not a function` or destructuring yields `undefined` | `next-auth` v4 installed instead of v5 — v4's `NextAuth()` returns a handler directly, not `{ auth, handlers, ... }` | Reinstall with the pinned beta: `npm install "next-auth@5.0.0-beta.30"` |
| Infinite redirect loop to `/login` | `authorized` callback dropped by `callbacks: { ... }` overwrite in `auth.ts` (Next.js 15 split-config pattern) | Spread `...authConfig.callbacks` before adding `jwt`/`session` callbacks |
| Infinite redirect loop to `/login` (Next.js 16 `proxy.ts`) | Separate NextAuth instance created in `proxy.ts` — JWT signature mismatch | Use `import { auth } from "@/auth"; export { auth as proxy };` |
| `The Proxy file must export a function named "proxy" or a default function` | `auth` exported as default instead of named `proxy` | Change `export default auth` to `export { auth as proxy }` in `proxy.ts` |
| `401` error on profile lookup after successful login | Wrong layout name — Data API layout names are case-sensitive | Verify `FM_IdP_USER_LAYOUT` matches the exact layout name in FileMaker (default: `IdP_user`) |
| User authenticates but `projects` array is empty | Wrong portal name — portal names are case-sensitive | Verify `FM_IdP_PORTAL_NAME` matches the exact portal object name on the layout (default: `userProjectRole`) |
| `401` on login even with correct credentials | Account's privilege set missing the `fmrest` extended privilege | In FileMaker, enable the `fmrest` extended privilege on the account's privilege set — without it the Data API rejects all sessions for that account |
| `ConfigurationError: Missing required environment variables` | Required `FM_IdP_*` env vars not set | Check that `FM_IdP_HOST`, `FM_IdP_DATABASE`, `FM_IdP_SERVICE_USERNAME`, and `FM_IdP_SERVICE_PASSWORD` are all set in `.env.local` |
| `FileMakerAuthError: Invalid FileMaker credentials` | Service account credentials are wrong, or user credentials are wrong | For service account errors (during profile lookup), check `FM_IdP_SERVICE_USERNAME`/`FM_IdP_SERVICE_PASSWORD`. For user errors, the login form will show an error message. |
| Session data missing fields (e.g., `userName` is `undefined`) | Type augmentation not set up, or JWT callback not wired | Ensure `types/next-auth.d.ts` exists (step 6) and `createJwtCallback()` + `createSessionCallback()` are both in the `callbacks` object |
