# Phase 6 — Onboarding: Invite Links and a Getting-Started Checklist

**Status:** SPEC — FOR REVIEW. Nothing implemented.
**Origin:** [product-analysis-2026-08-31.md](product-analysis-2026-08-31.md), phase 6 of 9.
**Scope:** Vercel-only. **No migration** — invites reuse `password_reset_tokens`.

Onboarding an agent today: admin invents a password, tells the agent over some channel, agent signs in,
agent connects the dealer account — with nothing telling them that second step exists. At 50+ agents,
the password-handoff is the weak link and the missing checklist is the support ticket.

---

## A. Invite links

**An invite IS a set-password link** — Phase 4 already built the machinery. The differences are the
lifetime and the words around it:

- `newResetToken()` gains an optional TTL; invites get **7 days** (a 30-minute invite is dead before
  the agent is off the phone), resets keep 30 minutes. Same table, same hash-only storage, same
  single-use conditional claim.
- `/auth/reset` gains a `welcome` variant: *"Welcome to BizzFlow — choose your password"* instead of
  reset wording. Same form, same action, same land-on-sign-in.

**Delivery is COPY-LINK, not e-mail, and that is a decision, not a shortcut:** several live accounts
have unreal login addresses (`aiboot1@gmailcom`), and an invite that silently cannot arrive is worse
than no button. Admin clicks **Invite link** on a user row, gets the URL in the clipboard, and hands it
over on whatever channel they already use with that agent. (Mailing can be added later for accounts
with real addresses; copy-link is the primitive that always works.)

- New admin action `createInviteLink(userId)` — admin-gated, 7-day token, **audited**
  (`invite_created`, one new value in the existing vocabulary).
- **Admin create-user no longer REQUIRES a password.** Left blank, the account is created password-less
  (cannot sign in) and the dialog immediately offers the invite link. Typing one still works exactly as
  today — both paths stay.
- A password-less account renders **"Invited"** instead of a password in the Users table.
- Sign-in with a password-less account fails as any wrong password does today (bcrypt.compare against
  null is already false) — no new failure mode.

## B. Getting-started checklist

A card at the top of `/dashboard`, shown ONLY while incomplete and only to agents with order-entry
access:

> **Getting started**
> ✓ Password set
> ○ Connect your Unifi dealer account → (link to Order Entry)

Two items, not five — password (done by arriving) and the dealer connection, judged by
`DealerAccount.lastConnectedAt` being set. When both are done the card is gone forever; there is no
"dismiss" because there is nothing to dismiss — completion is the dismissal.

Agents without order-entry access never see it: their onboarding IS complete at sign-in.

## Tests

- Invite tokens: 7-day expiry, single-use, hash-only — the Phase 4 suite parameterised over the TTL.
- `createInviteLink` admin-gated and audited; the URL carries the token exactly once.
- Password-less creation: no password fields written; sign-in refused; Users table renders "Invited".
- Checklist visibility: shown only when `orderEntryEnabled && !lastConnectedAt`; gone when connected.

Browser: create a password-less user (dev), copy the invite, open it in the same browser, set a
password, sign-in lands; the checklist card on a doctored `lastConnectedAt` (restored). The invited
test user is deleted afterwards.

## Not in scope

Mailing invites; resend/revoke UI (a second click on Invite link mints a fresh token, which covers
both); any change to the dealer-connect flow itself.
