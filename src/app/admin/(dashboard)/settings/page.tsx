import { AppointmentSettings } from "@/components/admin/appointment-settings";

export default function AdminSettingsPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-[#0A2540]">Settings</h1>
        <p className="mt-1 text-sm text-[#697386]">
          Global policy applied to every agent&apos;s order submissions
        </p>
      </div>
      <AppointmentSettings />
    </div>
  );
}
