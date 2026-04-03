import { UserManagement } from "@/components/admin/user-management";

export default function AdminPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">User Management</h1>
      <UserManagement />
    </div>
  );
}
