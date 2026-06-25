# CLAUDE.md

## Project

`@research-allies/next-auth-filemaker-idp` — Auth.js v5 Credentials provider for FileMaker Server IdP.

## Commands

- Build: `npm run build`
- Typecheck: `npm run typecheck`
- Test: `npm test`
- Test (single file): `npx vitest run __tests__/filename.test.ts`

## Conventions

- **Naming:** camelCase field names matching FM schema; singular table names (`user` not `users`)
- **Module system:** ESM-first (`"type": "module"`), dual CJS/ESM build via tsup
- **Server-only:** `loadConfigFromEnv()` must never be imported from client code
- **No FM tokens in JWT** — JWT contains identity + roles only
- **No `status_bool`** exposed to the auth package (internal FM field)
- **Portal fields** use `TableName::fieldName` format (e.g., `project::projectName`)
- **Error classes:** Always extend `FileMakerIdPError` base class
- **Fire-and-forget:** `fmLogout` calls log warnings but never throw

## Architecture

See `plans/ImplementationPlan.md` for the full 11-step build plan (source of truth).
See `IntegrationProc.md` for consuming app integration guide.

## Key Decisions

- Data API only (no OData)
- Service account for profile/privilege queries — user token is discarded after validation
- `FM_IdP_TIMEOUT` default: 10000ms (AbortController on all fetch calls)
- Package published to GitHub Packages under `@research-allies` scope
