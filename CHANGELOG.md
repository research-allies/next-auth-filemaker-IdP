# Changelog

All notable changes to `@research-allies/next-auth-filemaker-idp` are documented here.

---

## [0.4.0] — 2026-06-27

### Breaking Changes

- **`ProjectAssignment` now includes a `projectDatabase` field** populated from the portal field `project::database_project_data` (configurable via `FM_IdP_FIELD_PROJECT_DATABASE`).

  **FileMaker layouts that do not expose this portal field will cause sign-in to fail.** Before upgrading, add a `database_project_data` field to the project portal object on your IdP layout, or set `FM_IdP_FIELD_PROJECT_DATABASE` to an existing portal field that holds the target database filename. If your app does not use `projectDatabase`, you may point the env var at any portal field that reliably returns a value (e.g. `project::id_project`).

### New Features

- `projectDatabase` is now available on each `ProjectAssignment` at sign-in, sourced from the FileMaker portal via the Data API.

### Fixes / Chores

- Upgraded GitHub Actions runners to Node.js 24 runtime.

---

## [0.3.1] — 2026-04-05

### Fixes / Chores

- Corrected README instructions for installing from GitHub Packages
- Fixed a missed rename of `userProjectRole` → `user_project_role` in docs and one test
- Added `.fmp12` FileMaker file as a GitHub release asset

---

## [0.3.0] — 2026-04-03

### Breaking Changes

- **Default portal name changed** from `userProjectRole` to `user_project_role`.

If you rely on the default value of `FM_IdP_PORTAL_NAME`, you must either rename the portal object on your FileMaker layout to `user_project_role` or explicitly set `FM_IdP_PORTAL_NAME=userProjectRole` in your environment to preserve the old behavior.

---

## [0.2.0] — 2026-04-02

### Breaking Changes

Event logging has been removed from this package entirely. It is moving to a dedicated `@research-allies/event-logging` package.

**Removed from `FileMakerIdPConfig`:**
- `eventLog` config block (`EventLogFieldMapping`)
- `EventLogEntry` type

**Removed exports:**
- `createEventHandlers` (previously returned `signIn` / `signOut` Auth.js event handlers)
- `fmWriteEventLog` (internal FileMaker event log writer)

**Removed environment variables:**
- `FM_IdP_EVENTLOG_LAYOUT`
- `FM_IdP_EVENTLOG_*` field mapping variables

#### Migration

Remove event logging config from `FileMakerIdPConfig` and unset the `FM_IdP_EVENTLOG_*` env vars. To retain event logging, install `@research-allies/event-logging` and wire it into your Auth.js `events` callbacks directly.

---

### Other Changes

- Added `prepublishOnly` script — `dist` is now always rebuilt before `npm publish`

---

## [0.1.5] and earlier

See git history.
