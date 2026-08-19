# QryNIGAddress — Portal Address Search API (verified capture)

Captured live 2026-07-27 from an authenticated dealer session driving the
Feasibility → Select Address modal. This is the API the BizzFlow address picker
is built against. Source capture tool: `scraper/devtools/oe_capture_address.py`; raw
capture: `scraper/logs/qrynig_capture_*.json`.

## Endpoint

```
POST https://dealer.unifi.com.my/esales/FishModule/crm/callservice.json
      ?service=CallCrmDubboService
      &serviceName=QryNIGAddress%7BPN%7DUm      # literal serviceName is  QryNIGAddress{PN}Um
      &timestamp=<Date.now() ms>
```

All order-app AJAX shares this `callservice.json` envelope (other serviceNames:
`BusiConfigurationQryService`, `QryUserDataPrivByDataPrivCodeAndUserId`,
`QryAttrValue`, …). Same headers + body wrapper for all.

## Request

Headers (the ones that matter):
| Header | Value |
|---|---|
| `content-type` | `application/json` |
| `x-csrf-token` | session UUID — see **CSRF token** below |
| `x-requested-with` | `XMLHttpRequest` |
| `referer` | `https://dealer.unifi.com.my/esales/FishModule/remote.html?crm/modules/pos/orderentry/views/CCEntryView` |
| `cookie` | the dealer session cookies (SESSION, JSESSIONID, userId, orgId, areaId, …) |

Body:
```json
{
  "ServiceName": "CallCrmDubboService",
  "Data": {
    "queryBy": "BY_KEYWORDS",
    "state": "SELANGOR",
    "value": "PETALING",
    "zsmart_dubbo_service_name": "QryNIGAddress{PN}Um",
    "zsmart_fish_flag": true,
    "zsmart_referer_url": "https://dealer.unifi.com.my/esales/FishModule/remote.html?crm/modules/pos/orderentry/views/CCEntryView#"
  },
  "zsmart_origin_menu": null
}
```

- `queryBy` — search mode. Observed `BY_KEYWORDS`. Modal also offers By Street /
  By Building / By Address Id (`#byStreetName` / `#byBuildName` / `#byAddressId`),
  which map to other `queryBy` values (capture when needed; likely
  `BY_STREET` / `BY_BUILDING` / `BY_ADDRESS_ID`).
- `state` — required. Exact option titles from the modal's State combobox:
  `SELANGOR, PAHANG, KELANTAN, JOHOR, KEDAH, MELAKA, NEGERI SEMBILAN, PERLIS,
  PERAK, PULAU PINANG, SABAH, SARAWAK, TERENGGANU, W.P. KUALA LUMPUR,
  W.P. PUTRAJAYA, W.P. LABUAN`.
- `value` — the free-text keyword.
- **`custType` (Consumer / SME) is a UI-only filter — it is NOT sent in the
  request body.**

## Response

```json
{
  "serviceName": "QryNIGAddress{PN}Um",
  "callServiceSuccess": true,
  "queryBy": "BY_KEYWORDS",
  "jobId": "5534",
  "addressList": [
    {
      "resourceInstId": "535593",                 // ← Address Id (used for "By Address Id" select)
      "concatAddress": "G-217 JALAN PJU 10/3C 3  DAMANSARA DAMAI PETALING JAYA SELANGOR MALAYSIA 47830",
      "addrServiceCategory": "FTTH",               // ← serviceability / tech
      "addressType": "Residential",                // Residential | Business
      "houseType": "Landed",                       // Landed | High-rise | …
      "state": "SELANGOR",
      "city": "PETALING JAYA",
      "postcode": "47830",
      "streetName": "PJU 10/3C",
      "streetType": "JALAN",
      "section": "DAMANSARA DAMAI",
      "buildingName": "",
      "houseUnitLot": "G-217",
      "floorNumber": "3",
      "country": "MALAYSIA",
      "premiseType": "THREE STOREY SHOP HOUSE",
      "siteNameExchange": "SGB",
      "mainDp": "SGB_C088_DP0005",
      "copperOwnTm": "YES"
    }
  ]
}
```

Empty result → `addressList: []` and the modal grid shows `.ui-jqgrid-tip`
"No record to view" → BizzFlow: address-not-found.

### Fields BizzFlow stores on `Order`
| Order column | Response field |
|---|---|
| `addressId` | `resourceInstId` |
| `addressFull` | `concatAddress` |
| `serviceCategory` | `addrServiceCategory` |
| `state` | `state` |
| `city` | `city` |
| `postcode` | `postcode` |
| `street` | `concatAddress` (or `streetType + streetName + houseUnitLot`) |

## CSRF token — where it lives

`x-csrf-token` is **NOT** a cookie. It's stored in
**`sessionStorage["X-CSRF-TOKEN"]`** (a UUID), written by the SPA bootstrap after
login. Verified: the value is **identical across separate browser launches that
load the same saved cookies** → the token is stable for the life of the portal
`SESSION`, not regenerated per page load.

Backend flow to obtain + use it (no request-signing to reverse):
1. Load the user's saved session cookies (`sessions/dealer_<key>.json`).
2. Navigate to the order-entry URL (bootstraps sessionStorage).
3. Read `sessionStorage["X-CSRF-TOKEN"]`.
4. Fire the `callservice.json` POST via a **same-origin fetch from the CCEntryView
   frame** (cookies auto-sent, referer matches; add the `x-csrf-token` header).
5. Parse `addressList`, normalize, return.

## DOM corrections to selector_map.md (from this capture)

Feasibility panel (`form.js-query-form`):
- Survey Type is a single `<li id="byAddress" class="js-select curr" oper-type="0">By Address</li>` (not keyword/street tabs).
- Address field: `input[name="installationAddress"]` (`data-ui-role="popedit"`, readonly). **Open the Select Address modal by clicking the expand icon** `.js-address-pop span.input-group-addon` → `.glyphicon-new-window` — NOT the `.js-address-pop` div.
- Feasibility Query button is **`.js-qry`** (Reset `.js-reset`); Main Offer pencil in `.js-shrink-body` (`name="subsPlanList"`, hidden until an address is picked).

Select Address modal (`form.js-address-form`, title "Select Address"):
- Required comboboxes: `custType` (SME / Consumer), `state`.
- Search-type `<li>`s: `#byKeywords` (default), `#byStreetName`, `#byBuildName`, `#byAddressId`.
- Inputs: `keywords` (required for By keyword), `streetName`, `buildName`, `addressId`, `streetType` (combobox).
- Modal Query button: **`.js-query`** (distinct from the feasibility panel's `.js-qry`).
- Results grid `.js-address-grid` columns: `state, city, streetName, section, buildingName, houseType, concatAddress, addressType, addrServiceCategory, resourceInstId`.
- Confirm selection: `.js-ok` (footer); Cancel = the other footer button.
