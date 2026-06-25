# projectDatabase via OData Enrichment — Implementation Plan (Approach B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Get `projectDatabase` into the shared JWT by extending the existing OData enrichment step already present in validate-app. No IdP library changes, no FileMaker schema changes, no version bump.

**Architecture:** validate-app already has a working OData enrichment that queries the Hub's `project` table for `database_project_data` and stores it in the JWT as `projectDatabase` on `EnrichedProjectAssignment`. design-app has none of this. This plan brings design-app to parity.

**Tech Stack:** TypeScript, `@research-allies/next-auth-filemaker-idp` (unchanged), Next.js App Router, Auth.js v5, OData via `fmClient()`

## Global Constraints

- No changes to `@research-allies/next-auth-filemaker-idp` — no version bump, no publish
- No FileMaker schema changes required
- `fmClient()` in design-app has no `database` parameter — enrichment calls it with no args (Hub database), same as validate-app
- `projectDatabase` is `string` (never `undefined`) — enrichment falls back to `""` when not found in OData response

---

## Current State

**validate-app:** Complete. `enrich-projects.ts`, `project-types.ts`, wrapping JWT callback, and `types/next-auth.d.ts` are all in place and working.

**design-app:** No enrichment. `auth.ts` uses plain `createJwtCallback()`. `types/next-auth.d.ts` and `ProjectContext.tsx` are typed against `ProjectAssignment` (no `projectDatabase`).

---

## Task 1: Add OData enrichment to design-app

**Repo:** `~/Developer/GitHub/research-allies/design-app`

**Files:**
- Create: `src/lib/project-types.ts`
- Create: `src/lib/enrich-projects.ts`
- Modify: `src/auth.ts`
- Modify: `types/next-auth.d.ts`
- Modify: `src/contexts/ProjectContext.tsx`

- [ ] **Step 1: Create `src/lib/project-types.ts`**

```ts
import type { ProjectAssignment } from "@research-allies/next-auth-filemaker-idp";

export interface EnrichedProjectAssignment extends ProjectAssignment {
  projectDatabase: string;
}
```

- [ ] **Step 2: Create `src/lib/enrich-projects.ts`**

```ts
import type { ProjectAssignment } from "@research-allies/next-auth-filemaker-idp";
import { fmClient } from "@/lib/filemaker";
import type { EnrichedProjectAssignment } from "@/lib/project-types";

export async function enrichProjectsWithDatabase(
  projects: ProjectAssignment[],
): Promise<EnrichedProjectAssignment[]> {
  if (!projects.length) return [];

  // Build OData $filter using 'or' conditions — 'in' operator is not reliably supported.
  const filter = projects
    .map((p) => `id_project eq '${p.projectId.replace(/'/g, "''")}'`)
    .join(" or ");

  const client = fmClient(); // no override — queries the master Hub database
  const res = await client.get<{ value: Array<{ id_project: string; database_project_data: string }> }>(
    "/project",
    { params: { $filter: filter, $select: "id_project,database_project_data" } },
  );

  const dbMap = new Map(
    (res.data.value ?? []).map((r) => [r.id_project, r.database_project_data]),
  );

  return projects.map((p) => ({
    ...p,
    projectDatabase: dbMap.get(p.projectId) ?? "",
  }));
}
```

- [ ] **Step 3: Update `src/auth.ts`**

Add the wrapping JWT callback. Replace the existing plain `jwt: createJwtCallback()` with:

```ts
import NextAuth from "next-auth";
import type { JWT } from "next-auth/jwt";
import {
  loadConfigFromEnv,
  createFileMakerProvider,
  createJwtCallback,
  createSessionCallback,
} from "@research-allies/next-auth-filemaker-idp";
import { ROLES } from "@/lib/roles";
import { getEventLogger } from "@/lib/event-logger";
import { enrichProjectsWithDatabase } from "@/lib/enrich-projects";

const fmConfig = loadConfigFromEnv();
const baseJwtCallback = createJwtCallback();

export const { auth, handlers, signIn, signOut } = NextAuth({
  pages: { signIn: "/login" },
  providers: [createFileMakerProvider(fmConfig)],
  callbacks: {
    authorized({ auth, request }) {
      if (!auth?.user) return false;
      const hasAccess =
        auth.user.projects?.some((p) => p.roles.includes(ROLES.APP_ACCESS)) ??
        false;
      if (!hasAccess) {
        void getEventLogger().write({
          action: "auth.access_denied",
          severity: "warning",
          idUser: auth.user.id,
          notes: `Access denied to ${request.nextUrl.pathname}`,
        }).catch(console.warn);
        const url = new URL("/login", request.nextUrl.origin);
        url.searchParams.set("error", "AccessDenied");
        return Response.redirect(url);
      }
      return true;
    },
    jwt: async ({ token, user }) => {
      const enriched = await baseJwtCallback({ token, user });
      if (user && enriched.projects?.length) {
        enriched.projects = await enrichProjectsWithDatabase(enriched.projects);
      }
      return enriched as unknown as JWT;
    },
    session: createSessionCallback(),
  },
  events: {
    async signIn({ user }) {
      void getEventLogger().write({
        action: "auth.sign_in",
        idUser: user.id,
      }).catch(console.warn);
    },
    async signOut(message) {
      const token = "token" in message ? message.token : null;
      void getEventLogger().write({
        action: "auth.sign_out",
        idUser: token?.id,
      }).catch(console.warn);
    },
  },
  session: { strategy: "jwt", maxAge: 60 * 60, updateAge: 5 * 60 },
  trustHost: true,
  ...(process.env.AUTH_COOKIE_DOMAIN && {
    cookies: {
      sessionToken: {
        options: {
          domain: process.env.AUTH_COOKIE_DOMAIN,
          httpOnly: true,
          sameSite: "lax",
          path: "/",
          secure: process.env.NODE_ENV === "production",
          maxAge: 60 * 60,
        },
      },
    },
  }),
});
```

- [ ] **Step 4: Update `types/next-auth.d.ts`**

Replace `ProjectAssignment` with `EnrichedProjectAssignment` in both module declarations:

```ts
import { DefaultSession } from "next-auth";
import { FileMakerUser } from "@research-allies/next-auth-filemaker-idp";
import type { EnrichedProjectAssignment } from "../src/lib/project-types";

declare module "next-auth" {
  interface User extends FileMakerUser {}
  interface Session {
    user: {
      id: string;
      userName: string;
      nameFirst: string;
      nameLast: string;
      email: string;
      projects: EnrichedProjectAssignment[];
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    userName?: string;
    nameFirst?: string;
    nameLast?: string;
    projects?: EnrichedProjectAssignment[];
  }
}
```

- [ ] **Step 5: Update `src/contexts/ProjectContext.tsx`**

Replace the `ProjectAssignment` import with `EnrichedProjectAssignment`:

```ts
import type { EnrichedProjectAssignment } from '@/lib/project-types';
```

Replace all three occurrences of `ProjectAssignment` in the file with `EnrichedProjectAssignment` (the `ProjectContextValue` interface, the `setSelectedProject` parameter, and the `useCallback` parameter type).

- [ ] **Step 6: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/lib/project-types.ts src/lib/enrich-projects.ts src/auth.ts types/next-auth.d.ts src/contexts/ProjectContext.tsx
git commit -m "feat: add OData enrichment to populate projectDatabase in JWT

Queries Hub /project table at sign-in to resolve database_project_data
for each project assignment. Mirrors the pattern already in validate-app."
```

---

## Task 2: Update the `ra-project-context` skill

**Repo:** `~/Developer/GitHub/research-allies/claude-skills`

**Files:**
- Modify: `ra-project-context/SKILL.md`

Update the prerequisites section and `ProjectAssignment` shape note to reflect that `projectDatabase` comes from the OData enrichment layer in each app, not from the IdP package directly. Document `EnrichedProjectAssignment` as the type to use for `ProjectContextValue` and `useProjectContext`.

- [ ] **Step 1: Update prerequisites in `ra-project-context/SKILL.md`**

Change the IdP prerequisite from:

```
- `@research-allies/next-auth-filemaker-idp >= 0.4.0` — `ProjectAssignment` includes `projectDatabase`
```

to:

```
- OData enrichment in place (`src/lib/enrich-projects.ts` + wrapping JWT callback in `src/auth.ts`) — adds `projectDatabase` to each project at sign-in
```

Update the `ProjectAssignment` shape note in the `ProjectContext.tsx` template to document `EnrichedProjectAssignment`:

```typescript
// Import from local project-types, not from the IdP package
import type { EnrichedProjectAssignment } from '@/lib/project-types';

// EnrichedProjectAssignment shape:
// { projectId: string; projectName: string; projectDatabase: string; roles: string[] }
// projectDatabase is populated by enrichProjectsWithDatabase() at sign-in
```

- [ ] **Step 2: Commit**

```bash
git -C ~/Developer/GitHub/research-allies/claude-skills add ra-project-context/SKILL.md
git -C ~/Developer/GitHub/research-allies/claude-skills commit -m "feat(ra-project-context): update for OData enrichment pattern (Approach B)

projectDatabase comes from the per-app enrichment layer, not the IdP.
Documents EnrichedProjectAssignment as the context type."
```
