"""
ai_match.py - last-resort matching of a renamed package or device, by Claude.

Unifi renames packages and devices without notice ("Unifi Home 300Mbps" one
month, "unifi Home 300Mbps (24M)" the next), and the scraper picks them off the
portal's own lists by name. When the exact and fuzzy matches both miss, the run
used to stop with offer_not_found / device_not_in_offer_list and someone had to
update the draft or the catalogue by hand.

This asks Claude one narrow question: which ONE of these portal options is the
same product as the name the draft asked for — or none. It is deliberately
small and deliberately timid:

  - OFF unless OE_AI_MATCH=1 and an API key is configured. Nothing changes for a
    droplet that has not opted in.
  - Only the wanted name and the option texts are sent: product names the portal
    lists for everyone. No customer, address, IC, phone or order data.
  - Only a "high" confidence answer naming an option exactly as listed is used.
    Anything else — medium, low, none, a refusal, a timeout, an error — returns
    None, and the caller stops with the error it would have raised anyway. A
    wrong pick orders the wrong product on a real order, so "not sure" is a stop.
  - Every decision is printed to the job log with the model's one-line reason,
    and the caller reports the match in the stage detail, so a rename the AI
    resolved is visible on the order, not silent.
"""
import json
import os

DEFAULT_MODEL = "claude-opus-5-5"

# An option list longer than this is not a rename question any more.
MAX_OPTIONS = 60

_SYSTEM = (
    "You match product names for a Malaysian telco reseller's order system. The "
    "carrier's portal lists the products it currently offers; the order names the "
    "product the customer chose, sometimes under an older or slightly different "
    "name. Pick the ONE listed option that is the same product — same speed, same "
    "contract, same device model and capacity — or none. A different speed, a "
    "different device model or storage size, a different contract length, or a "
    "different bundle is NOT the same product, however similar the wording. Use "
    "\"high\" confidence only when no reasonable person could think another "
    "option, or no option, was meant."
)


def enabled() -> bool:
    """Opted in, with a key the SDK can use."""
    if os.environ.get("OE_AI_MATCH") != "1":
        return False
    return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))


def _schema(options: list) -> dict:
    return {
        "type": "object",
        "properties": {
            # The exact option text, or "" for none. An enum, so the model can
            # only name something that is actually on the portal's list.
            "choice": {"type": "string", "enum": [*options, ""]},
            "confidence": {"type": "string", "enum": ["high", "medium", "low"]},
            "reason": {"type": "string"},
        },
        "required": ["choice", "confidence", "reason"],
        "additionalProperties": False,
    }


def _prompt(kind: str, wanted: str, options: list) -> str:
    listed = "\n".join(f"- {o}" for o in options)
    return (f"The order asks for this {kind}:\n{wanted}\n\n"
            f"The portal lists these {kind} options:\n{listed}\n\n"
            "Which listed option is the same product? Answer with its text exactly "
            "as listed, or an empty choice if none is.")


def accept(answer: dict, options: list) -> str | None:
    """The option to use from a parsed answer, or None. Pure, for tests."""
    answer = answer or {}
    choice = answer.get("choice") or ""
    if answer.get("confidence") != "high":
        return None
    return choice if choice in options else None


async def pick(kind: str, wanted: str, options: list) -> dict | None:
    """Ask which of `options` is `wanted`. {"choice", "reason", "model"} or None.

    `kind` is "package" or "device", for the prompt only. Never raises: every
    failure is a None, which the caller treats exactly like no match.
    """
    wanted = (wanted or "").strip()
    options = list(dict.fromkeys(o.strip() for o in options or [] if o and o.strip()))
    if not enabled() or not wanted or not options or len(options) > MAX_OPTIONS:
        return None
    try:
        import anthropic
    except ImportError:
        print("  ⚠ ai_match: OE_AI_MATCH=1 but the anthropic package is not installed",
              flush=True)
        return None

    model = os.environ.get("OE_AI_MATCH_MODEL") or DEFAULT_MODEL
    try:
        client = anthropic.AsyncAnthropic(timeout=45.0, max_retries=1)
        response = await client.beta.messages.create(
            model=model,
            max_tokens=2048,
            system=_SYSTEM,
            messages=[{"role": "user", "content": _prompt(kind, wanted, options)}],
            output_config={
                "effort": "low",
                "format": {"type": "json_schema", "schema": _schema(options)},
            },
            # A policy decline on a product list is unlikely, but it would
            # otherwise end the match; the server retries on a fallback model.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except anthropic.APIError as e:
        print(f"  ⚠ ai_match: {kind} match call failed: {type(e).__name__}: {e}", flush=True)
        return None
    except Exception as e:  # noqa: BLE001 — a fallback must never end a run
        print(f"  ⚠ ai_match: {kind} match call failed: {type(e).__name__}: {e}", flush=True)
        return None

    if response.stop_reason != "end_turn":
        print(f"  ⚠ ai_match: no answer for {kind} {wanted!r} "
              f"(stop_reason={response.stop_reason})", flush=True)
        return None
    text = next((b.text for b in response.content if b.type == "text"), "")
    try:
        answer = json.loads(text)
    except (TypeError, ValueError):
        print(f"  ⚠ ai_match: unreadable answer for {kind} {wanted!r}", flush=True)
        return None

    choice = accept(answer, options)
    print(f"  ai_match: {kind} {wanted!r} -> {answer.get('choice')!r} "
          f"({answer.get('confidence')}) {'USED' if choice else 'not used'}: "
          f"{str(answer.get('reason'))[:200]}", flush=True)
    if not choice:
        return None
    return {"choice": choice, "reason": str(answer.get("reason") or "")[:300],
            "model": response.model}
