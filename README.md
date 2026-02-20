# @research-allies/next-auth-filemaker-idp

Auth.js v5 Credentials provider for authenticating users against an on-premises FileMaker Server. Published to GitHub Packages, consumed by multiple NextJS apps.

## How it works

1. User submits credentials → FileMaker Data API validates them (session token immediately discarded)
2. A backend service account opens a session and fetches the user's profile + project/role assignments from the `DAPI_USER` layout (with `userProjectRole` portal)
3. The service session is closed
4. A JWT is issued containing identity fields and `projects: ProjectAssignment[]` — no FileMaker tokens ever stored in the JWT

## FileMaker files

| Filename | Description |
|---|---|
| `IdP_Accounts.fmp12` | Manages identities, projects, and role assignments |
| `IdP_File1.fmp12` | Sample solution file that receives distributed FileMaker accounts |

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

```typescript
// auth.ts (app root)
import NextAuth from "next-auth";
import {
  loadConfigFromEnv,
  createFileMakerProvider,
  createJwtCallback,
  createSessionCallback,
} from "@research-allies/next-auth-filemaker-idp";

const fmConfig = loadConfigFromEnv();

export const { auth, handlers, signIn, signOut } = NextAuth({
  providers: [createFileMakerProvider(fmConfig)],
  callbacks: {
    jwt: createJwtCallback(),
    session: createSessionCallback(),
  },
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 }, // 8 hours
});
```

> **Security:** `loadConfigFromEnv()` reads service account credentials from `process.env`. Only call it in server-side code — never in a `"use client"` component.

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

```typescript
// app/login/page.tsx
import { FileMakerLoginForm } from "@research-allies/next-auth-filemaker-idp";

export default function LoginPage() {
  return <FileMakerLoginForm callbackUrl="/dashboard" />;
}
```

Props: `callbackUrl?: string`, `className?: string`, `onError?: (error: string) => void`

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

```typescript
// middleware.ts
import { auth } from "@/auth";

export default auth((req) => {
  if (!req.auth) {
    return Response.redirect(new URL("/login", req.url));
  }
});

export const config = { matcher: ["/dashboard/:path*"] };
```

```typescript
// Checking a project-level role in a server component
import { auth } from "@/auth";

export default async function AdminPage({ params }: { params: { projectId: string } }) {
  const session = await auth();
  const project = session?.user.projects.find((p) => p.projectId === params.projectId);

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
