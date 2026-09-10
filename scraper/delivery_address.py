"""Installation address that delivery must copy on the Unifi order form.

Pure helpers only — no Playwright, no portal I/O. Kept out of oe_feasibility
so unit tests do not load dealer login / Gmail OTP imports.
"""

from __future__ import annotations


def _collapse_spaces(value: str | None) -> str:
    """Same rule as order_entry.normalize_address_line: collapse whitespace runs.

    Duplicated here so this module stays free of order_entry's dealer-login
    import chain. Keep the behaviour in lockstep with that helper.
    """
    return " ".join((value or "").split())


def installation_address_for_delivery(payload: dict | None) -> dict:
    """The installation address delivery must copy. Pure.

    Delivery used to inherit the billing-account address via the portal's
    "Default From Billing Address" checkbox. Billing and installation diverge
    whenever an existing account keeps an older address, so delivery must be
    filled from the order's installation fields instead.

    Preference order for the street line: address.address_full (the selected
    unit), address.keywords, customer.residence_street, residence_address.
    """
    payload = payload or {}
    cust = payload.get("customer") or {}
    addr = payload.get("address") or {}
    street = (
        addr.get("address_full")
        or addr.get("keywords")
        or cust.get("residence_street")
        or cust.get("residence_address")
        or ""
    )
    return {
        "street": _collapse_spaces(street),
        "postcode": str(
            addr.get("postcode") or cust.get("residence_postcode") or ""
        ).strip(),
        "city": str(cust.get("residence_city") or "").strip(),
        "state": str(
            addr.get("state") or cust.get("residence_state") or ""
        ).strip(),
        "country": str(cust.get("residence_country") or "Malaysia").strip(),
    }


def overwrite_enter_address_js() -> str:
    """page.evaluate body: fill the visible Enter Address dialog from `addr`.

    `addr` is the argument passed to page.evaluate alongside this string.
    Returns a short status string the caller stores in steps.
    """
    return r"""(addr) => {
      const f = document.querySelector('#myIframe');
      const d = f && f.contentDocument;
      if (!d) return 'nodoc';
      const vis = e => e && e.offsetParent !== null;
      const titleOf = dl => ((dl.querySelector('.modal-title,.ui-dialog-title') || {}).innerText || '');
      const dl = [...d.querySelectorAll('.ui-dialog,.modal')].filter(vis)
        .find(x => /Enter Address/i.test(titleOf(x)));
      if (!dl) return 'no-dialog';

      const setInput = (el, val) => {
        if (!el || val == null || val === '') return false;
        el.removeAttribute('disabled');
        el.disabled = false;
        el.focus();
        el.value = val;
        el.dispatchEvent(new Event('input', {bubbles: true}));
        el.dispatchEvent(new Event('change', {bubbles: true}));
        el.dispatchEvent(new Event('blur', {bubbles: true}));
        return true;
      };

      // Prefer stable js-* classes (same Enter Address modal the residence
      // pop-edit uses). Fall back to name/placeholder heuristics so a portal
      // skin change still gets postcode + street filled.
      const postcodeEl =
        dl.querySelector('input.js-Postcode, input[name*=ostcode i], input[placeholder*=ostcode i]') ||
        [...dl.querySelectorAll('input')].find(i => /post\\s*code|poskod/i.test(
          ((i.closest('.form-group') || {}).innerText || '') + (i.name || '') + (i.placeholder || '')));
      const streetEl =
        dl.querySelector(
          'input.form-control[aria-required="true"]:not(.js-countries):not(.js-Postcode):not(.js-city):not(.js-state):not([role="combobox"])'
        ) ||
        [...dl.querySelectorAll('input.form-control, textarea')].find(i => {
          if (!vis(i) || i.disabled) return false;
          const tip = ((i.closest('.form-group') || {}).innerText || '') + (i.name || '') + (i.placeholder || '');
          return /address|alamat|street/i.test(tip) && !/post\\s*code|city|state|country/i.test(tip);
        });
      const cityEl = dl.querySelector('input.js-city, input[name*=city i]');
      const stateEl = dl.querySelector('input.js-state, input[name*=state i]');

      const setP = setInput(postcodeEl, addr.postcode);
      const setS = setInput(streetEl, addr.street);
      setInput(cityEl, addr.city);
      setInput(stateEl, addr.state);
      if (!setS) return 'street-missing';
      return setP ? 'filled' : 'filled-street-only';
    }"""
