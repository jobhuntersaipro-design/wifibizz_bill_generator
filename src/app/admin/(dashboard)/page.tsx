import { UserManagement } from "@/components/admin/user-management";

export default function AdminPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-[#0A2540]">User Management</h1>
        <p className="text-sm text-[#697386] mt-1">
          Create, edit, and manage user accounts
        </p>
      </div>
      <UserManagement />
    </div>
  );
}
