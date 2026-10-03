"""
clients.py - Which app is calling, and whose dealer session it may touch.

The order service has two clients: BizzFlow (the original) and SmartPortal.
They call the same routes with the same payload, so the only thing that tells
them apart is the token in `X-Internal-Token`:

    ORDER_ENTRY_API_TOKEN  -> "bizzflow"
    SMARTPORTAL_API_TOKEN  -> "smartportal"

Everything a job owns — its record, its stages, its log, its captures, the
dealer session it drives — is scoped to the client that created it. A client
asking about another client's job gets a 404, the same answer as for a job that
does not exist, so job ids cannot be probed across apps.

Pure stdlib, no Flask: the rules are testable without a request.
"""

import hmac
import os
import re

BIZZFLOW = "bizzflow"
SMARTPORTAL = "smartportal"

# Client name -> the env var holding its token. Order matters only for
# readability; every configured token is compared, constant-time.
CLIENT_TOKEN_ENV = (
    (BIZZFLOW, "ORDER_ENTRY_API_TOKEN"),
    (SMARTPORTAL, "SMARTPORTAL_API_TOKEN"),
)

# A SmartPortal user id becomes `smartportal-<id>` before it reaches anything
# keyed by user (the dealer session file, the per-agent capacity rule). BizzFlow
# ids are left exactly as they are, so nothing BizzFlow has stored moves.
SMARTPORTAL_KEY_PREFIX = "smartportal-"

# The session filename is `dealer_<_safe_key(key)>.json`, and _safe_key maps
# anything outside [A-Za-z0-9_-] to "_" and cuts at 64 characters. Two ids that
# differ only in a mapped character would therefore share one portal session.
# So a SmartPortal id must already be in that alphabet, and short enough that
# prefix + id stays under the cut.
_SMARTPORTAL_ID = re.compile(r"^[A-Za-z0-9_-]{1,48}$")


class UserKeyError(ValueError):
    """The caller's user id cannot be used. Carries a message for the response."""


class TokenConfigError(RuntimeError):
    """Two clients were given the same token. The service must not start."""


def client_token(client: str) -> str:
    """The configured token for a client, or "" when it is unset."""
    for name, env in CLIENT_TOKEN_ENV:
        if name == client:
            return (os.environ.get(env) or "").strip()
    return ""


def any_configured() -> bool:
    """Whether at least one client token is set. None set = the service is off."""
    return any(client_token(name) for name, _env in CLIENT_TOKEN_ENV)


def check_tokens() -> None:
    """Raise TokenConfigError if two clients share a token. Called at startup.

    A shared token cannot be told apart: every SmartPortal call would match
    BizzFlow's token and run as BizzFlow — BizzFlow's bucket, BizzFlow's
    webhook, BizzFlow's user ids — with no error anywhere SmartPortal could see.
    Disabling one of the two would not help (the shared value still matches the
    other), so the service refuses to start. deploy.sh's health check then
    fails and rolls the deploy back, which is as loud as this can be made.
    """
    seen = []
    for name, env in CLIENT_TOKEN_ENV:
        token = client_token(name)
        if not token:
            continue
        for other_name, other_env, other in seen:
            if hmac.compare_digest(token.encode(), other.encode()):
                raise TokenConfigError(
                    f"{env} is the same as {other_env}. Each client needs its own "
                    f"token, or {name}'s calls would run as {other_name}'s. Set a "
                    f"different {env} (or unset it) and restart.")
        seen.append((name, env, token))


def client_for_token(token) -> str | None:
    """The client a token belongs to, or None.

    Compared with hmac.compare_digest against EVERY configured token (no early
    exit on a match), and an unset or empty token never matches — an empty
    header against an unset env var must not authenticate anybody. A token that
    matches two clients authenticates neither (check_tokens stops the service
    starting that way; this keeps the function right on its own).
    """
    if not isinstance(token, str) or not token:
        return None
    given = token.encode()
    found = []
    for name, _env in CLIENT_TOKEN_ENV:
        expected = client_token(name)
        if not expected:
            continue
        if hmac.compare_digest(given, expected.encode()):
            found.append(name)
    return found[0] if len(found) == 1 else None


def job_client(job) -> str:
    """The client that created a job.

    A record with no client was created before clients existed — by BizzFlow,
    the only caller there was.
    """
    params = (job or {}).get("params") or {}
    return params.get("client") or BIZZFLOW


def owns(job, client) -> bool:
    return bool(client) and job_client(job) == client


def scoped_user_key(client: str, raw, default=None):
    """The key a user's dealer session and per-agent slot are filed under.

    BizzFlow: unchanged (`default` when absent, as each route did before).
    SmartPortal: required, `smartportal-<id>`.

    Raises UserKeyError for an unusable id.
    """
    if client == SMARTPORTAL:
        if isinstance(raw, int) and not isinstance(raw, bool):
            raw = str(raw)
        if not isinstance(raw, str) or not _SMARTPORTAL_ID.match(raw.strip()):
            raise UserKeyError(
                "`user_key` is required: 1-48 characters of letters, digits, "
                "'_' or '-'.")
        return SMARTPORTAL_KEY_PREFIX + raw.strip()

    if raw is None or raw == "":
        return default
    if isinstance(raw, str) and raw.startswith(SMARTPORTAL_KEY_PREFIX):
        # Would land on a SmartPortal user's session file.
        raise UserKeyError("`user_key` may not start with "
                           f"'{SMARTPORTAL_KEY_PREFIX}'.")
    return raw


def unscoped_user_key(client: str, key):
    """The id the client sent, for showing back to that client."""
    if client == SMARTPORTAL and isinstance(key, str) and key.startswith(SMARTPORTAL_KEY_PREFIX):
        return key[len(SMARTPORTAL_KEY_PREFIX):]
    return key
