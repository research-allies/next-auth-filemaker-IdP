# Project History: next-auth-filemaker-IdP

A sequential narrative of the `@research-allies/next-auth-filemaker-idp` package — from initial planning through implementation, live integration testing, and documentation hardening.

---

## Phase 1: Foundations and FileMaker Database Design

*Feb 11–12, 2026 | Commits: `996972f` → `912c2d7` | Model: Opus*

The project began with repo scaffolding and the creation of two guiding documents: `ImplementationPlan.md` (the architectural source of truth, 11-step build plan) and `IntegrationProc.md` (the consuming-app integration guide). A CodeRabbit automated review run produced minor cleanup changes.

In parallel, the FileMaker database `IdP_Accounts.fmp12` was built out:

- Initial user account management schema (account and file tables)
- Added projects and roles, with a `UserProjectRole` join table linking users to projects with role assignments
- Fixed an account deletion bug
- Adopted the `IdP_` filename prefix convention for all FM files
- Removed unused FM files from the database

---

## Phase 2: Architecture Decision — OData vs. Data API

*Feb 12–19, 2026 | Commits: `a9b6da1` → `90f034b` | Model: Opus*

The original plan called for OData to query user profiles and project/role privileges. OData field mapping and role/project query structures were designed and documented in `ImplementationPlan.md`.

**Pivot:** Hands-on testing revealed that OData does not return portal data. Since the `UserProjectRole` join table is accessed through a FileMaker portal on the `IdP_user` layout, OData could not deliver the necessary project/role assignments.

The decision was made to use the FileMaker Data API exclusively for all operations: user authentication login, profile lookup, portal data retrieval, and logout. This architectural choice shaped every subsequent implementation detail.

---

## Phase 3: Package Bootstrap and First Implementation

*Feb 19–20, 2026 | Commits: `fd47499` → `afc1b86` | Model: Opus*

The full package was built out in one large session. Before the core commit, a security enhancement was added to `loadConfigFromEnv` (server-only function) and basic project hygiene files (`.gitignore`, `CLAUDE.md`) were committed. Then came the "Initial commit of next-auth FileMaker IdP provider" — the entire package:

**Source modules built:**

- `src/types.ts` — `FileMakerIdPConfig`, `UserProfile`, `FileMakerUser`, `ProjectAssignment`
- `src/errors.ts` — `FileMakerIdPError` base class; `FileMakerAuthError`, `FileMakerQueryError`, `ConfigurationError` subclasses
- `src/env.ts` — `loadConfigFromEnv()` with host validation, HTTPS enforcement, `ConfigurationError` on missing required vars
- `src/utils.ts` — `encodeBasicAuth`, `buildDataApiBaseUrl`, `getFetch`, `sanitizeFmFindValue`
- `src/filemaker-client.ts` — `fmLogin`, `fmFindUserWithPrivileges` (groups portal rows into `ProjectAssignment[]`), `fmLogout`
- `src/provider.ts` — `createFileMakerProvider()` (Auth.js Credentials provider)
- `src/callbacks.ts` — `createJwtCallback()`, `createSessionCallback()`
- `src/components/FileMakerLoginForm.tsx` + `src/client.ts`

**Build tooling:**

- `tsup.config.ts` — dual CJS/ESM build; the `"use client"` directive is injected via the tsup `onSuccess` hook (the `banner` option gets stripped by rollup in downstream builds)
- `__tests__/` — unit tests for all modules with mocked fetch

---

## Integration Test 1 — Feb 20, 2026

*Against `db.research-allies.cloud` | Model: Opus*

First live test against the production FileMaker server. Key findings:

- FM layout name is `IdP_user` (originally planned as `DAPI_USER`) — case-sensitive
- FM portal name is `userProjectRole` (lowercase `u`) — case-sensitive
- Confirmed OData does not return portal data (live validation of the Phase 2 pivot)

---

## Phase 4: Configuration Namespacing

*Feb 20, 2026 | Commit: `8bd4f12` | Model: Opus*

All environment variables were prefixed with `FM_IdP_` for namespace clarity (e.g., `HOST` → `FM_IdP_HOST`, `DATABASE` → `FM_IdP_DATABASE`). Updated `.env.example`, all documentation, and all internal references.

---

## Phase 5: Self-Signed Certificate Support

*Feb 20, 2026 | Commit: `c5947cd` | Model: Opus*

The Node.js built-in `https` agent was replaced with an `undici` Agent to support custom fetch handling — specifically, certificate validation bypass for development environments with self-signed certificates. The `loadConfigFromEnv({ fetch: ... })` override pattern was documented as the integration point.

`undici` ships bundled with Node 18+ so no additional install is required in consuming apps.

---

## Phase 6: Sign-Out, License, and Component Refinements

*Feb 20, 2026 | Commits: `cf340a6` → `b6678a7` | Model: Opus*

- Added `FileMakerSignOutButton` component — a client-side wrapper around Auth.js `signOut`
- License changed to GPL-3.0-only
- Renamed `AUTH_SECRET` env var reference to align with Auth.js v5 conventions
- Refined component imports and the package's public export structure

---

## Phase 7: Session Management and Type Fixes

*Feb 20, 2026 | Commit: `b914e5c` | Model: Opus*

FileMaker client internals and session token handling were improved. Type compatibility issues in callbacks were addressed:

- `createJwtCallback()` return type changed to `JWT` (not `FileMakerJWT`) for next-auth compatibility — consuming apps augment `JWT` via declaration merging in `types/next-auth.d.ts`
- `createEventHandlers()` `signOut` handler typed to accept `{ session: any } | { token?: any }` union (Auth.js v5 can send either shape)

---

## Phase 8: Event Logging — First Implementation

*Feb 20–21, 2026 | Commits: `2dfb7f2` → `8775938` | Model: Opus*

A full audit event logging system was added:

- `fmWriteEventLog()` in `filemaker-client.ts` — writes audit records to an `IdP_eventlog` FileMaker layout
- `createEventHandlers()` in `callbacks.ts` — Auth.js `events` hooks for `signIn` and `signOut`
- Failed sign-ins handled inside `provider.ts`'s `authorize` callback (Auth.js fires no `signIn` event for auth failures, so failures must be caught and logged there)
- Event logging is opt-in: setting `FM_IdP_EVENT_LOG_LAYOUT` enables it; omitting the variable disables it entirely
- Several security hardening improvements were made in the same session

---

## Phase 9: Event Logging Refinements

*Feb 21, 2026 | Commits: `472cdfd` → `357fa34` | Model: Opus*

- Removed PII from event log entries — username moved to the `notes` field rather than `detail`
- Improved error message categorization: `FileMakerAuthError` → `"Invalid credentials"`, other FM errors → `"{message} (FileMaker error)"`, unknown errors → `"{message}"`
- Fixed `signOut` union type (the Auth.js v5 `signOut` event can pass either `{ session }` or `{ token? }` depending on session strategy)
- Added `safeLogValue()` helper — truncates strings and strips control characters (`\x00–\x1f`) before log interpolation, preventing log injection attacks

---

## Phase 10: Session Duration and Event Log Configuration

*Feb 21, 2026 | Commits: `dba757d` → `a97515c` | Model: Opus*

- Session `maxAge` extended to 60 minutes (sliding idle timeout)
- `updateAge: 5 * 60` added — re-signs the JWT at most once every 5 minutes, resetting the idle clock on activity without re-signing on every request
- Event log configuration options documented in README

---

## Integration Test 2 — Feb 21, 2026

*Against `monitor-app` | Session: `eb51eed2` | Model: Sonnet*

First integration of the package into `monitor-app`, a separate Next.js consuming application. This was the most consequential test session — two critical gotchas were uncovered that required documentation warnings and affected every subsequent integration:

**Gotcha 1: `proxy.ts` JWT signature mismatch**

Creating a separate NextAuth instance in `proxy.ts` (e.g. `export default NextAuth(authConfig).auth`) produces a second JWT signing context. The resulting JWT signature mismatch causes a silent infinite redirect loop to `/login` — no error is thrown, making it extremely difficult to diagnose.

**Fix:** `import { auth } from "@/auth"; export { auth as proxy };`

In Next.js 16, this must be a *named* `proxy` export — `export default auth` does not satisfy the framework's route protection requirement.

**Gotcha 2: `auth.ts callbacks` spread**

Spreading `...authConfig` into the NextAuth configuration then setting `callbacks: { jwt, session }` silently **overwrites** `authConfig.callbacks`, dropping the `authorized` callback that drives route protection. The result is the same symptom: login is never triggered, producing a redirect loop.

**Fix:** `callbacks: { ...authConfig.callbacks, jwt: createJwtCallback(), session: createSessionCallback() }`

Both of these findings were immediately captured in `MEMORY.md` and later became explicit warnings in `IntegrationProc.md`.

---

## Integration Test 3 — Feb 21–22, 2026

*Against `monitor-app` | Session: `b3586632` | Model: Sonnet*

A clean reinstall of the package into `monitor-app` after the Phase 9 event logging refinements. This session verified that the proxy.ts and callbacks fixes held, and that event logging was working end-to-end against the live FileMaker server. The sign-out flow was also verified.

---

## Phase 11: Next.js 16 Support

*Feb 21, 2026 | Commit: `437af2b` | Model: Sonnet*

`IntegrationProc.md` and `ImplementationPlan.md` were updated for Next.js 16+:

- `proxy.ts` (named export) replaces `middleware.ts` for route protection
- Rate limiting guidance added: each login attempt opens up to 3 FileMaker Data API sessions; without rate limiting, brute-force attacks can exhaust FileMaker's session pool (default maximum: 500 concurrent sessions)
- Sliding session timeout behavior explained in detail

---

## Phase 12: Bug Fixes and Integration Hardening

*Feb 22, 2026 | Commits: `0db94ee` → `3462c9d` | Model: Sonnet*

- Fixed package references and import issues discovered during monitor-app integration
- Enhanced `ProjectAdminPage` and `LoginPage` code examples in `IntegrationProc.md`
- Improved error handling documentation

---

## Phase 13: README and Documentation Expansion

*Feb 22 – Mar 5, 2026 | Commits: `1471c69` → `02ff4ab` | Model: Sonnet*

- Expanded README with Next.js 16+ configuration details
- Added route protection patterns (server component and middleware/proxy)
- Updated installation instructions — Auth.js v5 beta pinning, `--legacy-peer-deps` flag required for local `.tgz` installs (monorepo peer dependency resolution issue)
- Optimized `IdP_Accounts.fmp12` FileMaker database file

---

## Integration Test 4 — Mar 5, 2026

*Against `fm-idp-test` | Session: `62a12e0b` | Model: Sonnet*

First integration of the package into `fm-idp-test`, a freshly bootstrapped Next.js 16 app created specifically to validate the integration procedure from scratch. This session involved multiple reset/retry cycles and surfaced several issues:

- The proxy.ts named export error surfaced again (confirming the warning needed to be more prominent)
- During this session, FM layout names were renamed on the server: `DAPI_USER` → `IdP_user`, `DAPI_EVENTLOG` → `IdP_eventlog` — this required updating environment variables in `.env.local`
- Multiple rounds of `.env.local` configuration were attempted before the correct values were in place

---

## Integration Test 5 — Mar 5, 2026

*Against `fm-idp-test` | Session: `a942bb26` | Model: Sonnet*

Additional `fm-idp-test` integration rounds continuing from the previous session. The integration was reverted and retried to validate the full procedure flow from a clean state, confirming that the updated layout names were correct and that the complete `IntegrationProc.md` walkthrough produced a working app.

---

## Phase 14: Event Logging Refactor — Token Reuse and Parallel Logins

*Mar 6, 2026 | Commits: `cd7e081` → `de2a32c` | Model: Opus (analysis) + Sonnet (implementation)*

Two Mar 6 sessions (`e562eea1`, `14e9649e`) used the Opus model specifically to analyze the codebase for optimizations and inconsistencies. Key changes that followed:

- `foreignKeyId` → `idUser` in event log field mapping (to match the actual FM schema field name)
- `scriptNameField` → `actionField` in event log field config
- Added `existingToken` parameter to `fmWriteEventLog()` — allows callers to reuse an already-open service account session, avoiding an extra login/logout round-trip on failure paths
- Refactored `authorize()` to run user and service account logins in parallel via `Promise.allSettled` — reduces latency on both success and failure paths; enables service token reuse for event logging when user auth fails
- Updated unit tests for the new login/logout behavior

---

## Integration Test 6 — Mar 6, 2026

*Against `fm-idp-test` | Session: `e7836069` | Model: Sonnet*

Tests run against `fm-idp-test` after the parallel login refactor. Verified that event log entries were written correctly with the renamed field mappings and that the `existingToken` optimization was functioning as expected.

Also created `scripts/inspect-eventlog.ts` — a dev utility to probe `IdP_eventlog` field names live against the FM server, used to verify the field rename changes against the actual layout definition.

---

## Phase 15: Environment Variable Documentation

*Mar 7, 2026 | Commits: `3f64510` → `e274d4b` | Model: Sonnet*

- Updated `.env.example` with all event log field variables (with their default values)
- Improved README clarity on the distinction between service account credentials and user credentials
- Added a reference table documenting all `FM_IdP_EVENTLOG_FIELD_*` variables with defaults

---

## Integration Test 7 — Mar 7, 2026

*Against `fm-idp-test` | Session: `e51916e4` | Model: Sonnet*

Another full `fm-idp-test` integration run. Key findings from this session:

- Clarified sign-in page behavior: the login form should use `nameFirst` (not email) as the username field display — this is a FM-specific identity convention
- Question arose about how consumers obtain `IdP_Accounts.fmp12` — the FM database file is not included in the npm package (binary files don't belong in npm). This led directly to the release checklist addition.

---

## Integration Test 8 — Mar 7, 2026

*Against `fm-idp-test` | Session: `d2484023` | Model: Sonnet*

Final `fm-idp-test` integration session of this development period. Additional `.env.local` setup instructions were refined based on issues encountered during setup: the rule was formalized that `.env.local` must mirror `.env.example` exactly — all variables present, required ones filled in, optional ones left commented out. A minimal `.env.local` with only required vars was confirmed to cause subtle issues.

---

## Phase 16: Integration Procedure Polish

*Mar 7, 2026 | Commits: `8f3a5ff` → `f3a5b56` | Model: Sonnet*

The accumulated findings from all Mar 7 integration sessions were codified into `IntegrationProc.md`:

- Streamlined `.env.local` setup instructions with the "mirror `.env.example` exactly" rule
- Added explicit warning: do **not** replace `app/page.tsx` — only add to it
- Added placement guidance for `FileMakerSignOutButton`: wrap in a flex container to avoid the `justify-content: space-between` layout gap in Next.js default starter templates
- Added the FM database distribution note: `IdP_Accounts.fmp12` is attached as a GitHub release asset, not included in the npm package
- Added a release checklist: attach `IdP_Accounts.fmp12` to every GitHub release
- Updated `IdP_Accounts.fmp12` to reflect all schema changes made during development

The two critical integration gotchas discovered in Feb 21 monitor-app testing were documented as prominent warnings in `IntegrationProc.md`:

1. **`proxy.ts` warning** — never create a separate NextAuth instance; import and re-export `auth` from `@/auth`
2. **`auth.ts callbacks` warning** — always spread `...authConfig.callbacks` first to preserve the `authorized` callback

---

## Integration Test 9 — Mar 7, 2026

*`IntegrationProc.md` accuracy scan | Session: `8c1ac9af` | Model: Sonnet*

A dedicated accuracy scan of `IntegrationProc.md` against the live environment. Verified consistency between `env.ts` validation logic and `.env.example` variable definitions — confirmed that all documented variables match the actual implementation and that no required variable was undocumented or misnamed.

---

## Phase 17: Security Documentation

*Mar 7, 2026 | Commit: `039faa3` | Model: Sonnet*

Added a comprehensive Security Considerations section to `IntegrationProc.md`:

- **Secrets management** — `.gitignore` check, never use `NEXT_PUBLIC_` prefix on FM vars (would expose to browser bundle), key rotation guidance
- **No FM tokens in JWT** — the user's session token is discarded immediately after credential validation; the service token is closed after profile lookup; only identity and roles travel in the JWT
- **HTTPS enforcement** — `FM_IdP_USE_HTTPS=false` is blocked in production environments
- **CSRF protection** — built into Auth.js v5; no additional configuration required
- **Security headers** — `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`
- **Cookie security** — `httpOnly`, `secure`, `sameSite: lax` set automatically when served over HTTPS
- **Error message safety** — no FM URLs, layout names, or credentials are exposed to the client; `authorize()` returns `null` on failure (Auth.js convention)
- **Input sanitization** — `sanitizeFmFindValue()` for Data API queries; `safeLogValue()` for event log string interpolation

---

## Phase 18: v0.1.0 Release

*Mar 7, 2026*

Published the initial public release of `@research-allies/next-auth-filemaker-idp` to GitHub Packages as **v0.1.0**.

Initial release of the FileMaker Server authentication provider for Auth.js v5. Authenticates users against FileMaker's Data API, queries profile and project/role assignments via a service account, and forwards identity and privileges into the JWT session. Includes a reusable `FileMakerLoginForm` React component, event logging to FileMaker, and full TypeScript types for session augmentation.

The release includes:

- The compiled npm package (dual CJS/ESM)
- `IdP_Accounts.fmp12` attached as a release asset (not included in the npm package — consumers download from the GitHub release)

---

## Summary

| | Date Range | Focus |
|--|-----------|-------|
| Phase 1 | Feb 11–12 | FileMaker database design |
| Phase 2 | Feb 12–19 | OData → Data API architecture pivot |
| Phase 3 | Feb 19–20 | Full package implementation |
| IT 1 | Feb 20 | First live FM server test — layout and portal name discovery |
| Phase 4 | Feb 20 | Environment variable namespacing |
| Phase 5 | Feb 20 | Self-signed certificate support |
| Phase 6 | Feb 20 | Sign-out component, license, export cleanup |
| Phase 7 | Feb 20 | Session management and type fixes |
| Phase 8 | Feb 20–21 | Event logging — first implementation |
| Phase 9 | Feb 21 | Event logging refinements (PII, error categories, log injection) |
| Phase 10 | Feb 21 | Session duration and event log config |
| IT 2 | Feb 21 | First monitor-app integration — proxy.ts and callbacks gotchas |
| IT 3 | Feb 21–22 | Second monitor-app integration — clean reinstall verification |
| Phase 11 | Feb 21 | Next.js 16 support documentation |
| Phase 12 | Feb 22 | Bug fixes and integration hardening |
| Phase 13 | Feb 22–Mar 5 | README and documentation expansion |
| IT 4 | Mar 5 | First fm-idp-test integration — layout renames |
| IT 5 | Mar 5 | Second fm-idp-test integration — full procedure validation |
| Phase 14 | Mar 6 | Event logging refactor — token reuse, parallel logins |
| IT 6 | Mar 6 | fm-idp-test post-refactor verification |
| Phase 15 | Mar 7 | Environment variable documentation |
| IT 7 | Mar 7 | fm-idp-test — sign-in field clarification, FM file distribution |
| IT 8 | Mar 7 | fm-idp-test — .env.local rule formalization |
| Phase 16 | Mar 7 | IntegrationProc polish — warnings, release checklist |
| IT 9 | Mar 7 | IntegrationProc accuracy scan |
| Phase 17 | Mar 7 | Security documentation |
| Phase 18 | Mar 7 | v0.1.0 public release |
