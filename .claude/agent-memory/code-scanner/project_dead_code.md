---
name: Dead code — src/app/auth/signin/actions.ts
description: The authenticate() function in this file is never called; the app uses src/actions/auth.ts login() instead. All four imports in the file are therefore effectively unused.
type: project
---

`src/app/auth/signin/actions.ts` exports `authenticate()` which duplicates sign-in logic using `bcrypt`, `prisma`, `signIn`, and `isRedirectError`. The sign-in form calls `login()` from `src/actions/auth.ts` instead — this file is dead code.

**Why:** Likely a leftover from an earlier iteration of the auth flow before the rate-limiting server action in `src/actions/auth.ts` was introduced.

**How to apply:** Flag this file for deletion whenever auth or sign-in code is touched. Do not reference `authenticate` from `actions.ts` — use `login` from `src/actions/auth.ts`.
