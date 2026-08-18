"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  getAdminAppointmentPolicy,
  updateAppointmentPolicy,
} from "@/actions/admin-settings";
import {
  DEFAULT_APPOINTMENT_POLICY,
  describeAppointmentPolicy,
  toDateKey,
  validateAppointmentPolicy,
  type AppointmentStrategy,
} from "@/lib/appointment-settings";

const STRATEGIES: { value: AppointmentStrategy; label: string; hint: string }[] = [
  {
    value: "first_available",
    label: "First available",
    hint: "The earliest slot at least the lead time away. What every order should use in production.",
  },
  {
    value: "fixed_date",
    label: "Fixed date",
    hint: "Always book a named day — for a watched test run. Orders fail if that day has no slots.",
  },
];

/**
 * The global appointment booking policy.
 *
 * Global rather than per-order on purpose: the lead time is policy, not an
 * agent's preference. Letting an agent choose per order is a different feature
 * with its own UI.
 */
export function AppointmentSettings() {
  const [strategy, setStrategy] = useState<AppointmentStrategy>(
    DEFAULT_APPOINTMENT_POLICY.strategy,
  );
  const [leadHours, setLeadHours] = useState(String(DEFAULT_APPOINTMENT_POLICY.leadHours));
  const [fixedDate, setFixedDate] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<{ field: string; message: string } | null>(null);

  useEffect(() => {
    let active = true;
    getAdminAppointmentPolicy()
      .then((res) => {
        if (!active) return;
        if (res.success) {
          setStrategy(res.policy.strategy);
          setLeadHours(String(res.policy.leadHours));
          setFixedDate(res.policy.fixedDate ?? "");
        } else {
          toast.error(res.error);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!active) return;
        setLoading(false);
        toast.error("Couldn't load the settings.");
      });
    return () => {
      active = false;
    };
  }, []);

  async function save() {
    const input = { strategy, leadHours: Number(leadHours), fixedDate: fixedDate || null };
    // Validated here as well as in the action, so a past date is refused before
    // a round trip — same function, so the two can't drift apart.
    const check = validateAppointmentPolicy(input);
    if (!check.ok) {
      setError({ field: check.field, message: check.error });
      return;
    }
    setError(null);
    setSaving(true);
    const res = await updateAppointmentPolicy(input);
    setSaving(false);
    if (res.success) {
      toast.success("Appointment policy saved.");
    } else {
      if (res.field) setError({ field: res.field, message: res.error });
      toast.error(res.error);
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-[#E3E8EF] bg-white p-5">
        <p className="text-sm text-[#697386]">Loading settings…</p>
      </div>
    );
  }

  const preview = describeAppointmentPolicy({
    strategy,
    leadHours: Number(leadHours) || 0,
    fixedDate: fixedDate || null,
  });

  return (
    <div className="rounded-xl border border-[#E3E8EF] bg-white">
      <div className="border-b border-[#E3E8EF] px-5 py-4">
        <h2 className="text-[15px] font-semibold text-[#0A2540]">Appointment booking</h2>
        <p className="mt-0.5 text-[12px] text-[#697386]">
          Which installation slot a submitted order takes. Applies to every agent&apos;s orders.
        </p>
      </div>

      <div className="space-y-5 px-5 py-5">
        <fieldset>
          <legend className="text-[13px] font-semibold text-[#0A2540]">How the slot is picked</legend>
          <div className="mt-2 space-y-2">
            {STRATEGIES.map((s) => (
              <label
                key={s.value}
                className="flex cursor-pointer gap-3 rounded-lg border border-[#E3E8EF] px-3.5 py-3 hover:border-[#635BFF]/40"
              >
                <input
                  type="radio"
                  name="strategy"
                  value={s.value}
                  checked={strategy === s.value}
                  onChange={() => setStrategy(s.value)}
                  className="mt-0.5 accent-[#635BFF]"
                />
                <span>
                  <span className="block text-[13px] font-medium text-[#0A2540]">{s.label}</span>
                  <span className="mt-0.5 block text-[12px] leading-relaxed text-[#697386]">
                    {s.hint}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="leadHours"
              className="block text-[13px] font-semibold text-[#0A2540]"
            >
              Lead time (hours)
            </label>
            <input
              id="leadHours"
              type="number"
              min={0}
              value={leadHours}
              onChange={(e) => setLeadHours(e.target.value)}
              disabled={strategy === "fixed_date"}
              className="mt-1.5 w-full rounded-lg border border-[#E3E8EF] px-3 py-2 text-[13px] tabular-nums text-[#0A2540] disabled:bg-[#F6F9FC] disabled:text-[#8792A2]"
            />
            <p className="mt-1 text-[11px] text-[#8792A2]">
              {strategy === "fixed_date"
                ? "Not used — a fixed date overrides the lead time."
                : "The earliest slot an order may take, from submit time."}
            </p>
            {error?.field === "leadHours" && (
              <p className="mt-1 text-[12px] text-[#DF1B41]">{error.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="fixedDate" className="block text-[13px] font-semibold text-[#0A2540]">
              Fixed date
            </label>
            <input
              id="fixedDate"
              type="date"
              min={toDateKey(new Date())}
              value={fixedDate}
              onChange={(e) => setFixedDate(e.target.value)}
              disabled={strategy !== "fixed_date"}
              className="mt-1.5 w-full rounded-lg border border-[#E3E8EF] px-3 py-2 text-[13px] tabular-nums text-[#0A2540] disabled:bg-[#F6F9FC] disabled:text-[#8792A2]"
            />
            <p className="mt-1 text-[11px] text-[#8792A2]">
              The earliest slot on this day is booked.
            </p>
            {error?.field === "fixedDate" && (
              <p className="mt-1 text-[12px] text-[#DF1B41]">{error.message}</p>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-[#E3E8EF] bg-[#F6F9FC] px-3.5 py-3">
          <p className="text-[12px] leading-relaxed text-[#425466]">{preview}</p>
        </div>

        {strategy === "fixed_date" && (
          <p className="text-[12px] leading-relaxed text-[#B54708]">
            A fixed date never expires on its own — orders keep failing on that day until you
            change this back. That is deliberate: a booking policy that silently reverts is how a
            test setting reaches production unnoticed.
          </p>
        )}

        <div className="flex justify-end">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-lg bg-[#635BFF] px-4 py-2 text-[13px] font-semibold text-white hover:bg-[#5348e8] disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
