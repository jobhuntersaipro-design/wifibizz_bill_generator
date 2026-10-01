import { UserManagement } from "@/components/admin/user-management";
import { ActivityLog } from "@/components/admin/activity-log";

export default function AdminPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-ink">User Management</h1>
        <p className="text-sm text-ink-muted mt-1">
          Create, edit, and manage user accounts
        </p>
      </div>
      <UserManagement />
      <ActivityLog />
    </div>
  );
}
