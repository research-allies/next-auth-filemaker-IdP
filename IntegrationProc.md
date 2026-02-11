# Integration Procedure for a Consuming App

Outline of steps needed to deploy the package in a NextJS App

## 1. Install the package

```bash
npm install @your-org/next-auth-filemaker-idp
```

Requires `.npmrc` configured for GitHub Packages authentication.

## 2. Set environment variables

Add to `.env.local`:

```
FM_HOST=your-filemaker-server.com
FM_DATABASE=MonitorDB
FM_ODATA_TABLE=UserPrivileges
AUTH_SECRET=<random-secret>
```

## 3. Create `auth.ts` in the app root

Import the three factory functions, build your config object mapping to your app's specific FM database/table/field names, and initialize NextAuth:

```typescript
import NextAuth from "next-auth";
import {
  createFileMakerProvider,
  createJwtCallback,
  createSessionCallback,
} from "@your-org/next-auth-filemaker-idp";

const fmConfig = {
  host: process.env.FM_HOST!,
  database: process.env.FM_DATABASE!,
  odata: {
    database: process.env.FM_DATABASE!,
    tableName: process.env.FM_ODATA_TABLE!,
    fields: {
      usernameField: "AccountName",
      roleField: "Role",
      projectField: "ProjectID",
    },
  },
};

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

Create `types/next-auth.d.ts` to extend the Session and JWT types with `role` and `projects` so TypeScript knows about them throughout the app:

```typescript
import { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface User {
    fmToken: string;
    fmTokenIssuedAt: number;
    role: string;
    projects: string[];
  }

  interface Session {
    user: {
      id: string;
      name: string;
      role: string;
      projects: string[];
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    fmToken: string;
    fmTokenIssuedAt: number;
    role: string;
    projects: string[];
  }
}
```

## 6. Protect routes and check privileges

- Use `auth()` in server components or middleware to get the session
- Check `session.user.role` and `session.user.projects` to gate access to pages/features
- Use `extractFmToken()` with `getToken()` in server-side API routes if you need to make further FM Data API calls

```typescript
// Example: middleware.ts
import { auth } from "@/auth";

export default auth((req) => {
  if (!req.auth) {
    return Response.redirect(new URL("/login", req.url));
  }
});

export const config = { matcher: ["/dashboard/:path*"] };
```

```typescript
// Example: checking role in a server component
import { auth } from "@/auth";

export default async function AdminPage() {
  const session = await auth();

  if (session?.user.role !== "Admin") {
    return <p>Access denied</p>;
  }

  return <div>Admin content</div>;
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
