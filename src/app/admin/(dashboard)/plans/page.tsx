import { PlanDetails } from "@/components/admin/plan-details";

export default function AdminPlansPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Plan Settings</h1>
        <p className="text-sm text-ink-muted mt-1">
          Record each plan&apos;s portal offer groups, and publish the plans agents may sell
        </p>
      </div>
      <PlanDetails />
    </div>
  );
}
