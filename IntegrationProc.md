# Integration Procedure for a Consuming App

Outline of steps needed to deploy the package in a NextJS App

## 1. Install the package

```bash
npm install @your-org/next-auth-filemaker-idp
```

Requires `.npmrc` configured for GitHub Packages authentication.

## 2. Set environment variables

Copy `.env.example` from the package and add to `.env.local`:

```
# ── Required ────────────────────────────────────────────────
FM_HOST=your-filemaker-server.com
FM_DATABASE=YourDatabase
FM_SERVICE_USERNAME=
FM_SERVICE_PASSWORD=
AUTH_SECRET=<random-secret>

# ── Optional (defaults shown) ────────────────────────────────
FM_USE_HTTPS=true
FM_USER_LAYOUT=User

# Field names — only set if your schema differs from defaults
FM_FIELD_ID_USER=id_user
FM_FIELD_USERNAME=userName
FM_FIELD_NAME_FIRST=nameFirst
FM_FIELD_NAME_LAST=nameLast
FM_FIELD_EMAIL=email
FM_PORTAL_NAME=userProjectRole
FM_FIELD_PROJECT_ID=project::id_project
FM_FIELD_PROJECT_NAME=project::projectName
FM_FIELD_ROLE_NAME=role::roleName
```

Generate `AUTH_SECRET` with:

```bash
npx auth secret
# or
openssl rand -base64 32
```

## 3. Create `auth.ts` in the app root

Import `loadConfigFromEnv` and the factory functions, then initialize NextAuth. All FM connection details come from env vars:

```typescript
import NextAuth from "next-auth";
import {
  loadConfigFromEnv,
  createFileMakerProvider,
  createJwtCallback,
  createSessionCallback,
} from "@your-org/next-auth-filemaker-idp";

const fmConfig = loadConfigFromEnv();

export const { auth, handlers, signIn, signOut } = NextAuth({
  providers: [createFileMakerProvider(fmConfig)],
  callbacks: {
    jwt: createJwtCallback(fmConfig),
    session: createSessionCallback(fmConfig),
  },
  session: { strategy: "jwt", maxAge: 8 * 60 * 60 },
});
```

## 4. Wire up the API route handler

Create `app/api/auth/[...nextauth]/route.ts` that re-exports the handlers:

```typescript
import { handlers } from "@/auth";
export const { GET, POST } = handlers;
```

## 5. Add type augmentation

Create `types/next-auth.d.ts` to extend the Session and JWT types with the FileMaker user fields so TypeScript knows about them throughout the app:

```typescript
import { DefaultSession } from "next-auth";
import { ProjectAssignment } from "@your-org/next-auth-filemaker-idp";

declare module "next-auth" {
  interface User {
    userName: string;
    nameFirst: string;
    nameLast: string;
    email: string;
    projects: ProjectAssignment[];
  }

  interface Session {
    user: {
      id: string;
      userName: string;
      nameFirst: string;
      nameLast: string;
      email: string;
      projects: ProjectAssignment[];
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userName: string;
    nameFirst: string;
    nameLast: string;
    email: string;
    projects: ProjectAssignment[];
  }
}
```

## 6. Protect routes and check privileges

- Use `auth()` in server components or middleware to get the session
- Check `session.user.projects` to gate access — roles are per-project, so check both the project and the role within it
- For server-side FM Data API calls, use `fmLogin(config, serviceUsername, servicePassword)` with the service credentials from env vars — open a session, make your calls, then `fmLogout`

> **Note:** The user's credentials are validated first via the Data API session endpoint. Profile and privilege lookup is then performed using a backend service account (`FM_SERVICE_USERNAME`/`FM_SERVICE_PASSWORD`) that has read access to the User layout. All steps must succeed for login to proceed — service credentials never leave the server.

```typescript
// Example: middleware.ts — redirect unauthenticated users
import { auth } from "@/auth";

export default auth((req) => {
  if (!req.auth) {
    return Response.redirect(new URL("/login", req.url));
  }
});

export const config = { matcher: ["/dashboard/:path*"] };
```

```typescript
// Example: checking project-level role in a server component
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

## 7. Add a login page

The package includes a ready-to-use login form component. You can either use it directly or build your own.

### Option A: Use the included `FileMakerLoginForm` component

The simplest approach — drop the provided component into a page:

```typescript
// app/login/page.tsx
import { FileMakerLoginForm } from "@your-org/next-auth-filemaker-idp";

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
- `callbackUrl` — Where to redirect after successful login (default: `/`)
- `className` — CSS class for the outer `<form>` element
- `onError` — Callback for custom error handling

### Option B: Build a custom login page

If you need full control over the UI, create your own form that calls `signIn("filemaker", ...)`:

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
