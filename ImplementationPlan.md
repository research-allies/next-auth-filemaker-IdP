# Implementation Plan: `@your-org/next-auth-filemaker-idp`

## Context

The project needs a reusable Auth.js v5 provider package that authenticates users against an on-premises FileMaker Server via the Data API, then queries the user's profile and role/project privileges via the same Data API. This package will be installed in multiple NextJS apps via GitHub Packages. The repo is new (only LICENSE + README exist).

**Key architectural decisions:**
- **Auth.js v5** (latest, ESM-first, `auth.ts` root config pattern)
- **GitHub Packages** (private, scoped `@org/next-auth-filemaker-idp`)
- **Environment-driven config** (all settings via env vars; `.env.local` for dev, service env vars for production)
- **FileMaker Data API only** (credential validation via session endpoint; profile + privileges via Find with portal data)
- **JWT session strategy** (FM token in JWT server-side only; role/projects forwarded to client session)

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
│   └── components/
│       └── FileMakerLoginForm.tsx  # "use client" login form component
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
  - `"exports"`: `{ ".": { "import": "./dist/index.js", "require": "./dist/index.cjs", "types": "./dist/index.d.ts" } }`
  - `"files": ["dist", ".env.example"]` — only publish build output and env template (excludes `src/`, `__tests__/`, etc.)
- `tsconfig.json`: `target: ES2020`, `module: ESNext`, `moduleResolution: bundler`, `strict: true`
- `tsup.config.ts`: Entry `src/index.ts`, formats `["cjs", "esm"]`, `dts: true`, externalize `next-auth`, `@auth/core`, `react`, `react-dom`
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
- `fetch?: typeof globalThis.fetch` — Only programmatic override (not from env), for self-signed cert handling
- `userLayout` ← `FM_IdP_USER_LAYOUT` (default `"DAPI_USER"`) — Data API layout name for user profile + portal
- `fields` — FieldMapping (see below)

**`FieldMapping`** (from env vars):
- `idUserField` ← `FM_IdP_FIELD_ID_USER` (default `"id_user"`) — PK on User table
- `usernameField` ← `FM_IdP_FIELD_USERNAME` (default `"userName"`) — used in Find query
- `nameFirstField` ← `FM_IdP_FIELD_NAME_FIRST` (default `"nameFirst"`)
- `nameLastField` ← `FM_IdP_FIELD_NAME_LAST` (default `"nameLast"`)
- `emailField` ← `FM_IdP_FIELD_EMAIL` (default `"email"`)
- `portalName` ← `FM_IdP_PORTAL_NAME` (default `"userProjectRole"`) — portal name on the User layout (case-sensitive, matches FM relationship name)
- `projectIdField` ← `FM_IdP_FIELD_PROJECT_ID` (default `"project::id_project"`) — portal field, `TableName::fieldName` format
- `projectNameField` ← `FM_IdP_FIELD_PROJECT_NAME` (default `"project::projectName"`) — portal field, `TableName::fieldName` format
- `roleNameField` ← `FM_IdP_FIELD_ROLE_NAME` (default `"role::roleName"`) — portal field, `TableName::fieldName` format

**`.env.example`** (shipped with the package as a reference):
```
# FileMaker Server connection
FM_IdP_HOST=fm.example.com
FM_IdP_DATABASE=IdP_Accounts
FM_IdP_USE_HTTPS=true

# Service account for backend profile/privilege queries (not the end user's credentials)
FM_IdP_SERVICE_USERNAME=
FM_IdP_SERVICE_PASSWORD=

# Auth.js secret — standard NextAuth env var (generate with: openssl rand -base64 32)
AUTH_SECRET=

# Data API layout for user profile lookup (includes UserProjectRole portal)
FM_IdP_USER_LAYOUT=DAPI_USER

# User table fields (defaults shown — only override if your schema differs)
FM_IdP_FIELD_ID_USER=id_user
FM_IdP_FIELD_USERNAME=userName
FM_IdP_FIELD_NAME_FIRST=nameFirst
FM_IdP_FIELD_NAME_LAST=nameLast
FM_IdP_FIELD_EMAIL=email

# UserProjectRole portal fields (portal rows use TableName::fieldName format)
FM_IdP_PORTAL_NAME=userProjectRole
FM_IdP_FIELD_PROJECT_ID=project::id_project
FM_IdP_FIELD_PROJECT_NAME=project::projectName
FM_IdP_FIELD_ROLE_NAME=role::roleName
```

**`FileMakerUser`** (returned from `authorize`, stored in JWT):
- `id` (maps to `id_user`), `userName`, `nameFirst`, `nameLast`, `email`, `projects: ProjectAssignment[]`

**`ProjectAssignment`** (one entry per project the user is assigned to):
- `projectId: string` (maps to `id_project`), `projectName: string` (maps to `projectName`), `roles: string[]` (maps to `roleName`)

**FileMaker schema** (four tables in IdP_Accounts.fmp12):
- **User** — `id_user` (PK, string), `userName` (string), `nameFirst` (string), `nameLast` (string), `email` (string), `status_bool` (number, internal use only — not exposed to the auth package)
- **Project** — `id_project` (PK, string), `projectName` (string)
- **Role** — `id_role` (PK, string), `roleName` (string)
- **UserProjectRole** — `id_userProjectRole` (PK), `id_user` (FK), `id_project` (FK), `id_role` (FK) — join table allowing a user to hold multiple roles across multiple projects

> **Note:** Passwords are not stored in the User table. FileMaker handles credential validation internally via the Data API session endpoint. The `userName` field maps to the FileMaker account name used for authentication.

**Error classes:** `FileMakerIdPError` (base), `FileMakerAuthError`, `FileMakerQueryError`, `ConfigurationError`

### Step 3: Environment config loader
Provide a function that reads `process.env` and returns a validated `FileMakerIdPConfig`. This is the single place where env vars are mapped to config — all other modules receive the typed config object.

**File:** `src/env.ts`

- **`loadConfigFromEnv(overrides?): FileMakerIdPConfig`**
  - Reads all `FM_IdP_*` env vars from `process.env`
  - Applies sensible defaults for field names and `useHttps`
  - Throws `ConfigurationError` if required vars (`FM_IdP_HOST`, `FM_IdP_DATABASE`, `FM_IdP_SERVICE_USERNAME`, `FM_IdP_SERVICE_PASSWORD`) are missing
  - Accepts an optional `overrides` parameter for programmatic settings like `fetch`
  - **⚠️ SECURITY: Server-only function** — This function reads `process.env` (including service account credentials) and **must only be called in server-side code** (e.g. `auth.ts`). Never import or call `loadConfigFromEnv` from client components or any code marked with `"use client"`. Doing so would expose service credentials to the browser.
**Test:** `__tests__/env.test.ts` — Set/unset env vars, test defaults, test `ConfigurationError` on missing required vars, test overrides merge

### Step 4: Utilities
Create shared helper functions used by the FM Data API client — things like encoding credentials for HTTP Basic Auth and building the correct API URLs from the configuration.

**File:** `src/utils.ts`

- `encodeBasicAuth(username, password)` — Base64 encode credentials
- `buildDataApiBaseUrl(config)` — `https://{host}/fmi/data/vLatest/databases/{db}`
- `getFetch(config)` — Return custom or global fetch

### Step 5: FileMaker Data API client
Build the module that talks directly to FileMaker Server. This handles credential validation (session endpoint), user profile + privilege lookup (Find with portal), and session management.

**File:** `src/filemaker-client.ts`

- **`fmLogin(config, username, password): Promise<string>`**
  - `POST /fmi/data/vLatest/databases/{db}/sessions` with `Authorization: Basic base64(user:pass)`, body `{}`
  - Returns the session token string
  - Throws `FileMakerAuthError` on 401, `FileMakerIdPError` on network errors

- **`fmFindUserWithPrivileges(config, token, username): Promise<{ profile: UserProfile, projects: ProjectAssignment[] }>`**
  - `POST /fmi/data/vLatest/databases/{db}/layouts/{userLayout}/_find` with `Authorization: Bearer {token}`
  - Request body: `{ "query": [{ "{usernameField}": "={username}" }], "portal": ["{portalName}"] }`
  - Parses `response.data[0].fieldData` for profile fields (`id_user`, `nameFirst`, `nameLast`, `email`)
  - Parses `response.data[0].portalData["{portalName}"]` for project/role assignments — portal row keys are in `TableName::fieldName` format (e.g. `"project::projectName"`, `"role::roleName"`)
  - Groups portal rows by `projectIdField`, collecting all assigned roles per project into `ProjectAssignment[]`
  - Returns both profile and projects in a single result
  - Throws `FileMakerQueryError` on API failure or when no matching user is found
  - Returns empty `projects: []` array when user exists but has no portal rows (no assignments)
- **`fmLogout(config, token): Promise<void>`**
  - `DELETE /fmi/data/vLatest/databases/{db}/sessions/{token}`
  - Fire-and-forget (logs warnings, never throws)

**Test:** `__tests__/filemaker-client.test.ts` — Mock fetch, test login success/failure, find user with portal parsing, portal row grouping into ProjectAssignment[], no-user-found error, empty portal (user with no assignments), logout

### Step 6: Auth.js provider
Wire the FM Data API calls together into an Auth.js provider — the single piece that plugs into NextAuth so it knows how to authenticate users. When a user submits their credentials, this orchestrates the full flow: validate credentials, then fetch their profile and privileges.

**File:** `src/provider.ts`

- **`createFileMakerProvider(config)`** — Returns a configured `Credentials({...})` provider:
  - `id: "filemaker"`, credentials fields: `username` (text), `password` (password)
  - `authorize` callback:
    1. Validate credentials exist
    2. Call `fmLogin(config, username, password)` — validates the user's identity; if fails, return `null`; immediately call `fmLogout(config, userToken)` (fire-and-forget, token not retained)
    3. Call `fmLogin(config, serviceUsername, servicePassword)` — opens a service session for the profile query; if fails, return `null`
    4. Call `fmFindUserWithPrivileges(config, serviceToken, username)` — Data API Find on User layout using the service token; if fails, return `null`
    5. Call `fmLogout(config, serviceToken)` — close the service session (fire-and-forget)
    6. Return `FileMakerUser` object (identity + projects/roles only; no FM token stored)

> **Security note:** The user's credentials are validated first (step 2). The profile/privilege lookup (steps 3–4) uses a separate backend service account that has read access to the User layout and UserProjectRole portal. All steps must succeed for login to proceed. The service credentials never leave the server.

**Test:** `__tests__/provider.test.ts` — Mock `fmLogin` + `fmFindUserWithPrivileges`, test success/user-auth-failure/service-auth-failure/find-failure paths

### Step 7: JWT and Session callbacks
Control what user data gets stored in the encrypted JWT token and what gets exposed to the browser session. Identity fields and project/role assignments are forwarded to the session for app-level access control.

**File:** `src/callbacks.ts`

- **`createJwtCallback()`** — On `signIn` trigger, copies `userName`, `nameFirst`, `nameLast`, `email`, `projects` (array of `ProjectAssignment`) from user to JWT token
- **`createSessionCallback()`** — Forwards `id`, `userName`, `nameFirst`, `nameLast`, `email`, `projects` from JWT to session

**Test:** `__tests__/callbacks.test.ts` — Test JWT population on signIn, session shape matches expected fields

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

Re-exports: `loadConfigFromEnv`, `createFileMakerProvider`, `createJwtCallback`, `createSessionCallback`, `fmLogin`, `fmLogout`, `fmFindUserWithPrivileges`, `FileMakerLoginForm`, all types, all error classes.

### Step 10: Event logging to FileMaker

Write Auth.js sign-in, sign-out, and failed sign-in events to the `DAPI_EVENTLOG` layout in FileMaker, giving administrators a server-side audit trail of authentication activity.

**Key decisions:**
- Fire-and-forget — event writes never block or throw; failures are logged as warnings only
- Successful sign-in and sign-out are handled via Auth.js `events` hooks
- **Failed sign-in is handled inside the provider's `authorize` callback** (Auth.js fires no event for failures) — `createFileMakerProvider` already receives `config` so no signature change is needed
- Each event opens its own service session (login → create record → logout), since provider sessions are already closed by the time Auth.js events fire
- Opt-in — set `FM_IdP_EVENT_LOG_LAYOUT` to enable; if omitted or empty, event logging is disabled

**New env var (add to `.env.example`):**
```
FM_IdP_EVENT_LOG_LAYOUT=DAPI_EVENTLOG   # omit or leave blank to disable event logging
```

**`FileMakerIdPConfig` changes** (`src/types.ts`):
- Add `eventLogLayout?: string` — layout name for event log writes; `undefined` disables logging

**`loadConfigFromEnv` changes** (`src/env.ts`):
- Read `FM_IdP_EVENT_LOG_LAYOUT`; if set, assign to `eventLogLayout`; if absent, leave `undefined`

**New type: `EventLogEntry`** (`src/types.ts`):
```typescript
interface EventLogEntry {
  scriptName: string;    // event type: "signIn", "signOut", "signInFailed"
  detail?: string;       // human-readable description
  error?: string;        // error message on failure
  foreignKeyId?: string; // user ID (fk_ForeignKeyID)
  notes?: string;        // additional context
}
```

**New function: `fmWriteEventLog`** (`src/filemaker-client.ts`):
```typescript
fmWriteEventLog(config, entry: EventLogEntry): Promise<void>
```
- If `config.eventLogLayout` is undefined, returns immediately (no-op)
- Opens service session (`fmLogin`), POSTs a new record to the event log layout, closes session (`fmLogout`)
- POST body maps `EventLogEntry` fields to FM field names:
  - `entry.scriptName` → `Script_Name`
  - `entry.detail` → `Detail`
  - `entry.error` → `Error`
  - `entry.foreignKeyId` → `fk_ForeignKeyID`
  - `entry.notes` → `Notes`
- Fire-and-forget: `console.warn` on any failure, never throws

**New factory: `createEventHandlers`** (`src/callbacks.ts`):
```typescript
createEventHandlers(config: FileMakerIdPConfig): { signIn, signOut }
```
- Returns Auth.js event handlers for use in the NextAuth `events` config
- Uses the same `any`-cast pattern as `createJwtCallback` and `createSessionCallback`:
  - `signIn({ user }: { user: any })` — cast `user as FileMakerUser` to access `user.id` and `user.email`; writes `{ scriptName: "signIn", foreignKeyId: fmUser.id, detail: fmUser.email }`
  - `signOut({ token }: { token: FileMakerJWT })` — `token.id` is our custom field populated at sign-in by the JWT callback; writes `{ scriptName: "signOut", foreignKeyId: token?.id }`
  > **Implementation note:** Auth.js v5 types `events.signOut` as `{ token?: JWT }`, so cast `token as FileMakerJWT | undefined` using the same `any`-cast pattern as the JWT/session callbacks; do not rely on the destructure type annotation alone.
- Imports `FileMakerIdPConfig` and `FileMakerUser` from `./types.js`, `FileMakerJWT` from `./callbacks.js`, and `fmWriteEventLog` from `./filemaker-client.js`

**Provider changes** (`src/provider.ts`):
- `authorize` already returns `null` on failure; add `void fmWriteEventLog(config, { ... })` (matching the existing `void fmLogout(...)` pattern) before each `return null`:
  - User credential failure → `{ scriptName: "signInFailed", detail: username, error: "Invalid credentials" }`
  - Service account failure → `{ scriptName: "signInFailed", detail: username, error: "Service account error" }`
  - Profile lookup failure → `{ scriptName: "signInFailed", detail: username, error: "Profile lookup failed" }`

**`src/index.ts`:** Export `createEventHandlers`, `fmWriteEventLog`, and `EventLogEntry` type

**Integration example** (update `IntegrationProc.md` Step 5):
```typescript
export const { auth, handlers, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [createFileMakerProvider(fmConfig)],
  callbacks: {
    jwt: createJwtCallback(),
    session: createSessionCallback(),
  },
  events: createEventHandlers(fmConfig),
  session: { strategy: "jwt", maxAge: 30 * 60, updateAge: 5 * 60 },
});
```

**Tests:** `__tests__/filemaker-client.test.ts` — `fmWriteEventLog` no-op when layout undefined, record creation success, warning on failure; `__tests__/callbacks.test.ts` — `createEventHandlers` returns correct payload shapes for signIn and signOut; `__tests__/provider.test.ts` — verify `fmWriteEventLog` is called on each failure path

### Step 11: CI/CD and documentation
Set up automated publishing so that creating a GitHub release automatically builds, tests, and publishes a new version of the package to GitHub Packages. Update the README with installation and usage instructions.

**Files:** `.github/workflows/publish.yml`, `README.md`

- GitHub Actions workflow: on release → checkout → install → typecheck → test → build → `npm publish` to GitHub Packages
- README: Installation, configuration, consuming app integration example, module augmentation snippet, environment variables (including `FM_IdP_EVENT_LOG_LAYOUT` — opt-in, omit or leave blank to disable event logging)
- README integration example must include `createEventHandlers` in the import list and `events: createEventHandlers(fmConfig)` in the NextAuth config

---

## Consuming App Integration Example

```typescript
// auth.ts (in Monitor or Design app)
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
    jwt: createJwtCallback(),
    session: createSessionCallback(),
  },
  events: createEventHandlers(fmConfig),
  session: {
    strategy: "jwt",
    maxAge: 30 * 60,   // session expires 30 minutes after last activity
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
5. **Publish:** Create a GitHub release → workflow publishes to GitHub Packages
