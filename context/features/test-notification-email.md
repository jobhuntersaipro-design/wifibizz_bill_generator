# Test Button for the Notification Email

**Ask (2026-08-29).** Settings has a **Notification email** card — the address order results and batch
summaries go to — but nothing proves an email can actually arrive there. Add a **Send test** button whose
message says *email setup successfully*.

**Correcting a standing note while building this:** the docs have said since 2026-08-22 that *this app has
never delivered a single notification*. That is **no longer true** — a real order email
(`✅ Order submitted — HONG GONG GONG`, ORD-0046, order `2608000122936216`) was delivered from
`no-reply@kim-brothers.com` at 03:02 on 2026-08-29 and is sitting in the inbox. So the webhook and the Resend
path both work. What is still missing is a way to prove delivery for **one particular address** without
submitting a real order — which is what this button is for.

## Decisions taken with the user

- **The test goes to whatever is TYPED in the box**, not to the saved value: an agent can check a new address
  before committing to it. A blank box tests the login email, which is the real fallback `resolveRecipient`
  applies. A malformed address is refused before sending.
- **The button stays enabled even when the env check says sending is not configured.** The card already warns
  about that from `notificationsConfigured`; a button that refuses to run cannot confirm or contradict it,
  and the whole point of this control is to replace a guess with an answer.

## Build

1. `testTargetFor(typed, user)` — pure, in `src/lib/notifications/recipient.ts` beside `resolveRecipient`:
   returns `{ to }` or `{ error }`. Typed wins; whitespace-only is blank; blank falls back to the login email;
   malformed is refused with the same wording the save uses.
2. `testEmail(to)` in `src/lib/notifications/templates.ts`, through the same `shell()` the order emails use —
   so a delivered test proves the real template renders, not just that Resend accepts a request. Subject and
   heading: `✅ Email setup successfully`.
3. `sendTestNotification(typed)` in `src/actions/settings.ts`: auth → rate limit → resolve → `sendEmail` →
   `{ sent, to, reason }`. The reason is Resend's own text, surfaced to the card: "it didn't work" without
   saying why is what sends someone digging through Vercel logs.
4. Rate limited through the existing `src/lib/rate-limit.ts` (Upstash, fails open) per user — without it the
   button is an authenticated "send mail to any address I type" primitive.
5. Settings card: a secondary **Send test** button beside Save, with an inline result line under it.

## Testing

vitest for `testTargetFor` (typed wins, blank falls back, whitespace-only is blank, malformed refused, no
login email at all) and for `testEmail` (subject, heading, the address appearing in the body). Browser: press
the button on the dev server and read the result line. Whether an email actually ARRIVES depends on
`RESEND_API_KEY`/`NOTIFY_FROM_EMAIL` in the environment it runs in.
