# Implementation Plan: `@your-org/next-auth-filemaker-idp`

## Context

The project needs a reusable Auth.js v5 provider package that authenticates users against an on-premises FileMaker Server via the Data API, then queries OData for role/project privileges. This package will be installed in multiple NextJS apps (Monitor, Design) via GitHub Packages. The repo is brand new (only LICENSE + README exist).

**Key architectural decisions:**
- **Auth.js v5** (latest, ESM-first, `auth.ts` root config pattern)
- **GitHub Packages** (private, scoped `@org/next-auth-filemaker-idp`)
- **Configurable schema** (table names, field names passed per-app)
- **FileMaker Server on-prem** (Basic Auth for both Data API and OData)
- **JWT session strategy** (FM token in JWT server-side only; role/projects forwarded to client session)

---

## Package Structure

```
next-auth-filemaker-IdP/
├── src/
│   ├── index.ts              # Re-exports all public API
│   ├── types.ts              # All TypeScript interfaces
│   ├── errors.ts             # Custom error classes
│   ├── utils.ts              # Base64 encoding, URL builders
│   ├── filemaker-client.ts   # FM Data API client (login/logout/validate)
│   ├── odata-client.ts       # OData query client (roles/projects)
│   ├── provider.ts           # Auth.js CredentialsProvider factory
│   ├── callbacks.ts          # JWT + Session callback factories, token helpers
│   └── components/
│       └── FileMakerLoginForm.tsx  # "use client" login form component
├── __tests__/
│   ├── filemaker-client.test.ts
│   ├── odata-client.test.ts
│   ├── provider.test.ts
│   └── callbacks.test.ts
├── package.json
├── tsconfig.json
├── tsup.config.ts            # Dual CJS/ESM build
├── vitest.config.ts
├── .gitignore
├── .github/workflows/publish.yml
├── LICENSE                   # (exists)
└── README.md                 # (exists, will expand)
```

---

## Implementation Steps

### Step 1: Project scaffolding
Set up the foundation of the npm package — the configuration files that define how the project is built, what dependencies it needs, and how it gets published to GitHub Packages.

**Files:** `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `.gitignore`

- `package.json`: Scoped name, `"type": "module"`, dual CJS/ESM exports, `next-auth@^5` as peer dep, dev deps: `typescript`, `tsup`, `vitest`, `@types/node`. `publishConfig` pointing to GitHub Packages.
- `tsconfig.json`: `target: ES2020`, `module: ESNext`, `moduleResolution: bundler`, `strict: true`
- `tsup.config.ts`: Entry `src/index.ts`, formats `["cjs", "esm"]`, `dts: true`, externalize `next-auth`, `@auth/core`, `react`, `react-dom`
- Peer deps: `next-auth@^5`, `react@^18 || ^19`, `react-dom@^18 || ^19`
- No runtime dependencies beyond Node 18+ built-in `fetch`

### Step 2: Types and errors
Define the data shapes and configuration options that every other module depends on. This is where we specify what settings each consuming app must provide (FM host, database, table/field names) and what a user object looks like after authentication.

**Files:** `src/types.ts`, `src/errors.ts`

**`FileMakerIdPConfig`** (top-level config consumers pass):
- `host: string` — FM Server hostname
- `database: string` — Database name for Data API login
- `odata: ODataConfig` — Contains `database`, `tableName`, `fields: ODataFieldMapping`
- `useHttps?: boolean` (default `true`)
- `fetch?: typeof globalThis.fetch` — Injectable for self-signed cert handling

**`ODataFieldMapping`** (configurable per-app):
- `usernameField: string` — Field used in `$filter`
- `roleField: string` — Field holding the role value
- `projectField: string` — Field holding project identifier(s)
- `additionalFields?: string[]`

**`FileMakerUser`** (returned from `authorize`, stored in JWT):
- `id`, `name`, `fmToken`, `fmTokenIssuedAt`, `role`, `projects: string[]`

**Error classes:** `FileMakerIdPError` (base), `FileMakerAuthError`, `ODataQueryError`, `ConfigurationError`

### Step 3: Utilities
Create shared helper functions used by the FM and OData clients — things like encoding credentials for HTTP Basic Auth and building the correct API URLs from the configuration.

**File:** `src/utils.ts`

- `encodeBasicAuth(username, password)` — Base64 encode credentials
- `buildDataApiBaseUrl(config)` — `https://{host}/fmi/data/vLatest/databases/{db}`
- `buildODataBaseUrl(config)` — `https://{host}/fmi/odata/v4/{db}`
- `escapeODataFieldName(name)` — Double-quote fields with special chars
- `getFetch(config)` — Return custom or global fetch

### Step 4: FileMaker Data API client
Build the module that talks directly to FileMaker Server to verify a user's credentials. This is the core authentication step — if the username/password are valid, FileMaker returns a session token.

**File:** `src/filemaker-client.ts`

- **`fmLogin(config, username, password): Promise<string>`**
  - `POST /fmi/data/vLatest/databases/{db}/sessions` with `Authorization: Basic base64(user:pass)`, body `{}`
  - Returns the session token string
  - Throws `FileMakerAuthError` on 401, `FileMakerIdPError` on network errors

- **`fmLogout(config, token): Promise<void>`**
  - `DELETE /fmi/data/vLatest/databases/{db}/sessions/{token}`
  - Fire-and-forget (logs warnings, never throws)

- **`fmValidateSession(config, token): Promise<boolean>`**
  - `GET /fmi/data/vLatest/validateSession` with `Authorization: Bearer {token}`
  - Returns boolean

**Test:** `__tests__/filemaker-client.test.ts` — Mock fetch, test success/failure/network error paths

### Step 5: OData client
Build the module that queries FileMaker via OData to look up what role and project(s) a user is assigned to. These privileges are what the web apps use to control access to pages and features.

**File:** `src/odata-client.ts`

- **`queryUserPrivileges(config, username, password): Promise<UserPrivileges>`**
  - `GET /fmi/odata/v4/{db}/{table}?$filter={usernameField} eq '{username}'&$select={roleField},{projectField}`
  - Auth: `Authorization: Basic base64(user:pass)` (stateless, per-request)
  - Extracts `role` from first record, collects unique `projects` across all matching records
  - Throws `ODataQueryError` on failure or no records found

**Test:** `__tests__/odata-client.test.ts` — Mock fetch, test URL construction, field escaping, multi-row project collection

### Step 6: Auth.js provider
Wire the FM login and OData lookup together into an Auth.js provider — the single piece that plugs into NextAuth so it knows how to authenticate users. When a user submits their credentials, this orchestrates the full flow: verify with FM, then fetch their privileges.

**File:** `src/provider.ts`

- **`createFileMakerProvider(config)`** — Returns a configured `Credentials({...})` provider:
  - `id: "filemaker"`, credentials fields: `username` (text), `password` (password)
  - `authorize` callback:
    1. Validate credentials exist
    2. Call `fmLogin()` — if fails, return `null`
    3. Call `queryUserPrivileges()` — if fails, log warning but continue with empty privileges
    4. Return `FileMakerUser` object

> **Security note:** When OData is unavailable or misconfigured, the user will be authenticated but have an empty `role` and `projects`. This is by design — the package handles *authentication*, not *authorization*. Consuming apps **must** verify that `session.user.role` and `session.user.projects` are non-empty before granting access to protected resources. Treat empty privileges as unauthorized.

**Test:** `__tests__/provider.test.ts` — Mock `fmLogin` + `queryUserPrivileges`, test success/auth-failure/odata-failure paths

### Step 7: JWT and Session callbacks
Control what user data gets stored in the encrypted JWT token and what gets exposed to the browser session. The key security decision here: the FM server token stays hidden server-side, while role and projects are made available to the app for access control.

**File:** `src/callbacks.ts`

- **`createJwtCallback(config)`** — On `signIn` trigger, copies `fmToken`, `fmTokenIssuedAt`, `role`, `projects` from user to JWT token
- **`createSessionCallback(config)`** — Forwards `role`, `projects`, `id`, `name` from JWT to session. **Excludes `fmToken`** (security: must not reach client)
- **`extractFmToken(jwt): string | null`** — Helper for server-side FM API calls
- **`isFmTokenFresh(jwt, marginSeconds?): boolean`** — Checks 15min inactivity window

**Test:** `__tests__/callbacks.test.ts` — Test JWT population on signIn, session excludes fmToken, freshness check

### Step 8: Login form component
Provide a reusable login UI component so both Monitor and Design get a consistent sign-in experience out of the box, without each app having to build its own login form.

**File:** `src/components/FileMakerLoginForm.tsx`

A `"use client"` React component that provides a ready-to-use login form:

- **Props:**
  - `callbackUrl?: string` — Where to redirect after login (default: the page user came from, or `/`)
  - `className?: string` — CSS class for the outer `<form>` element
  - `onError?: (error: string) => void` — Callback when login fails (for custom error display)

- **Behavior:**
  - Renders username + password inputs and a submit button
  - Calls `signIn("filemaker", { username, password, callbackUrl })` on submit
  - Displays an error message if authentication fails
  - Minimal default styling (easy to override via className or wrapping)

- **Peer deps added:** `react` and `react-dom` (already present in all NextJS apps)

### Step 9: Main entry point
Create the single file that defines what consumers get when they `import` from this package. Everything the apps need is exported from one place.

**File:** `src/index.ts`

Re-exports: `createFileMakerProvider`, `createJwtCallback`, `createSessionCallback`, `extractFmToken`, `isFmTokenFresh`, `fmLogin`, `fmLogout`, `fmValidateSession`, `queryUserPrivileges`, `FileMakerLoginForm`, all types, all error classes.

### Step 10: CI/CD and documentation
Set up automated publishing so that creating a GitHub release automatically builds, tests, and publishes a new version of the package to GitHub Packages. Update the README with installation and usage instructions.

**Files:** `.github/workflows/publish.yml`, `README.md`

- GitHub Actions workflow: on release → checkout → install → typecheck → test → build → `npm publish` to GitHub Packages
- README: Installation, configuration, consuming app integration example, module augmentation snippet, environment variables

---

## Consuming App Integration Example

```typescript
// auth.ts (in Monitor or Design app)
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

Apps add a `types/next-auth.d.ts` to augment Auth.js types with `role` and `projects` on the Session/JWT interfaces.

---

## Verification

1. **Build:** `npm run build` — produces `dist/` with `.js`, `.cjs`, `.d.ts` files
2. **Typecheck:** `npm run typecheck` — no errors
3. **Unit tests:** `npm test` — all pass with mocked fetch
4. **Manual integration test:** Install in a test NextJS app, configure against a FM Server, verify:
   - Login with valid credentials → session contains role + projects
   - Login with invalid credentials → redirected to error/login page
   - Session object does NOT expose `fmToken`
   - `extractFmToken()` works in server-side routes
5. **Publish:** Create a GitHub release → workflow publishes to GitHub Packages
