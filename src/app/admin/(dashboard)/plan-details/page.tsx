import { PlanDetailsList } from "@/components/admin/plan-details-list";

export default function AdminPlanDetailsPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink">Plan Details</h1>
        <p className="text-sm text-ink-muted mt-1">
          Monthly price and contract period of each plan. Add plans one by one or upload a CSV.
        </p>
      </div>
      <PlanDetailsList />
    </div>
  );
}
