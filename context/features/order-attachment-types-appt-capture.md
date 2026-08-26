# Order Submit — Upload All Documents with Correct Attachment Types + Appointment Capture

## Status

Implemented — tests green (256 scraper / 520 vitest, build + lint at baseline).
NOT live-verified: needs a droplet deploy + api_server restart, then one real
submit on a draft carrying a combined PDF.

## Goals

On the portal's Customer Order Information page (the New Connection attachments page):

1. **MyKad / ID documents** keep Attachment Type **"ID copy"** (existing behaviour, unchanged).
2. **Every other uploaded order document** — especially the combined PDF (stored app-side
   as type `other`, label `combined`), plus utility bills and any future type — is uploaded
   to the portal too, each in its own attachment container with Attachment Type **"Others"**.
   Today these documents are never uploaded at all: `order_to_payload.py` collects
   `utility_doc_keys` but nothing consumes it, and `fill_customer_order_info` only handles
   `im_paths` (container 1, locked to IM Conversation) and `id_paths` ("ID copy").
3. **Screenshot the appointment date at selection time**: a new `appointment` capture slot
   photographs the Appointment dialog right after the chosen calendar slot is clicked,
   before OK — overriding the earlier "no capture here" decision at the call site.
   The existing later `order_info` frame still shows the booked row in the table.

## Notes

- User confirmed (2026-08-26): scraper code change only — the live order 2608000122517224
  they had open is finished by hand.
- `other_doc_keys` is collected as NOT-in-(id, mykad, passport, im_conversation) rather
  than as an allowlist of types, so a future app-side document type gets uploaded as
  "Others" instead of being silently dropped. The dead `utility_doc_keys` is removed.
- Dropdown option picked by `li[title="Others"]` with a has-text fallback, mirroring the
  existing "ID copy" selection.
- Capture happens per candidate slot click; a rejected slot's frame simply precedes the
  accepted one on the timeline.

## History

(see main History in current-feature.md when completed)
