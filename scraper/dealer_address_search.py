"""
dealer_address_search.py — Portal address lookup for the BizzFlow order form.

Queries the Unifi eSales `QryNIGAddress{PN}Um` service (the same one the Select
Address modal uses) with a user's saved dealer session, and returns normalized,
serviceable addresses — each carrying the `resourceInstId` the order flow later
uses to select "By Address Id".

Read-only: no customer and no order is created. See the full API contract in
`context/features/order-entry-address-api.md`.

Design (why no request-signing): the portal's `x-csrf-token` lives in
`sessionStorage["X-CSRF-TOKEN"]` (stable per SESSION), so we load the session,
let the SPA bootstrap set it, then fire the same-origin `callservice.json` POST
from inside the CCEntryView iframe (cookies + referer inherited automatically).

Public entrypoint:
    await search_address(session_path, state, value, query_by="BY_KEYWORDS") -> dict
"""

import asyncio

import dealer_web_login
from order_entry import ORDER_ENTRY_URL, ensure_on_order_entry, InfraError

SERVICE_NAME = "QryNIGAddress{PN}Um"

# Valid `state` values (exact combobox option titles from the Select Address modal).
VALID_STATES = {
    "SELANGOR", "PAHANG", "KELANTAN", "JOHOR", "KEDAH", "MELAKA",
    "NEGERI SEMBILAN", "PERLIS", "PERAK", "PULAU PINANG", "SABAH", "SARAWAK",
    "TERENGGANU", "W.P. KUALA LUMPUR", "W.P. PUTRAJAYA", "W.P. LABUAN",
}

# Search-type → `queryBy` value (modal tabs #byKeywords / #byStreetName / …).
QUERY_BY = {
    "keyword": "BY_KEYWORDS",
    "street": "BY_STREET",
    "building": "BY_BUILDING",
    "address_id": "BY_ADDRESS_ID",
}

# Runs in the CCEntryView frame: reads the CSRF token from sessionStorage and
# fires the same-origin address query. Returns {status, text}.
_FETCH_JS = r"""async ({state, value, queryBy}) => {
  const token = sessionStorage.getItem('X-CSRF-TOKEN');
  const svc = 'QryNIGAddress{PN}Um';
  const url = '/esales/FishModule/crm/callservice.json'
    + '?service=CallCrmDubboService&serviceName=' + encodeURIComponent(svc)
    + '&timestamp=' + Date.now();
  const body = {
    ServiceName: 'CallCrmDubboService',
    Data: {
      queryBy: queryBy, state: state, value: value,
      zsmart_dubbo_service_name: svc, zsmart_fish_flag: true,
      zsmart_referer_url: location.href,
    },
    zsmart_origin_menu: null,
  };
  try {
    const resp = await fetch(url, {
      method: 'POST', credentials: 'include',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': token || '',
        'x-requested-with': 'XMLHttpRequest',
      },
      body: JSON.stringify(body),
    });
    return { status: resp.status, hasToken: !!token, text: await resp.text() };
  } catch (e) {
    return { status: -1, hasToken: !!token, text: 'fetch failed: ' + e };
  }
}"""


def _normalize(a: dict) -> dict:
    """Map a raw addressList entry to the fields BizzFlow's Order stores/shows."""
    return {
        "addressId": a.get("resourceInstId"),           # → Order.addressId
        "addressFull": a.get("concatAddress"),           # → Order.addressFull
        "serviceCategory": a.get("addrServiceCategory"), # → Order.serviceCategory (FTTH, …)
        "addressType": a.get("addressType"),             # Residential | Business
        "houseType": a.get("houseType"),
        "state": a.get("state"),
        "city": a.get("city"),
        "postcode": a.get("postcode"),
        "streetName": a.get("streetName"),
        "streetType": a.get("streetType"),
        "section": a.get("section"),
        "buildingName": a.get("buildingName"),
        "houseUnitLot": a.get("houseUnitLot"),
    }


async def search_address(
    session_path: str,
    state: str,
    value: str,
    query_by: str = "keyword",
) -> dict:
    """
    Look up serviceable addresses via the portal's QryNIGAddress service.

    Returns:
      {"success": True, "count": N, "addresses": [ {addressId, addressFull, …} ]}
      {"success": False, "error": "<code>", "message": "..."}   # expected failures

    Raises InfraError only on lost session / browser failure so the caller can
    retry (matches order_entry.py's contract).
    """
    state = (state or "").strip().upper()
    value = (value or "").strip()
    qb = QUERY_BY.get(query_by, query_by if query_by in QUERY_BY.values() else "BY_KEYWORDS")

    if state not in VALID_STATES:
        return {"success": False, "error": "invalid_state",
                "message": f"Unknown state {state!r}. Expected one of {sorted(VALID_STATES)}."}
    if not value:
        return {"success": False, "error": "empty_value", "message": "Search value is required."}

    pw = browser = context = page = None
    try:
        try:
            pw, browser, context, page = await dealer_web_login.open_context_from_session(
                session_path, landing_url=ORDER_ENTRY_URL
            )
        except Exception as e:  # noqa: BLE001
            raise InfraError(f"Could not open dealer session: {e}") from e

        # Ensure the order app rendered (also detects a lost/expired session).
        await ensure_on_order_entry(page)

        # Fire the query from inside the CCEntryView iframe (referer + cookies match).
        frame = next((f for f in page.frames if "CCEntryView" in (f.url or "")), None)
        if frame is None:
            raise InfraError("CCEntryView iframe not found for address search.")

        result = await frame.evaluate(_FETCH_JS, {"state": state, "value": value, "queryBy": qb})

        if result.get("status") != 200:
            if not result.get("hasToken"):
                raise InfraError("No X-CSRF-TOKEN in sessionStorage — session likely expired.")
            return {"success": False, "error": "portal_error",
                    "message": f"Address service returned status {result.get('status')}: "
                               f"{(result.get('text') or '')[:300]}"}

        import json
        try:
            data = json.loads(result["text"])
        except Exception as e:  # noqa: BLE001
            return {"success": False, "error": "bad_response",
                    "message": f"Could not parse address response: {e}"}

        if not data.get("callServiceSuccess", True):
            return {"success": False, "error": "portal_error",
                    "message": data.get("errorMsg") or "Address service reported failure."}

        addresses = [_normalize(a) for a in (data.get("addressList") or [])]
        return {"success": True, "count": len(addresses), "addresses": addresses}

    finally:
        for closer in (
            (context.close if context else None),
            (browser.close if browser else None),
            (pw.stop if pw else None),
        ):
            if closer:
                try:
                    await closer()
                except Exception:
                    pass


# ── CLI smoke test ────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import sys, json as _json

    sess = sys.argv[1] if len(sys.argv) > 1 else "sessions/dealer_cmno32fci000004jn760fh8fl.json"
    st = sys.argv[2] if len(sys.argv) > 2 else "SELANGOR"
    val = sys.argv[3] if len(sys.argv) > 3 else "PETALING"
    out = asyncio.run(search_address(sess, st, val))
    print(_json.dumps({**out, "addresses": out.get("addresses", [])[:3]}, indent=2))
    print(f"... total {out.get('count', 0)} addresses")
