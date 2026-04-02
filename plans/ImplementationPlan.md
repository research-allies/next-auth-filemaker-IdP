# Implementation Plan: `@research-allies/next-auth-filemaker-idp`

## Context

The project needs a reusable Auth.js v5 provider package that authenticates users against an on-premises FileMaker Server via the Data API, then queries the user's profile and role/project privileges via the same Data API. This package is installed in consuming NextJS apps via GitHub Packages.

**Key architectural decisions:**
- **Auth.js v5** (latest, ESM-first, `auth.ts` root config pattern)
- **GitHub Packages** (private, scoped `@research-allies/next-auth-filemaker-idp`)
- **Environment-driven config** (all settings via env vars; `.env.local` for dev, service env vars for production)
- **FileMaker Data API only** (credential validation via session endpoint; profile + privileges via Find with portal data)
- **JWT session strategy** (no FM tokens in JWT; identity + role/project assignments forwarded to client session)

---

## Package Structure

```
next-auth-filemaker-IdP/
├── src/
│   ├── index.ts              # Re-exports all public API
│   ├── types.ts              # All TypeScript interfaces
│   ├── env.ts                # loadConfigFromEnv() — reads env vars into FileMakerIdPConfig
│   ├── errors.ts             # Custom error classes
│   ├── utils.ts              # Base64 encoding, URL builders
│   ├── filemaker-client.ts   # FM Data API client (login/logout/find user)
│   ├── provider.ts           # Auth.js CredentialsProvider factory
│   ├── callbacks.ts          # JWT + Session callback factories, token helpers
│   ├── client.ts             # "use client" barrel — exports FileMakerLoginForm via ./client subpath
│   └── components/
│       └── FileMakerLoginForm.tsx  # Login form component ("use client" injected at build time)
├── __tests__/
│   ├── env.test.ts
│   ├── filemaker-client.test.ts
│   ├── provider.test.ts
│   └── callbacks.test.ts
├── package.json
├── tsconfig.json
├── tsup.config.ts            # Dual CJS/ESM build
├── vitest.config.ts
├── .env.example              # Template of all required env vars
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
  - `"exports"`: two subpaths:
    - `"."` → `{ "import": "./dist/index.js", "require": "./dist/index.cjs", "types": "./dist/index.d.ts" }` — server-side API
    - `"./client"` → `{ "import": "./dist/client.js", "require": "./dist/client.cjs", "types": "./dist/client.d.ts" }` — client-only (`FileMakerLoginForm`)
  - `"files": ["dist", ".env.example"]` — only publish build output and env template (excludes `src/`, `__tests__/`, etc.)
- `tsconfig.json`: `target: ES2020`, `module: ESNext`, `moduleResolution: bundler`, `strict: true`
- `tsup.config.ts`: Entry `src/index.ts`, formats `["cjs", "esm"]`, `dts: true`, externalize `next-auth`, `@auth/core`, `react`, `react-dom`, `next`
- Peer deps: `next-auth@^5`, `react@^18 || ^19`, `react-dom@^18 || ^19`
- No runtime dependencies beyond Node 18+ built-in `fetch`

### Step 2: Types and errors
Define the data shapes and configuration options that every other module depends on. This is where we specify what settings each consuming app must provide (FM host, database, table/field names) and what a user object looks like after authentication.

**Files:** `src/types.ts`, `src/errors.ts`

**`FileMakerIdPConfig`** (built from environment variables via `loadConfigFromEnv()`):
- `host` ← `FM_IdP_HOST` — FM Server hostname
- `database` ← `FM_IdP_DATABASE` — Database name for Data API
- `useHttps` ← `FM_IdP_USE_HTTPS` (default `true`)
- `serviceUsername` ← `FM_IdP_SERVICE_USERNAME` — Backend service account for profile/privilege queries
- `servicePassword` ← `FM_IdP_SERVICE_PASSWORD` — Backend service account password
- `userLayout` ← `FM_IdP_USER_LAYOUT` (default `"IdP_user"`) — Data API layout name for user profile + portal
- `fields` — FieldMapping (see below)
- `timeout` ← `FM_IdP_TIMEOUT` (default `10000`) — request timeout in milliseconds for all fetch calls
- `fetch?: typeof globalThis.fetch` — programmatic override only (not from env), for self-signed cert handling

**`FieldMapping`** (from env vars):
- `idUserField` ← `FM_IdP_FIELD_ID_USER` (default `"id_user"`) — PK on User table
- `usernameField` ← `FM_IdP_FIELD_USERNAME` (default `"userName"`) — used in Find query
- `nameFirstField` ← `FM_IdP_FIELD_NAME_FIRST` (default `"nameFirst"`)
- `nameLastField` ← `FM_IdP_FIELD_NAME_LAST` (default `"nameLast"`)
- `emailField` ← `FM_IdP_FIELD_EMAIL` (default `"email"`)
- `portalName` ← `FM_IdP_PORTAL_NAME` (default `"user_project_role"`) — portal name on the User layout (case-sensitive, matches FM relationship name)
- `projectIdField` ← `FM_IdP_FIELD_PROJECT_ID` (default `"project::id_project"`) — portal field, `TableName::fieldName` format
- `projectNameField` ← `FM_IdP_FIELD_PROJECT_NAME` (default `"project::projectName"`) — portal field, `TableName::fieldName` format
- `roleNameField` ← `FM_IdP_FIELD_ROLE_NAME` (default `"role::roleName"`) — portal field, `TableName::fieldName` format

**`.env.example`** (shipped with the package as a reference):
```
# FileMaker Server connection
FM_IdP_HOST=fm.example.com
FM_IdP_DATABASE=IdP_Accounts
# FM_IdP_USE_HTTPS=true

# Service account for backend profile/privilege queries (not the end user's credentials)
FM_IdP_SERVICE_USERNAME=
FM_IdP_SERVICE_PASSWORD=

# Auth.js secret — standard NextAuth env var (generate with: openssl rand -base64 32)
AUTH_SECRET=

# Data API layout for user profile lookup (includes userProjectRole portal)
# FM_IdP_USER_LAYOUT=IdP_user

# Request timeout in milliseconds (default: 10000)
# FM_IdP_TIMEOUT=10000

# User table fields (defaults shown — only override if your schema differs)
# FM_IdP_FIELD_ID_USER=id_user
# FM_IdP_FIELD_USERNAME=userName
# FM_IdP_FIELD_NAME_FIRST=nameFirst
# FM_IdP_FIELD_NAME_LAST=nameLast
# FM_IdP_FIELD_EMAIL=email

# UserProjectRole portal fields (portal rows use TableName::fieldName format)
# FM_IdP_PORTAL_NAME=user_project_role
# FM_IdP_FIELD_PROJECT_ID=project::id_project
# FM_IdP_FIELD_PROJECT_NAME=project::projectName
# FM_IdP_FIELD_ROLE_NAME=role::roleName
```

**`UserProfile`** (identity-only; returned as the `profile` field from `fmFindUserWithPrivileges`):
- `id: string` (maps to `id_user`), `userName: string`, `nameFirst: string`, `nameLast: string`, `email: string`

**`FileMakerUser`** (extends `UserProfile`; returned from `authorize`, forwarded into the JWT):
- All `UserProfile` fields plus `projects: ProjectAssignment[]`

**`ProjectAssignment`** (one entry per project the user is assigned to):
- `projectId: string` (maps to `id_project`), `projectName: string` (maps to `projectName`), `roles: string[]` (maps to `roleName`)

**FileMaker schema** (four tables in IdP_Accounts.fmp12):
- **User** — `id_user` (PK, string), `userName` (string), `nameFirst` (string), `nameLast` (string), `email` (string), `status_bool` (number, internal use only — not exposed to the auth package)
- **Project** — `id_project` (PK, string), `projectName` (string)
- **Role** — `id_role` (PK, string), `roleName` (string)
- **UserProjectRole** — `id_userProjectRole` (PK), `id_user` (FK), `id_project` (FK), `id_role` (FK) — join table allowing a user to hold multiple roles across multiple projects

> **Note:** Passwords are not stored in the User table. FileMaker handles credential validation internally via the Data API session endpoint. The `userName` field maps to the FileMaker account name used for authentication.

**Error classes:** `FileMakerIdPError` (base), `FileMakerAuthError`, `FileMakerQueryError`, `ConfigurationError`
- `FileMakerQueryError` carries a `statusCode?: number` property (the HTTP status from the failed Data API response), for callers that need to distinguish error types by status code.

### Step 3: Environment config loader
Provide a function that reads `process.env` and returns a validated `FileMakerIdPConfig`. This is the single place where env vars are mapped to config — all other modules receive the typed config object.

**File:** `src/env.ts`

- **`loadConfigFromEnv(overrides?): FileMakerIdPConfig`**
  - Reads all `FM_IdP_*` env vars from `process.env`
  - Applies sensible defaults for field names, `useHttps`, and `timeout`
  - Throws `ConfigurationError` if required vars (`FM_IdP_HOST`, `FM_IdP_DATABASE`, `FM_IdP_SERVICE_USERNAME`, `FM_IdP_SERVICE_PASSWORD`) are missing
  - **Host validation:** validates `FM_IdP_HOST` is a bare hostname (e.g. `"fm.example.com"`) using `new URL()` — throws `FileMakerIdPError` if it includes a scheme, path, or other URL components
  - **Production HTTPS enforcement:** throws `FileMakerIdPError` if `FM_IdP_USE_HTTPS=false` when `NODE_ENV=production` — prevents credentials being sent over plain HTTP
  - **`FM_IdP_TIMEOUT`:** read from env (milliseconds, default `10000`); falls back to default on `NaN`
  - Accepts an optional `overrides` parameter (`Partial<Pick<FileMakerIdPConfig, "fetch" | "timeout">>`) for programmatic settings — `overrides.timeout` wins over the env var value
  - **⚠️ SECURITY: Server-only function** — This function reads `process.env` (including service account credentials) and **must only be called in server-side code** (e.g. `auth.ts`). Never import or call `loadConfigFromEnv` from client components or any code marked with `"use client"`. Doing so would expose service credentials to the browser.

**Test:** `__tests__/env.test.ts` — Set/unset env vars, test defaults, test `ConfigurationError` on missing required vars, test host validation, test production HTTPS enforcement, test `FM_IdP_TIMEOUT` parsing, test overrides merge (programmatic `timeout` wins over env var)

### Step 4: Utilities
Create shared helper functions used by the FM Data API client — things like encoding credentials for HTTP Basic Auth and building the correct API URLs from the configuration.

**File:** `src/utils.ts`

- `encodeBasicAuth(username, password)` — Base64 encode credentials
- `buildDataApiBaseUrl(config)` — `https://{host}/fmi/data/vLatest/databases/{db}` — database name is wrapped in `encodeURIComponent()` to handle names containing spaces or special characters safely
- `getFetch(config)` — Return custom or global fetch
- `sanitizeFmFindValue(value)` — Strips FM Find operator characters (`=!<>≤≥~*@#?/\"`) to prevent query injection in Find requests

### Step 5: FileMaker Data API client
Build the module that talks directly to FileMaker Server. This handles credential validation (session endpoint), user profile + privilege lookup (Find with portal), and session management.

**File:** `src/filemaker-client.ts`

- **`fmLogin(config, username, password): Promise<string>`**
  - `POST /fmi/data/vLatest/databases/{db}/sessions` with `Authorization: Basic base64(user:pass)`, body `{}`
  - Returns the session token string
  - Throws `FileMakerAuthError` on 401, `FileMakerIdPError` on network errors

- **`fmFindUserWithPrivileges(config, token, username): Promise<{ profile: UserProfile, projects: ProjectAssignment[] }>`**
  - `POST /fmi/data/vLatest/databases/{db}/layouts/{userLayout}/_find` with `Authorization: Bearer {token}`
  - Request body: `{ "query": [{ "{usernameField}": "=={username}" }], "portal": ["{portalName}"] }` — `==` is the FM exact-match operator; `=` ("begins with") is intentionally avoided to prevent false positives on partial username matches
  - Parses `response.data[0].fieldData` for profile fields (`id_user`, `nameFirst`, `nameLast`, `email`)
  - Parses `response.data[0].portalData["{portalName}"]` for project/role assignments — portal row keys are in `TableName::fieldName` format (e.g. `"project::projectName"`, `"role::roleName"`)
  - Groups portal rows by `projectIdField`, collecting all assigned roles per project into `ProjectAssignment[]`
  - Returns both profile and projects in a single result
  - Throws `FileMakerQueryError` on API failure or when no matching user is found
  - Returns empty `projects: []` array when user exists but has no portal rows (no assignments)
- **`fmLogout(config, token): Promise<void>`**
  - `DELETE /fmi/data/vLatest/databases/{db}/sessions/{token}`
  - Fire-and-forget (logs warnings, never throws)

> All functions wrap fetch calls with an internal `withTimeout(config)` helper that returns an `AbortController` signal honouring `config.timeout` (default 10000ms).

**Test:** `__tests__/filemaker-client.test.ts` — Mock fetch, test login success/failure, find user with portal parsing, portal row grouping into ProjectAssignment[], no-user-found error, empty portal (user with no assignments), logout

### Step 6: Auth.js provider
Wire the FM Data API calls together into an Auth.js provider — the single piece that plugs into NextAuth so it knows how to authenticate users. When a user submits their credentials, this orchestrates the full flow: validate credentials, then fetch their profile and privileges.

**File:** `src/provider.ts`

- **`createFileMakerProvider(config, options?: { id?: string })`** — Returns a configured `Credentials({...})` provider:
  - `id` defaults to `"filemaker"`; set a custom ID when running multiple FM providers side-by-side
  - Credentials fields: `username` (text), `password` (password)
  - `authorize` callback:
    1. Validate credentials exist (return `null` immediately if missing)
    2. Call `fmLogin` for both user and service account in parallel via `Promise.allSettled` — if user login fails (`FileMakerAuthError` or any other error), clean up any service token and return `null`
    3. On successful user login, immediately call `fmLogout(config, userToken)` (fire-and-forget) — the token is discarded; the user's FM credentials are validated but their session is never retained
    4. If service login failed, return `null`
    5. Call `fmFindUserWithPrivileges(config, serviceToken, username)` — Data API Find on User layout using the service token; if fails, return `null`
    6. On success: call `fmLogout(config, serviceToken)` fire-and-forget; on failure: close the service session via `.finally(() => fmLogout(config, serviceToken))`
    7. Return `FileMakerUser` object (identity + projects/roles only; no FM token stored)

> **Security note:** The user's credentials are validated first (step 3). The profile/privilege lookup (steps 5–6) uses a separate backend service account that has read access to the User layout and UserProjectRole portal. All steps must succeed for login to proceed. The service credentials never leave the server.

**Test:** `__tests__/provider.test.ts` — Mock `fmLogin` + `fmFindUserWithPrivileges`, test success/user-auth-failure/service-auth-failure/find-failure paths

### Step 7: JWT and Session callbacks
Control what user data gets stored in the encrypted JWT token and what gets exposed to the browser session. Identity fields and project/role assignments are forwarded to the session for app-level access control.

**File:** `src/callbacks.ts`

- **`createJwtCallback()`** — On `signIn` trigger, copies `id`, `userName`, `nameFirst`, `nameLast`, `email`, `projects` (array of `ProjectAssignment`) from user to JWT token; returns `FileMakerJWT`. Consuming apps should use optional module augmentation on `next-auth/jwt`'s `JWT` interface (with all FM fields marked `?`) so Auth.js accepts the return type without a cast.
- **`createSessionCallback()`** — Forwards `id`, `userName`, `nameFirst`, `nameLast`, `email`, `projects` from JWT to session
- **`FileMakerJWT`** (exported type) — Extends Auth.js `JWT` with optional FM fields: `id?`, `userName?`, `nameFirst?`, `nameLast?`, `projects?`; used internally and re-exported for consuming app type augmentation
- **`FileMakerSession`** (exported type) — Extends Auth.js `Session` with a fully-typed `user` object (all fields required); used for session type augmentation in consuming apps

**Test:** `__tests__/callbacks.test.ts` — Test JWT population on signIn, session shape matches expected fields

### Step 8: Login form component
Provide a reusable login UI component for consuming apps.

**Files:** `src/components/FileMakerLoginForm.tsx`, `src/client.ts`

A React component that provides a ready-to-use login form. The `"use client"` directive is **not** written in source — it is prepended to `dist/client.js` and `dist/client.cjs` at build time via a `prependUseClient()` helper called from tsup's `onSuccess` hook. (`tsup`'s `banner` option was not used because it gets stripped by rollup.) The component is exported via `src/client.ts` under the `./client` subpath export (not from the main index).

- **Props:**
  - `providerId?: string` — Provider ID to sign in with (default: `"filemaker"`; must match the `id` passed to `createFileMakerProvider`)
  - `callbackUrl?: string` — Where to redirect after login (default: the page user came from, or `/`)
  - `className?: string` — CSS class for the outer `<form>` element
  - `onError?: (error: string) => void` — Callback when login fails (for custom error display)

- **Behavior:**
  - Renders username + password inputs and a submit button
  - Calls `signIn(providerId, { username, password, callbackUrl, redirect: false })` on submit
  - On success: redirects via `window.location.href`; on error: displays message and calls `onError`
  - Shows loading state and disables inputs during submission
  - Minimal default styling (easy to override via `className` or wrapping)

- **Peer deps:** `react` and `react-dom` (already present in all NextJS apps)

### Step 9: Entry points
Define what consumers get when they import from the package.

**`src/index.ts`** (default entry — server-side API):
Re-exports: `loadConfigFromEnv`, `createFileMakerProvider`, `createJwtCallback`, `createSessionCallback`, `fmLogin`, `fmLogout`, `fmFindUserWithPrivileges`, all types (including `FileMakerJWT`, `FileMakerSession`), all error classes. Does **not** export `FileMakerLoginForm`.

**`src/client.ts`** (`./client` subpath entry — client-only):
Re-exports `FileMakerLoginForm` and `FileMakerLoginFormProps`. The `"use client"` directive is injected here at build time by tsup so bundlers correctly resolve the client boundary.

### Step 10: CI/CD and documentation ✅
GitHub Actions workflow publishes to GitHub Packages on release. README covers installation, environment variables, full `auth.ts` integration example, type augmentation snippet, login form usage, and route protection patterns.

**Files:** `.github/workflows/publish.yml`, `README.md`

> **Release checklist:** When creating the GitHub release, attach `FM files/IdP_Accounts.fmp12` as a release asset. This is the only distribution channel for the example database — it is intentionally excluded from the npm package (`"files"` in `package.json` only includes `dist` and `.env.example`). Consumers who need the example FileMaker backend should download it from the release assets and host it on their own FileMaker Server.

---

## Consuming App Integration Example

```typescript
// auth.ts (in consuming app)
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
  providers: [createFileMakerProvider(fmConfig)],
  callbacks: {
    ...authConfig.callbacks,
    jwt: createJwtCallback(),
    session: createSessionCallback(),
  },
  session: {
    strategy: "jwt",
    maxAge: 60 * 60,   // session expires 60 minutes after last activity
    updateAge: 5 * 60, // re-sign the JWT at most once every 5 minutes
  },
});
```

Each consuming app provides its own `.env.local` (copied from `.env.example`) with the FM connection details. No config is hardcoded in source.

Apps add a `types/next-auth.d.ts` to augment Auth.js types with `projects: ProjectAssignment[]` on the Session/JWT interfaces.

---

## Verification

1. **Build:** `npm run build` — produces `dist/` with `.js`, `.cjs`, `.d.ts` files
2. **Typecheck:** `npm run typecheck` — no errors
3. **Unit tests:** `npm test` — all pass with mocked fetch
4. **Manual integration test:** Install in a test NextJS app, configure against a FM Server, verify:
   - Login with valid credentials → session contains `projects` with roles
   - Login with invalid credentials → redirected to error/login page
   - Session object contains only identity + projects (no FM tokens)
5. **Publish:** Create a GitHub release → workflow publishes to GitHub Packages → attach `FM files/IdP_Accounts.fmp12` as a release asset
