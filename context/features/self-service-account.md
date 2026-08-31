# Phase 4 — Self-Service: Change Password, Reset by E-mail, Session Warnings

**Status:** SPEC — FOR REVIEW. Nothing implemented.
**Origin:** [product-analysis-2026-08-31.md](product-analysis-2026-08-31.md), phase 4 of 9.
**Scope:** Vercel-only. **Needs a migration** (`password_reset_tokens` table).

Today every forgotten password is an admin action, and the only place an agent learns their dealer
session is dying is the Order Entry page itself. At 50+ agents both become support load.

---

## What exists, measured

- **No login-password change anywhere.** Settings has WifiBizz-portal credentials only; the login
  password is set by admin at creation and edited only through the admin Users form.
- Sign-in validates `bcrypt.compare` against `User.password`; admin keeps `passwordRaw` in step on
  every admin-side change (kept by the user's decision, 2026-08-31).
- Rate limiting (`checkRateLimit`, Upstash, fails open) and a verified Resend sender already exist.
- The dealer-session countdown lives only in `OrderEntryShell`; the dashboard sidebar knows nothing.

---

## Part A — Change password (Settings)

An **Account** card on Settings, above WifiBizz Credentials: current password, new password ×2.

- Server action verifies the CURRENT password with bcrypt before anything — a stolen open session must
  not be enough to take over the account quietly.
- Minimum 8 characters; both stores updated together (`password` hash + `passwordRaw`), because admin
  visibility was kept deliberately and a change that silently broke it would make the admin page lie.
- Rate limited (`change-password:<userId>`) — wrong-current-password guesses are password guesses.
- On success: toast + the session stays (NextAuth JWT is stateless; forcing re-login adds ceremony and
  no security, since the JWT does not embed the password).

## Part B — Reset by e-mail

**Flow:** `/auth/forgot` (email box) → mail with a link → `/auth/reset?token=…` (new password ×2) →
sign in.

- **Table:** `password_reset_tokens (id, user_id, token_hash, expires_at, used_at, created_at)`. The
  token is random 32 bytes, stored **hashed** — a database leak must not hand out live reset links.
  30-minute expiry, single use (`used_at` claimed conditionally, so a double-click cannot burn two).
- **The request always answers the same thing** — *"If that address has an account, a link is on its
  way"* — whether or not the address exists. Anything else is an account-enumeration oracle.
- Rate limited per address AND per IP.
- Sent through the existing Resend sender from the same `NOTIFY_FROM_EMAIL`. Reset mail goes to the
  **login e-mail only** — the notification address is agent-editable, and a resettable address you can
  point anywhere is an account-takeover lever.
- On success the token is burned and `passwordRaw` updated as in Part A.

**A limit stated up front:** several accounts have unreal login addresses (`aiboot1@gmailcom`,
`…@gmail.com1`). Reset cannot work for those; they remain admin-reset accounts until their e-mails are
fixed. The forgot page cannot say so (enumeration), so this is an ops note, not a UI one.

## Part C — Session warnings everywhere

The dealer connection state, computed by the SAME `describeConnection` admin uses, surfaces:

1. **Dashboard sidebar** (agents with order-entry access): a small amber line under the account block
   when the session is expired or expires within 30 minutes — *"Dealer session expired — reconnect"*,
   linking to Order Entry. Green state shows nothing; absence of warning is the calm signal.
2. **New Order page**: the existing strip already covers it — unchanged.
3. The badge poll (`getSidebarInfo`) gains the dealer expiry so no new endpoint is needed.

## Pieces

| Piece | What |
|---|---|
| Migration `…_password_reset_tokens` | the table |
| `src/actions/account.ts` | `changePassword`, `requestPasswordReset`, `resetPassword` — NextAuth-side, rate-limited |
| `/auth/forgot`, `/auth/reset` pages | match the sign-in page's styling |
| reset e-mail template | via the existing `shell()` template |
| Settings Account card | Part A |
| sidebar warning | Part C |

## Tests

Pure/mocked: current-password verification refused before any write; both stores updated together;
the identical response for known and unknown addresses; token single-use claim (conditional update);
expiry respected; `resetPassword` refusing a used or expired token; rate-limit keys.

Browser: change password end-to-end and sign back in with the new one (dev); the forgot page's
identical responses; the sidebar warning with a doctored expiry (restored).

## Open questions

1. **Reset link lifetime 30 minutes** — fine, or longer for agents on phones?
2. After a successful **reset**, sign the user in automatically, or land on sign-in? (Proposal: land on
   sign-in with a success note — auto-login from an e-mail link is a phishing-shaped habit.)
