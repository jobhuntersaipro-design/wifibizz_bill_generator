import { describe, it, expect } from "vitest";
import {
  SUBMIT_STEPS,
  POINT_OF_NO_RETURN,
  stepIndexForStage,
} from "@/lib/order-types";

// Every stage key the scraper can emit, read off oe_feasibility.py. If a stage
// is added there without a step here it renders as a bare "Working…", so this
// list is the contract between the two deploys.
const SCRAPER_STAGES = [
  "creating_customer",
  "order_entered",
  "feasibility",
  "checking_address",
  "checking_plan",
  "placing_order",
  "attaching_customer",
  "capturing_order_no",
  "new_connection_page1",
  "installation_contact",
  "billing_account",
  "winback_tagging",
  "subproduct_tabs",
  "selecting_device",
  "customer_order_info",
  "uploading_attachments",
  "appointment",
  "delivery_terms",
  "pay",
  // Post-payment: only ever emitted when do_pay=TRUE, which is exactly why they
  // are listed here — the first run that reaches them is a real charged order,
  // and a missing step key would render that run's last two stages as "Working…".
  "erf",
  "order_complete",
  // enter_full_order emits this on a successful run; it is the final step.
  "submitted",
];

describe("stepIndexForStage", () => {
  it("resolves every stage the scraper emits", () => {
    for (const stage of SCRAPER_STAGES) {
      expect(stepIndexForStage(stage), stage).toBeGreaterThanOrEqual(0);
    }
  });

  it("returns -1 for an unknown stage rather than throwing", () => {
    // The scraper may be a deploy AHEAD of BizzFlow and emit a stage this build
    // has never heard of. That must degrade to a generic step, not break the row.
    expect(stepIndexForStage("some_future_stage")).toBe(-1);
  });

  it("returns -1 for a missing stage", () => {
    expect(stepIndexForStage(null)).toBe(-1);
    expect(stepIndexForStage(undefined)).toBe(-1);
    expect(stepIndexForStage("")).toBe(-1);
  });

  it("maps a coarse legacy stage onto the step it begins", () => {
    // An older scraper reports only `feasibility` for what is now five steps;
    // it must land on the first of them, never past work it hasn't done.
    expect(stepIndexForStage("feasibility")).toBe(stepIndexForStage("checking_address"));
    expect(stepIndexForStage("order_entered")).toBe(stepIndexForStage("checking_address"));
    expect(stepIndexForStage("new_connection_page1")).toBe(
      stepIndexForStage("installation_contact"),
    );
    expect(stepIndexForStage("customer_order_info")).toBe(
      stepIndexForStage("uploading_attachments"),
    );
  });

  it("orders the portal steps as the flow runs them", () => {
    const order = [
      "creating_customer",
      "checking_address",
      "checking_plan",
      "placing_order",
      "attaching_customer",
      "capturing_order_no",
      "installation_contact",
      "selecting_device",
      "uploading_attachments",
      "pay",
    ].map(stepIndexForStage);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(new Set(order).size).toBe(order.length);
  });
});

describe("SUBMIT_STEPS", () => {
  it("has unique keys", () => {
    const keys = SUBMIT_STEPS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("contains the point of no return", () => {
    // The UI draws its divider from this key; a rename that misses one side
    // would silently drop the "order exists in portal" warning.
    expect(SUBMIT_STEPS.some((s) => s.key === POINT_OF_NO_RETURN)).toBe(true);
  });

  it("ends on Submitted, in seventeen steps", () => {
    // The checklist ends where the order does. Downloading the e-RF and
    // clicking the confirmation page's Next are post-payment house-keeping,
    // not milestones an agent tracks — as their own steps they left a paid,
    // finished order reading 16/18.
    expect(SUBMIT_STEPS).toHaveLength(17);
    expect(SUBMIT_STEPS[SUBMIT_STEPS.length - 1].key).toBe("submitted");
    expect(SUBMIT_STEPS[SUBMIT_STEPS.length - 1].label).toBe("Submitted");
  });

  it("folds the post-payment stages into the final step", () => {
    // They are still emitted by the scraper, which deploys separately. An
    // unmapped key renders as a bare "Working…", so both must resolve — and to
    // the LAST step, since by then the charge has happened.
    const last = SUBMIT_STEPS.length - 1;
    expect(stepIndexForStage("erf")).toBe(last);
    expect(stepIndexForStage("order_complete")).toBe(last);
    expect(stepIndexForStage("submitted")).toBe(last);
    expect(last).toBeGreaterThan(stepIndexForStage("pay"));
  });

  it("puts the two pre-portal checks first", () => {
    // These are the only steps whose failure leaves nothing in the portal.
    expect(SUBMIT_STEPS[0].key).toBe("validating_draft");
    expect(SUBMIT_STEPS[1].key).toBe("checking_session");
    expect(stepIndexForStage("creating_customer")).toBe(2);
  });
});
