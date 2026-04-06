"use client";

import { useState, useEffect, useCallback } from "react";
import { getUsers, createUser, updateUser, deleteUser } from "@/actions/admin-users";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

interface UserRow {
  id: string;
  name: string | null;
  email: string | null;
  passwordRaw: string | null;
  notes: string | null;
  billLimit: number;
  wifibizzEmail: string | null;
  lastCrawlAt: string | null;
  createdAt: string;
}

type ModalMode = "create" | "edit" | null;

export function UserManagement() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);

  const loadUsers = useCallback(async () => {
    try {
      setError(null);
      const result = await getUsers();
      if (result.success) {
        setUsers(result.data);
      } else {
        setError(result.error ?? "Failed to load users");
      }
    } catch {
      setError("Failed to connect to server");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    loadUsers();
  }, [loadUsers]);

  function openCreate() {
    setEditingUser(null);
    setModalMode("create");
  }

  function openEdit(user: UserRow) {
    setEditingUser(user);
    setModalMode("edit");
  }

  function closeModal() {
    setModalMode(null);
    setEditingUser(null);
  }

  if (loading) {
    return (
      <div className="bg-white rounded-lg border border-[#E3E8EF] p-16">
        <div className="flex flex-col items-center gap-3">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#635BFF] border-t-transparent" />
          <p className="text-sm text-[#697386]">Loading users...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg border border-[#E3E8EF] p-16">
        <div className="flex flex-col items-center gap-3">
          <p className="text-sm text-[#DF1B41]">{error}</p>
          <Button onClick={() => { setLoading(true); loadUsers(); }} variant="outline" className="rounded-lg border-[#E3E8EF]">
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-sm text-[#697386]">
          <span className="font-medium text-[#0A2540] tabular-nums">{users.length}</span> user{users.length !== 1 ? "s" : ""}
        </p>
        <Button onClick={openCreate} className="rounded-lg h-9 px-4 text-sm font-semibold bg-[#635BFF] hover:bg-[#0A2540] transition-colors duration-150">
          <PlusIcon className="w-4 h-4 mr-2" />
          Create User
        </Button>
      </div>

      {/* Users table */}
      <div className="bg-white rounded-lg border border-[#E3E8EF] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E3E8EF]">
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-[#697386] uppercase tracking-wider">Name</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-[#697386] uppercase tracking-wider hidden sm:table-cell">Email</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-[#697386] uppercase tracking-wider hidden lg:table-cell">Password</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-[#697386] uppercase tracking-wider hidden lg:table-cell">WifiBizz Email</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-[#697386] uppercase tracking-wider hidden md:table-cell">Bill Limit</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-[#697386] uppercase tracking-wider hidden lg:table-cell">Notes</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-[#697386] uppercase tracking-wider hidden md:table-cell">Created</th>
                <th className="text-right px-4 py-3 text-[11px] font-semibold text-[#697386] uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E3E8EF]/60">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-[#F6F9FC] transition-colors duration-100">
                  <td className="px-4 py-3 font-medium text-[#0A2540]">{user.name || "—"}</td>
                  <td className="px-4 py-3 text-[#425466] hidden sm:table-cell">{user.email || "—"}</td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    {user.passwordRaw ? (
                      <PasswordCell password={user.passwordRaw} />
                    ) : (
                      <span className="text-[#697386]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    {user.wifibizzEmail ? (
                      <span className="inline-flex items-center text-[11px] font-medium bg-blue-50 text-blue-700 px-2 py-0.5 rounded-md">
                        {user.wifibizzEmail}
                      </span>
                    ) : (
                      <span className="text-[#697386] text-xs">Not set</span>
                    )}
                  </td>
                  <td className="px-4 py-3 hidden md:table-cell">
                    <span className="inline-flex items-center text-xs font-medium bg-[#F6F9FC] text-[#0A2540] px-2 py-0.5 rounded-md tabular-nums">
                      {user.billLimit}
                    </span>
                  </td>
                  <td className="px-4 py-3 max-w-[200px] truncate text-[#697386] text-xs hidden lg:table-cell">{user.notes || "—"}</td>
                  <td className="px-4 py-3 text-xs text-[#697386] tabular-nums hidden md:table-cell">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => openEdit(user)}
                        className="inline-flex items-center px-2.5 py-1 text-xs font-medium text-[#635BFF] hover:bg-[#F6F9FC] rounded-md transition-colors"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDeleteTarget(user)}
                        className="inline-flex items-center px-2.5 py-1 text-xs font-medium text-white bg-[#DF1B41] hover:bg-[#DF1B41]/90 rounded-md transition-colors"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-16 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <div className="w-10 h-10 rounded-lg bg-[#F6F9FC] flex items-center justify-center mb-2">
                        <UsersEmptyIcon className="w-5 h-5 text-[#697386]" />
                      </div>
                      <p className="text-sm font-medium text-[#0A2540]">No users found</p>
                      <p className="text-xs text-[#697386]">Create one to get started</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Create/Edit Modal */}
      {modalMode && (
        <UserFormModal
          mode={modalMode}
          user={editingUser}
          onClose={closeModal}
          onSaved={loadUsers}
        />
      )}

      {/* Delete Confirmation */}
      {deleteTarget && (
        <DeleteConfirmModal
          user={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDeleted={loadUsers}
        />
      )}
    </>
  );
}

function UserFormModal({
  mode,
  user,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  user: UserRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    setError("");

    const fd = new FormData(e.currentTarget);
    const data = {
      name: fd.get("name") as string,
      email: fd.get("email") as string,
      password: fd.get("password") as string,
      notes: fd.get("notes") as string,
      billLimit: parseInt(fd.get("billLimit") as string) || 10,
      wifibizzEmail: fd.get("wifibizzEmail") as string,
    };

    let result;
    if (mode === "create") {
      result = await createUser(data);
    } else {
      result = await updateUser(user!.id, {
        ...data,
        password: data.password || undefined,
      });
    }

    if (result.success) {
      toast.success(mode === "create" ? "User created" : "User updated");
      onSaved();
      onClose();
    } else {
      setError(result.error ?? "Failed to save");
    }

    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="w-full max-w-md mx-4 bg-white rounded-lg border border-[#E3E8EF] shadow-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E3E8EF]">
          <h2 className="text-sm font-semibold text-[#0A2540]">
            {mode === "create" ? "Create User" : "Edit User"}
          </h2>
        </div>
        <div className="p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="name" className="text-xs font-medium text-[#425466]">Name</Label>
              <Input id="name" name="name" defaultValue={user?.name ?? ""} className="rounded-lg h-9 border-[#E3E8EF]" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="email" className="text-xs font-medium text-[#425466]">Login Email</Label>
              <Input id="email" name="email" type="email" required defaultValue={user?.email ?? ""} className="rounded-lg h-9 border-[#E3E8EF]" />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-xs font-medium text-[#425466]">
                Password
                {mode === "edit" && (
                  <span className="font-normal ml-1 text-[#697386]">
                    (leave blank to keep current)
                  </span>
                )}
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  required={mode === "create"}
                  placeholder={mode === "edit" ? "••••••••" : ""}
                  className="rounded-lg h-9 border-[#E3E8EF] pr-9"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#697386] hover:text-[#0A2540] transition-colors"
                  title={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOffIcon className="w-4 h-4" />
                  ) : (
                    <EyeIcon className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="wifibizzEmail" className="text-xs font-medium text-[#425466]">WifiBizz Email</Label>
              <Input
                id="wifibizzEmail"
                name="wifibizzEmail"
                type="email"
                placeholder="user@wifibizz.com"
                defaultValue={user?.wifibizzEmail ?? ""}
                className="rounded-lg h-9 border-[#E3E8EF]"
              />
              <p className="text-[11px] text-[#697386]">
                Only admin can set this. User will enter their WifiBizz password after login.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="billLimit" className="text-xs font-medium text-[#425466]">Bill Limit</Label>
                <Input id="billLimit" name="billLimit" type="number" min={0} defaultValue={user?.billLimit ?? 10} className="rounded-lg h-9 border-[#E3E8EF]" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="notes" className="text-xs font-medium text-[#425466]">Notes</Label>
                <Input id="notes" name="notes" defaultValue={user?.notes ?? ""} placeholder="Optional" className="rounded-lg h-9 border-[#E3E8EF]" />
              </div>
            </div>

            {error && (
              <div className="text-sm text-[#DF1B41] bg-red-50 border border-red-200 rounded-lg px-4 py-2.5">
                {error}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose} className="rounded-lg border-[#E3E8EF] text-[#425466]">
                Cancel
              </Button>
              <Button type="submit" disabled={saving} className="rounded-lg bg-[#635BFF] hover:bg-[#0A2540] transition-colors duration-150">
                {saving ? "Saving..." : mode === "create" ? "Create" : "Save Changes"}
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function DeleteConfirmModal({
  user,
  onClose,
  onDeleted,
}: {
  user: UserRow;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [confirmText, setConfirmText] = useState("");

  async function handleDelete() {
    if (confirmText !== "DELETE") return;
    setDeleting(true);
    const result = await deleteUser(user.id);
    if (result.success) {
      toast.success("User deleted");
      onDeleted();
      onClose();
    } else {
      toast.error(result.error ?? "Failed to delete");
    }
    setDeleting(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="w-full max-w-sm mx-4 bg-white rounded-lg border border-[#E3E8EF] shadow-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E3E8EF]">
          <h2 className="text-sm font-semibold text-[#0A2540]">Delete User</h2>
        </div>
        <div className="p-6 space-y-4">
          <p className="text-sm text-[#697386] leading-relaxed">
            Are you sure you want to delete{" "}
            <strong className="text-[#0A2540]">{user.name || user.email}</strong>? This will also remove
            their WifiBizz data and cases. This action cannot be undone.
          </p>
          <div className="space-y-1.5">
            <Label className="text-xs font-medium text-[#425466]">
              Type <span className="font-semibold text-[#0A2540]">DELETE</span> to confirm
            </Label>
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              className="rounded-lg h-9 border-[#E3E8EF]"
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={onClose} className="rounded-lg border-[#E3E8EF] text-[#425466]">
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting || confirmText !== "DELETE"}
              className="rounded-lg bg-[#DF1B41] hover:bg-[#DF1B41]/90 text-white"
            >
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function PasswordCell({ password }: { password: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-mono text-xs tabular-nums">
        {visible ? password : "••••••••"}
      </span>
      <button
        type="button"
        onClick={() => setVisible(!visible)}
        className="text-[#697386] hover:text-[#0A2540] p-0.5 rounded transition-colors"
        title={visible ? "Hide password" : "Show password"}
      >
        {visible ? (
          <EyeOffIcon className="w-3.5 h-3.5" />
        ) : (
          <EyeIcon className="w-3.5 h-3.5" />
        )}
      </button>
    </span>
  );
}

function EyeIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
      <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
      <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
      <path d="m2 2 20 20" />
    </svg>
  );
}

function PlusIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  );
}

function UsersEmptyIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
