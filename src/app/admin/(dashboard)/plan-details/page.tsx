import { PlanDetailsList } from "@/components/admin/plan-details-list";

export default function AdminPlanDetailsPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Plan Details</h1>
        <p className="text-sm text-ink-muted mt-1">
          Price and contract period for each plan. The consent chat uses them when the plan name does not say.
        </p>
      </div>
      <PlanDetailsList />
    </div>
  );
}
