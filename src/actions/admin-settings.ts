"use server";

import { prisma } from "@/lib/prisma";
import { verifyAdminSession } from "@/lib/admin-auth";
import {
  AppointmentPolicy,
  DEFAULT_APPOINTMENT_POLICY,
  toDateKey,
  validateAppointmentPolicy,
} from "@/lib/appointment-settings";

/**
 * Global app settings — one row, id = 1.
 *
 * Read defensively everywhere: a submit must never fail because the row is
 * missing or holds a value from an older build. The fallback is
 * DEFAULT_APPOINTMENT_POLICY, which is the behaviour that shipped before this
 * setting existed.
 */
export async function getAppointmentPolicy(): Promise<AppointmentPolicy> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { id: 1 } });
    if (!row) return DEFAULT_APPOINTMENT_POLICY;
    const parsed = validateAppointmentPolicy(
      {
        strategy: row.appointmentStrategy,
        leadHours: row.appointmentLeadHours,
        fixedDate: row.appointmentFixedDate ? toDateKey(row.appointmentFixedDate) : null,
      },
      // Read-time validation must NOT reject a fixed date for being in the
      // past: that is the admin's problem to fix, and silently reverting to
      // first_available is exactly the "policy that changes itself" this
      // feature is meant to avoid. Dated far back so only shape is checked.
      new Date(0),
    );
    return parsed.ok ? parsed.policy : DEFAULT_APPOINTMENT_POLICY;
  } catch (err) {
    console.error("getAppointmentPolicy error:", err);
    return DEFAULT_APPOINTMENT_POLICY;
  }
}

export async function getAdminAppointmentPolicy(): Promise<
  { success: true; policy: AppointmentPolicy } | { success: false; error: string }
> {
  if (!(await verifyAdminSession())) return { success: false, error: "Unauthorized" };
  return { success: true, policy: await getAppointmentPolicy() };
}

export async function updateAppointmentPolicy(input: {
  strategy?: string;
  leadHours?: number | string;
  fixedDate?: string | null;
}): Promise<
  | { success: true; policy: AppointmentPolicy }
  | { success: false; error: string; field?: string }
> {
  if (!(await verifyAdminSession())) return { success: false, error: "Unauthorized" };

  const parsed = validateAppointmentPolicy(input);
  if (!parsed.ok) return { success: false, error: parsed.error, field: parsed.field };
  const { policy } = parsed;

  try {
    // Stored as a DATE; noon local keeps the value on the intended calendar day
    // whichever way the driver converts it.
    const fixed = policy.fixedDate ? new Date(`${policy.fixedDate}T12:00:00`) : null;
    const data = {
      appointmentStrategy: policy.strategy,
      appointmentLeadHours: policy.leadHours,
      appointmentFixedDate: fixed,
      updatedBy: "admin",
    };
    await prisma.appSetting.upsert({
      where: { id: 1 },
      update: data,
      create: { id: 1, ...data },
    });
    return { success: true, policy };
  } catch (err) {
    console.error("updateAppointmentPolicy error:", err);
    // The reason, not just "it failed". This page is admin-only, so there is
    // nothing to leak — and the first live save failed on a stale Prisma client
    // (the dev server caches it on globalThis, so a server started before
    // `prisma generate` has no `appSetting` model at all), which the opaque
    // message turned into a round trip that a printed error would have saved.
    const detail = err instanceof Error ? err.message.split("\n")[0].slice(0, 200) : "";
    return {
      success: false,
      error: detail ? `Couldn't save the settings: ${detail}` : "Couldn't save the settings.",
    };
  }
}
