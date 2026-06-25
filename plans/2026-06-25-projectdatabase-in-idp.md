# projectDatabase via IdP — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `projectDatabase` (FileMaker field `database_project_data`) out of the post-sign-in OData enrichment step and into the FileMaker IdP library itself, so all apps receive it at sign-in with no extra fetch.

**Architecture:** Add `projectDatabase: string` to `ProjectAssignment` in `@research-allies/next-auth-filemaker-idp`, parse it from the `project::database_project_data` portal field already present on the `IdP_user` layout. Then remove the enrichment layer (`enrich-projects.ts`, `project-types.ts`, wrapping JWT callback) from design-app and validate-app, and update the `ra-project-context` skill to reflect the simplified setup.

**Tech Stack:** TypeScript, vitest, `@research-allies/next-auth-filemaker-idp` (GitHub Packages), Next.js App Router, Auth.js v5

## Global Constraints

- All repos use ESM (`"type": "module"`)
- `next-auth-filemaker-IdP` publishes to GitHub Packages (`https://npm.pkg.github.com`)
- `FM_IdP_FIELD_PROJECT_DATABASE` is optional with no default. When unset, `projectDatabase` is omitted from `ProjectAssignment` entirely (not set to `""`).
- `projectDatabaseField?: string` in `FieldMapping` (optional field, no default)
- Version bump: `0.3.1 → 0.4.0` (additive: optional field added to `ProjectAssignment`; no breaking change)
- App package references use `"^0.4.0"` after publish

---

## Task 1: Add `projectDatabase` to the IdP library

**Repo:** `~/Developer/GitHub/research-allies/next-auth-filemaker-IdP`

**Files:**
- Modify: `src/types.ts`
- Modify: `src/env.ts`
- Modify: `src/filemaker-client.ts`
- Modify: `__tests__/filemaker-client.test.ts`
- Modify: `__tests__/callbacks.test.ts`
- Modify: `package.json`

**Interfaces:**

- Produces: `ProjectAssignment.projectDatabase?: string` — consumed by Tasks 2, 3, 4; present only when `FM_IdP_FIELD_PROJECT_DATABASE` is set

- [ ] **Step 1: Write the failing test in `__tests__/filemaker-client.test.ts`**

First update `__tests__/helpers/config.ts` to add `projectDatabaseField` to `baseConfig` (required once `FieldMapping` gains the field in Step 4):

```ts
fields: {
  idUserField: "id_user",
  usernameField: "userName",
  nameFirstField: "nameFirst",
  nameLastField: "nameLast",
  emailField: "email",
  portalName: "user_project_role",
  projectIdField: "project::id_project",
  projectNameField: "project::projectName",
  projectDatabaseField: "project::database_project_data",
  roleNameField: "role::roleName",
},
```

Then update the `userRecord` fixture to include `project::database_project_data` in each portal row, and add an assertion to the existing "returns profile and projects on success" test:

```ts
// Replace the existing userRecord constant:
const userRecord = {
  fieldData: {
    id_user: "u001",
    userName: "jdoe",
    nameFirst: "John",
    nameLast: "Doe",
    email: "jdoe@example.com",
  },
  portalData: {
    user_project_role: [
      {
        "project::id_project": "p1",
        "project::projectName": "Monitor",
        "project::database_project_data": "Monitor.fmp12",
        "role::roleName": "admin",
      },
      {
        "project::id_project": "p1",
        "project::projectName": "Monitor",
        "project::database_project_data": "Monitor.fmp12",
        "role::roleName": "editor",
      },
      {
        "project::id_project": "p2",
        "project::projectName": "Design",
        "project::database_project_data": "Design.fmp12",
        "role::roleName": "viewer",
      },
    ],
  },
};
```

In the "returns profile and projects on success" test, extend the `toMatchObject` assertions:

```ts
expect(result.projects[0]).toMatchObject({
  projectId: "p1",
  projectName: "Monitor",
  projectDatabase: "Monitor.fmp12",
  roles: ["admin", "editor"],
});
expect(result.projects[1]).toMatchObject({
  projectId: "p2",
  projectName: "Design",
  projectDatabase: "Design.fmp12",
  roles: ["viewer"],
});
```

Also add two tests for the optional field:

```ts
it("omits projectDatabase when projectDatabaseField is not configured", async () => {
  const { projectDatabaseField: _, ...fieldsWithoutDb } = baseConfig.fields;
  const config = {
    ...baseConfig,
    fields: fieldsWithoutDb,
    fetch: makeFetch(200, { response: { data: [userRecord] }, messages: [] }),
  };
  const result = await fmFindUserWithPrivileges(config, "tok", "jdoe");
  expect(result.projects[0]).not.toHaveProperty("projectDatabase");
});

it("sets projectDatabase to empty string when field is configured but absent from portal row", async () => {
  const recordNoDB = {
    fieldData: userRecord.fieldData,
    portalData: {
      user_project_role: [
        {
          "project::id_project": "p1",
          "project::projectName": "Monitor",
          // no database_project_data key
          "role::roleName": "admin",
        },
      ],
    },
  };
  const config = {
    ...baseConfig,
    fetch: makeFetch(200, { response: { data: [recordNoDB] }, messages: [] }),
  };
  const result = await fmFindUserWithPrivileges(config, "tok", "jdoe");
  expect(result.projects[0].projectDatabase).toBe("");
});
```

- [ ] **Step 2: Update the `callbacks.test.ts` fixture**

`projectDatabase` is optional so no TypeScript error, but add it to the fixture to verify it flows through the JWT callback unchanged:

```ts
// Replace the existing projects constant:
const projects: ProjectAssignment[] = [
  { projectId: "p1", projectName: "Monitor", projectDatabase: "Monitor.fmp12", roles: ["admin", "editor"] },
  { projectId: "p2", projectName: "Design", projectDatabase: "Design.fmp12", roles: ["viewer"] },
];
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
npm test
```

Expected: failures in `filemaker-client.test.ts` (assertion on `projectDatabase` and `not.toHaveProperty`). No TypeScript errors yet since `projectDatabase` will be optional.

- [ ] **Step 4: Update `src/types.ts`**

Add `projectDatabase` to `ProjectAssignment` and `projectDatabaseField` to `FieldMapping`, both optional:

```ts
export interface ProjectAssignment {
  projectId: string;
  projectName: string;
  projectDatabase?: string;
  roles: string[];
}
```

In `FieldMapping`, add after `projectNameField`:

```ts
/** Portal field in `TableName::fieldName` format. Omit to disable projectDatabase entirely. */
projectDatabaseField?: string;
```

Leave `UserProfile`, `FileMakerUser`, and `FileMakerIdPConfig` unchanged.

- [ ] **Step 5: Add `projectDatabaseField` to `loadConfigFromEnv` in `src/env.ts`**

In the `fields` object, add after `projectNameField` using a conditional spread so the key is absent (not `undefined`) when the env var is unset:

```ts
...(process.env.FM_IdP_FIELD_PROJECT_DATABASE && {
  projectDatabaseField: process.env.FM_IdP_FIELD_PROJECT_DATABASE,
}),
```

- [ ] **Step 6: Parse `projectDatabaseField` in `src/filemaker-client.ts`**

Inside `fmFindUserWithPrivileges`, replace the project-grouping loop. When `fields.projectDatabaseField` is set, read the value and include `projectDatabase` on the assignment (falling back to `""` for a NULL/missing portal value). When it is not set, omit the key entirely:

```ts
// Replace existing loop:
const projectMap = new Map<string, ProjectAssignment>();
for (const row of portalRows) {
  const projectId = String(row[fields.projectIdField] ?? "");
  const projectName = String(row[fields.projectNameField] ?? "");
  const roleName = String(row[fields.roleNameField] ?? "");

  if (!projectId) continue;

  if (!projectMap.has(projectId)) {
    const assignment: ProjectAssignment = { projectId, projectName, roles: [] };
    if (fields.projectDatabaseField !== undefined) {
      assignment.projectDatabase = String(row[fields.projectDatabaseField] ?? "");
    }
    projectMap.set(projectId, assignment);
  }
  if (roleName) {
    projectMap.get(projectId)!.roles.push(roleName);
  }
}
```

- [ ] **Step 7: Run tests to confirm they pass**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 8: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 9: Bump version and publish**

In `package.json`, change `"version": "0.3.1"` to `"version": "0.4.0"`.

Then build and publish:

```bash
npm publish
```

(`prepublishOnly` runs `npm run build` automatically.)

Expected output ends with: `npm notice Publishing to https://npm.pkg.github.com/ ...` and a success line.

- [ ] **Step 10: Commit**

```bash
git add src/types.ts src/env.ts src/filemaker-client.ts __tests__/helpers/config.ts __tests__/filemaker-client.test.ts __tests__/callbacks.test.ts package.json
git commit -m "feat: add optional projectDatabase to ProjectAssignment

Set FM_IdP_FIELD_PROJECT_DATABASE to a portal field name to enable it.
When unset, projectDatabase is absent from ProjectAssignment entirely.
When set, NULL portal values fall back to ''.
Bumps to 0.4.0 — additive, non-breaking change."
```

---

## Task 2: Clean up design-app

**Repo:** `~/Developer/GitHub/research-allies/design-app` (this repo)

**Files:**
- Delete: `src/lib/enrich-projects.ts`
- Delete: `src/lib/project-types.ts`
- Modify: `src/auth.ts`
- Modify: `src/contexts/ProjectContext.tsx`
- Modify: `package.json`

**Interfaces:**
- Consumes: `ProjectAssignment.projectDatabase` from `@research-allies/next-auth-filemaker-idp@0.4.0`

- [ ] **Step 1: Bump the IdP package version**

In `package.json`, change:

```json
"@research-allies/next-auth-filemaker-idp": "^0.3.0"
```

to:

```json
"@research-allies/next-auth-filemaker-idp": "^0.4.0"
```

Then install:

```bash
npm install
```

- [ ] **Step 2: Revert `src/auth.ts` to the plain JWT callback**

Remove the `import type { JWT }` line and the `import { enrichProjectsWithDatabase }` line. Remove the `const baseJwtCallback = createJwtCallback()` declaration. Replace the wrapping `jwt` callback with the plain call:

The full updated `src/auth.ts`:

```ts
// src/auth.ts
import NextAuth from "next-auth";
import {
  loadConfigFromEnv,
  createFileMakerProvider,
  createJwtCallback,
  createSessionCallback,
} from "@research-allies/next-auth-filemaker-idp";
import { ROLES } from "@/lib/roles";
import { getEventLogger } from "@/lib/event-logger";

const fmConfig = loadConfigFromEnv();

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
    jwt: createJwtCallback(),
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

- [ ] **Step 3: Update `src/contexts/ProjectContext.tsx`**

Replace the `EnrichedProjectAssignment` import and cast with `ProjectAssignment` from the IdP package directly. The full updated file:

```tsx
'use client';

import { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import type { ProjectAssignment } from '@research-allies/next-auth-filemaker-idp';

interface ProjectContextValue {
  projects: ProjectAssignment[];
  selectedProject: ProjectAssignment | null;
  setSelectedProject: (project: ProjectAssignment) => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

const STORAGE_KEY = 'ra_selected_project_id';

export function ProjectProvider({
  children,
  requiredRole,
}: {
  children: React.ReactNode;
  requiredRole: string;
}) {
  const { data: session } = useSession();

  const projects = useMemo(
    () => (session?.user?.projects ?? []).filter((p) => p.roles.includes(requiredRole)),
    [session?.user?.projects, requiredRole],
  );

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setSelectedProjectId(stored);
    } catch {
      // Ignore storage errors (private browsing, quota exceeded)
    }
  }, []);

  const selectedProject = useMemo(
    () => projects.find((p) => p.projectId === selectedProjectId) ?? projects[0] ?? null,
    [projects, selectedProjectId],
  );

  function setSelectedProject(project: ProjectAssignment) {
    try {
      localStorage.setItem(STORAGE_KEY, project.projectId);
    } catch {
      // Ignore storage errors (private browsing, quota exceeded)
    }
    setSelectedProjectId(project.projectId);
  }

  return (
    <ProjectContext.Provider value={{ projects, selectedProject, setSelectedProject }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProjectContext() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProjectContext must be used within ProjectProvider');
  return ctx;
}
```

- [ ] **Step 4: Delete the enrichment files**

```bash
rm src/lib/enrich-projects.ts src/lib/project-types.ts
```

- [ ] **Step 5: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors. `types/next-auth.d.ts` already declares `projects: ProjectAssignment[]` — no changes needed there. `projectDatabase` will now be present on `ProjectAssignment` via the updated package.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/auth.ts src/contexts/ProjectContext.tsx
git rm src/lib/enrich-projects.ts src/lib/project-types.ts
git commit -m "refactor: remove enrichment layer — projectDatabase now comes from IdP at sign-in

Bumps next-auth-filemaker-idp to 0.4.0 which includes projectDatabase on
ProjectAssignment directly. Removes enrich-projects.ts, project-types.ts,
and the wrapping JWT callback."
```

---

## Task 3: Clean up validate-app

**Repo:** `~/Developer/GitHub/research-allies/validate-app`

**Files:**
- Delete: `src/lib/enrich-projects.ts`
- Delete: `src/lib/project-types.ts`
- Modify: `src/auth.ts`
- Modify: `types/next-auth.d.ts`
- Modify: `src/contexts/ProjectContext.tsx`
- Modify: `package.json`

**Interfaces:**
- Consumes: `ProjectAssignment.projectDatabase` from `@research-allies/next-auth-filemaker-idp@0.4.0`

- [ ] **Step 1: Bump the IdP package version**

In `package.json`, change:

```json
"@research-allies/next-auth-filemaker-idp": "^0.3.1"
```

to:

```json
"@research-allies/next-auth-filemaker-idp": "^0.4.0"
```

Then install:

```bash
npm install
```

- [ ] **Step 2: Revert `src/auth.ts` to the plain JWT callback**

The full updated `src/auth.ts` (same pattern as design-app, except no `ROLES` import change and uses validate-app's event logger):

```ts
// src/auth.ts
import NextAuth from "next-auth";
import {
  loadConfigFromEnv,
  createFileMakerProvider,
  createJwtCallback,
  createSessionCallback,
} from "@research-allies/next-auth-filemaker-idp";
import { getEventLogger } from "@/lib/event-logger";
import { ROLES } from "@/lib/roles";

const fmConfig = loadConfigFromEnv();

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
    jwt: createJwtCallback(),
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
  session: {
    strategy: "jwt",
    maxAge: 60 * 60,
    updateAge: 5 * 60,
  },
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

- [ ] **Step 3: Update `types/next-auth.d.ts`**

Replace `EnrichedProjectAssignment` with `ProjectAssignment` from the IdP package:

```ts
import { DefaultSession } from "next-auth";
import { FileMakerUser, ProjectAssignment } from "@research-allies/next-auth-filemaker-idp";

declare module "next-auth" {
  interface User extends FileMakerUser {}

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
    id?: string;
    userName?: string;
    nameFirst?: string;
    nameLast?: string;
    projects?: ProjectAssignment[];
  }
}
```

- [ ] **Step 4: Update `src/contexts/ProjectContext.tsx`**

Replace the `EnrichedProjectAssignment` import with `ProjectAssignment` from the IdP package. The full updated file:

```tsx
// src/contexts/ProjectContext.tsx
'use client';

import { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import type { ProjectAssignment } from '@research-allies/next-auth-filemaker-idp';

interface ProjectContextValue {
  projects: ProjectAssignment[];
  selectedProject: ProjectAssignment | null;
  setSelectedProject: (project: ProjectAssignment) => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

const STORAGE_KEY = 'ra_selected_project_id';

export function ProjectProvider({
  children,
  requiredRole,
}: {
  children: React.ReactNode;
  requiredRole: string;
}) {
  const { data: session } = useSession();

  const projects = useMemo(
    () => (session?.user?.projects ?? []).filter((p) => p.roles.includes(requiredRole)),
    [session?.user?.projects, requiredRole],
  );

  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setSelectedProjectId(stored);
    } catch {
      // Ignore storage errors (private browsing, quota exceeded)
    }
  }, []);

  const selectedProject = useMemo(
    () => projects.find((p) => p.projectId === selectedProjectId) ?? projects[0] ?? null,
    [projects, selectedProjectId],
  );

  function setSelectedProject(project: ProjectAssignment) {
    try {
      localStorage.setItem(STORAGE_KEY, project.projectId);
    } catch {
      // Ignore storage errors (private browsing, quota exceeded)
    }
    setSelectedProjectId(project.projectId);
  }

  return (
    <ProjectContext.Provider value={{ projects, selectedProject, setSelectedProject }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProjectContext() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProjectContext must be used within ProjectProvider');
  return ctx;
}
```

- [ ] **Step 5: Delete the enrichment files**

```bash
rm src/lib/enrich-projects.ts src/lib/project-types.ts
```

- [ ] **Step 6: Run typecheck**

```bash
npm run typecheck
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/auth.ts types/next-auth.d.ts src/contexts/ProjectContext.tsx
git rm src/lib/enrich-projects.ts src/lib/project-types.ts
git commit -m "refactor: remove enrichment layer — projectDatabase now comes from IdP at sign-in

Bumps next-auth-filemaker-idp to 0.4.0 which includes projectDatabase on
ProjectAssignment directly. Removes enrich-projects.ts, project-types.ts,
and the wrapping JWT callback."
```

---

## Task 4: Update the `ra-project-context` skill

**Repo:** `~/Developer/GitHub/research-allies/claude-skills`

**Files:**
- Modify: `ra-project-context/SKILL.md`

**Interfaces:**
- Consumes: `ProjectAssignment.projectDatabase` (Task 1)

- [ ] **Step 1: Replace `ra-project-context/SKILL.md`**

The skill was reverted to its pre-enrichment state (commit `ef908ba`). Now update it to reflect the new world: `projectDatabase` comes from the IdP at sign-in, no enrichment step needed. The full updated file:

```markdown
---
name: ra-project-context
description: Use when a Research Allies Next.js app needs global project-context switching with a ProjectProvider, useProjectContext hook, and OData scoping.
---

# Research Allies Project Context

Global project-context switching for Research Allies Next.js applications. Provides a `ProjectProvider`, `useProjectContext` hook, a Header chip for switching between projects, and OData integration for scoping data queries to the selected project's FileMaker database.

## Prerequisites

- `ra-nextjs-setup` — project scaffolded with App Router and `src/` directory
- `ra-filemaker-auth` Phase 2 complete — `SessionProvider` in layout, `ROLES` constant defined in `src/lib/roles.ts`
- `ra-web-components` — `Header` component exists at `src/components/Header.tsx`
- `@research-allies/next-auth-filemaker-idp >= 0.4.0` — `ProjectAssignment` includes `projectDatabase`

## State Detection

Check whether `ProjectContext` is already set up:

```bash
ls src/contexts/ProjectContext.tsx 2>/dev/null && echo "EXISTS" || echo "NOT FOUND"
```

**If EXISTS:** Skip to the [OData Integration](#odata-integration) section if data-layer wiring is not yet done. Otherwise, done.

**If NOT FOUND:** Follow all steps below.

---

## Step 1: Create `src/contexts/ProjectContext.tsx`

```typescript
'use client';

import { createContext, useContext, useState, useEffect, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import type { ProjectAssignment } from '@research-allies/next-auth-filemaker-idp';

interface ProjectContextValue {
  projects: ProjectAssignment[];
  selectedProject: ProjectAssignment | null;
  setSelectedProject: (project: ProjectAssignment) => void;
}

const ProjectContext = createContext<ProjectContextValue | null>(null);

const STORAGE_KEY = 'ra_selected_project_id';

export function ProjectProvider({
  children,
  requiredRole,
}: {
  children: React.ReactNode;
  requiredRole: string;
}) {
  const { data: session } = useSession();

  // useMemo stabilizes the array reference — without it, a new array is created on every render,
  // causing any downstream useEffect([projects]) to fire on every render.
  const projects = useMemo(
    () => (session?.user?.projects ?? []).filter((p) => p.roles.includes(requiredRole)),
    [session?.user?.projects, requiredRole],
  );

  // Initialize to null on both server and client — read localStorage in useEffect after mount.
  // Using typeof window in the useState initializer causes a hydration mismatch because the
  // server always gets null while the client gets the stored value.
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) setSelectedProjectId(stored);
    } catch {
      // Ignore storage errors (private browsing, quota exceeded)
    }
  }, []);

  const selectedProject = useMemo(
    () => projects.find((p) => p.projectId === selectedProjectId) ?? projects[0] ?? null,
    [projects, selectedProjectId],
  );

  function setSelectedProject(project: ProjectAssignment) {
    try {
      localStorage.setItem(STORAGE_KEY, project.projectId);
    } catch {
      // Ignore storage errors (private browsing, quota exceeded)
    }
    setSelectedProjectId(project.projectId);
  }

  return (
    <ProjectContext.Provider value={{ projects, selectedProject, setSelectedProject }}>
      {children}
    </ProjectContext.Provider>
  );
}

export function useProjectContext() {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProjectContext must be used within ProjectProvider');
  return ctx;
}
```

`ProjectAssignment` (from `@research-allies/next-auth-filemaker-idp`) shape:
```typescript
interface ProjectAssignment {
  projectId: string;
  projectName: string;
  projectDatabase: string; // FileMaker database name for OData queries scoped to this project
  roles: string[];
}
```

`projectDatabase` is populated by the IdP at sign-in — no enrichment step required.

---

## Step 2: Wrap Layout with `ProjectProvider`

In `src/app/layout.tsx`, import `ProjectProvider` and wrap `{children}` inside `SessionProvider`:

```typescript
import { ProjectProvider } from '@/contexts/ProjectContext';
import { ROLES } from '@/lib/roles';

// Inside ThemeRegistry > SessionProvider:
<SessionProvider>
  <ProjectProvider requiredRole={ROLES.APP_ACCESS}>
    {children}
  </ProjectProvider>
</SessionProvider>
```

> **Order matters:** `ProjectProvider` must be inside `SessionProvider` (it calls `useSession()`), and inside `ThemeRegistry` (the chip uses MUI components).

---

## Step 3: Add Project Chip to Header

Update `src/components/Header.tsx` to add the project switcher chip in the actions area (right side, before the theme toggle).

Add these imports:

```typescript
import { useState } from 'react';
import Chip from '@mui/material/Chip';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import { useProjectContext } from '@/contexts/ProjectContext';
```

Add inside the `Header` component function body (before the return):

```typescript
const { projects, selectedProject, setSelectedProject } = useProjectContext();
const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
const isMultiProject = projects.length > 1;
```

In the JSX, inside the actions `<Box>`, **before** the theme toggle `<Tooltip>`:

```tsx
{selectedProject && (
  <>
    <Chip
      label={selectedProject.projectName}
      size="medium"
      onClick={isMultiProject ? (e) => setAnchorEl(e.currentTarget) : undefined}
      clickable={isMultiProject}
    />
    {isMultiProject && (
      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={() => setAnchorEl(null)}
      >
        {projects.map((p) => (
          <MenuItem
            key={p.projectId}
            selected={p.projectId === selectedProject.projectId}
            onClick={() => {
              setSelectedProject(p);
              setAnchorEl(null);
            }}
          >
            {p.projectName}
          </MenuItem>
        ))}
      </Menu>
    )}
  </>
)}
```

---

## OData Integration

`projectDatabase` on the selected project is the FileMaker database name to use for OData queries scoped to that project. Pass `projectId` to API routes as a query parameter; on the server, look up the project from the session to get its `projectDatabase`.

### Client-side fetch

```typescript
'use client';
import { useProjectContext } from '@/contexts/ProjectContext';

const { selectedProject } = useProjectContext();

const res = await fetch(`/api/studies?projectId=${selectedProject?.projectId}`);
```

### API route (server-side)

```typescript
// src/app/api/studies/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { fmClient } from '@/lib/filemaker';

export async function GET(request: NextRequest) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const projectId = request.nextUrl.searchParams.get('projectId');
  if (!projectId) return NextResponse.json({ error: 'projectId required' }, { status: 400 });

  // Validate ownership and get projectDatabase in one step
  const project = session.user.projects.find(
    (p) => p.projectId === projectId && p.roles.includes('APP_ACCESS'),
  );
  if (!project) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  if (!project.projectDatabase) return NextResponse.json({ error: 'Project has no database configured' }, { status: 500 });

  const client = fmClient(project.projectDatabase);
  const { data } = await client.get('/Studies');
  return NextResponse.json(data);
}
```

> **Security:** The ownership check (`session.user.projects.find(...)`) is the security boundary — `projectId` from the query string is untrusted input. The `projectDatabase` value used for routing comes from the server-side session, not the client.

> **`projectDatabase` is optional (`string | undefined`):** Guard before passing to `fmClient`. The guard above treats a missing value as a server misconfiguration (500). Alternatively, omit the route entirely if all apps are guaranteed to have `FM_IdP_FIELD_PROJECT_DATABASE` set.

> **`fmClient(database?)`:** Pass `project.projectDatabase` to route the OData call to the correct FileMaker database. `FM_ODATA_SERVICE_DATABASE` is the Hub (used for Hub-level queries with no argument); project-specific queries pass the database explicitly.

---

## Verify Setup

1. Sign in as a multi-project user — chip appears in the header with a dropdown
2. Select a different project — chip label updates immediately
3. Refresh the page — chip shows the previously selected project (localStorage)
4. Sign in as a single-project user — chip appears but is non-interactive
5. Call an API route with `?projectId=<id>` — data is scoped to that project's database
6. Call with a `projectId` not in the user's session — receive a 403

---

## Next Steps

- **`ra-filemaker-odata`** — for full OData query reference and `fmClient()` setup
- **`ra-filemaker-auth`** — for `hasRole()` and route-level guards that complement project-level filtering
```

- [ ] **Step 2: Commit**

```bash
git -C ~/Developer/GitHub/research-allies/claude-skills add ra-project-context/SKILL.md
git -C ~/Developer/GitHub/research-allies/claude-skills commit -m "feat(ra-project-context): update for IdP-native projectDatabase (0.4.0)

No enrichment step needed — projectDatabase is now part of ProjectAssignment
returned by the IdP at sign-in. Removes prerequisites around OData /project
access and simplifies ProjectContext template."
```
