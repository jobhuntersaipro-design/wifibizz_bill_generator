# Auth - Google Sign-Up / Sign-In Flow

## Overview

Enable the "Sign up with Google" button on `/register` and "Sign in with Google" button on `/login` to work end-to-end using Google OAuth via NextAuth v5.

## Current State

- **Code is fully implemented** — Google OAuth provider, `GoogleSignInButton` component, `signIn` callback with user creation/linking logic, and JWT/session callbacks are all in place.
- **Missing**: Google Cloud OAuth credentials (`AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` are empty in `.env`).

## Requirements

### 1. Google Cloud Console Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create or select a project (e.g., "SmartChiro")
3. Navigate to **APIs & Services > Credentials**
4. Create an **OAuth 2.0 Client ID** (Web application)
5. Set **Authorized JavaScript origins**:
   - `http://localhost:3000` (dev)
   - Production domain when deployed
6. Set **Authorized redirect URIs**:
   - `http://localhost:3000/api/auth/callback/google` (dev)
   - `https://your-domain.com/api/auth/callback/google` (prod)
7. Copy the Client ID and Client Secret

### 2. Environment Variables

Update `.env`:
```
AUTH_GOOGLE_ID="<your-google-client-id>"
AUTH_GOOGLE_SECRET="<your-google-client-secret>"
```

Update `.env.production` with production credentials.

### 3. Expected Flow — New User (Sign Up with Google)

1. User clicks "Sign up with Google" on `/register`
2. `signIn('google', { callbackUrl: '/dashboard' })` triggers NextAuth
3. User is redirected to Google consent screen
4. After consent, Google redirects to `/api/auth/callback/google`
5. `signIn` callback in `auth.ts` fires:
   - Checks if user exists by email → **not found**
   - Creates new `User` record (email, name, image from Google profile, `emailVerified` set)
   - Creates `Account` record linking Google provider
   - Checks for clinic membership (none for new user)
6. JWT callback attaches `user.id`, `role`, `clinicRole`, `activeClinicId`
7. User is redirected to `/dashboard`

### 4. Expected Flow — Existing User (Sign In with Google)

1. User clicks "Sign in with Google" on `/login`
2. Same OAuth flow as above
3. `signIn` callback:
   - Finds existing user by email
   - Links Google account if not already linked
   - Sets active clinic from first membership
4. User lands on `/dashboard` with session populated

### 5. Expected Flow — Existing Credentials User Links Google

1. User previously registered with email/password
2. User clicks "Sign in with Google" on `/login`
3. `signIn` callback:
   - Finds existing user by email (has password set)
   - Links Google `Account` record to existing user
   - From now on, user can sign in with either method
4. User lands on `/dashboard`

### 6. Edge Cases

| Scenario | Expected Behavior |
|----------|-------------------|
| Google email matches existing user | Link account, don't create duplicate |
| User denies Google consent | Redirect back to login/register with no error (NextAuth default) |
| Google credentials not configured | Google button calls `signIn('google')` which returns NextAuth error — button should ideally be hidden |
| Multiple clinics | First clinic membership is set as active (current behavior) |

### 7. Optional Improvement — Hide Google Button When Not Configured

Currently `GoogleSignInButton` always renders. If `AUTH_GOOGLE_ID` is not set, clicking it will fail silently or show a NextAuth error page.

**Option A (recommended)**: Pass a `googleEnabled` prop from the server page to the form component:
- In `/register/page.tsx` and `/login/page.tsx`, check `!!process.env.AUTH_GOOGLE_ID`
- Pass as prop to `RegisterForm` / `LoginForm`
- Hide the Google button + "or continue with" divider when `false`

## Files Involved

| File | Role |
|------|------|
| `src/lib/auth.config.ts` | Google provider setup (conditional on env vars) |
| `src/lib/auth.ts` | `signIn` callback — user creation, account linking, clinic assignment |
| `src/components/auth/GoogleSignInButton.tsx` | UI button, calls `signIn('google')` |
| `src/components/auth/RegisterForm.tsx` | Register form with Google sign-up button |
| `src/components/auth/LoginForm.tsx` | Login form with Google sign-in button |
| `src/app/(auth)/register/page.tsx` | Register page (server component) |
| `src/app/(auth)/login/page.tsx` | Login page (server component) |
| `.env` / `.env.production` | Google OAuth credentials |

## Testing

1. Set `AUTH_GOOGLE_ID` and `AUTH_GOOGLE_SECRET` in `.env`
2. Restart dev server (`npm run dev`)
3. Go to `/register` — click "Sign up with Google"
4. Verify Google consent screen appears
5. After consent, verify redirect to `/dashboard`
6. Check database: new `User` and `Account` records created
7. Sign out, go to `/login` — click "Sign in with Google"
8. Verify sign-in works and redirects to `/dashboard`
9. Test with existing email/password user — verify account linking (no duplicate user)
10. Run `npm run build` — verify no build errors
