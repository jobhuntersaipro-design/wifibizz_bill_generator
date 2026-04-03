"use client";

import { useState, useEffect, useCallback } from "react";
import { getUsers, createUser, updateUser, deleteUser } from "@/actions/admin-users";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { toast } from "sonner";

interface UserRow {
  id: string;
  name: string | null;
  email: string | null;
  passwordRaw: string | null;
  notes: string | null;
  caseLimit: number;
  wifibizzEmail: string | null;
  lastCrawlAt: string | null;
  createdAt: string;
}

type ModalMode = "create" | "edit" | null;

export function UserManagement() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalMode, setModalMode] = useState<ModalMode>(null);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);

  const loadUsers = useCallback(async () => {
    const result = await getUsers();
    if (result.success) {
      setUsers(result.data);
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
      <Card>
        <CardContent className="py-12">
          <p className="text-center text-muted-foreground text-sm">Loading users...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{users.length} user(s)</p>
        <Button onClick={openCreate}>
          <PlusIcon className="w-4 h-4 mr-2" />
          Create User
        </Button>
      </div>

      {/* Users table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left px-4 py-3 font-medium">Name</th>
                  <th className="text-left px-4 py-3 font-medium">Email</th>
                  <th className="text-left px-4 py-3 font-medium">Password</th>
                  <th className="text-left px-4 py-3 font-medium">WifiBizz Email</th>
                  <th className="text-left px-4 py-3 font-medium">Case Limit</th>
                  <th className="text-left px-4 py-3 font-medium">Notes</th>
                  <th className="text-left px-4 py-3 font-medium">Created</th>
                  <th className="text-right px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id} className="border-b last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3">{user.name || "—"}</td>
                    <td className="px-4 py-3">{user.email || "—"}</td>
                    <td className="px-4 py-3">
                      {user.passwordRaw ? (
                        <PasswordCell password={user.passwordRaw} />
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {user.wifibizzEmail ? (
                        <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded">
                          {user.wifibizzEmail}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">Not set</span>
                      )}
                    </td>
                    <td className="px-4 py-3">{user.caseLimit}</td>
                    <td className="px-4 py-3 max-w-[200px] truncate">{user.notes || "—"}</td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {new Date(user.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right space-x-2">
                      <button
                        onClick={() => openEdit(user)}
                        className="text-xs text-primary hover:underline"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => setDeleteTarget(user)}
                        className="text-xs text-red-600 hover:underline"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                      No users found. Create one to get started.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

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
      caseLimit: parseInt(fd.get("caseLimit") as string) || 10,
      wifibizzEmail: fd.get("wifibizzEmail") as string,
    };

    let result;
    if (mode === "create") {
      result = await createUser(data);
    } else {
      result = await updateUser(user!.id, {
        ...data,
        password: data.password || undefined, // don't update if empty
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <Card className="w-full max-w-md mx-4">
        <CardHeader>
          <CardTitle className="text-base">
            {mode === "create" ? "Create User" : "Edit User"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input id="name" name="name" defaultValue={user?.name ?? ""} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Login Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                required
                defaultValue={user?.email ?? ""}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">
                Password
                {mode === "edit" && (
                  <span className="text-muted-foreground font-normal ml-1">
                    (leave blank to keep current)
                  </span>
                )}
              </Label>
              <Input
                id="password"
                name="password"
                type="password"
                required={mode === "create"}
                placeholder={mode === "edit" ? "••••••••" : ""}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="wifibizzEmail">WifiBizz Email</Label>
              <Input
                id="wifibizzEmail"
                name="wifibizzEmail"
                type="email"
                placeholder="user@wifibizz.com"
                defaultValue={user?.wifibizzEmail ?? ""}
              />
              <p className="text-xs text-muted-foreground">
                Only admin can set this. User will need to enter their WifiBizz password after login.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="caseLimit">Case Limit</Label>
                <Input
                  id="caseLimit"
                  name="caseLimit"
                  type="number"
                  min={0}
                  defaultValue={user?.caseLimit ?? 10}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="notes">Notes</Label>
                <Input
                  id="notes"
                  name="notes"
                  defaultValue={user?.notes ?? ""}
                  placeholder="Optional"
                />
              </div>
            </div>

            {error && (
              <p className="text-sm text-black bg-red-100 border border-red-300 rounded-md px-3 py-2">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? "Saving..." : mode === "create" ? "Create" : "Save Changes"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
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

  async function handleDelete() {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <Card className="w-full max-w-sm mx-4">
        <CardHeader>
          <CardTitle className="text-base">Delete User</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm">
            Are you sure you want to delete{" "}
            <strong>{user.name || user.email}</strong>? This will also remove
            their WifiBizz data and cases. This action cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting..." : "Delete"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function PasswordCell({ password }: { password: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="font-mono text-xs">
        {visible ? password : "••••••••"}
      </span>
      <button
        type="button"
        onClick={() => setVisible(!visible)}
        className="text-muted-foreground hover:text-foreground"
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
