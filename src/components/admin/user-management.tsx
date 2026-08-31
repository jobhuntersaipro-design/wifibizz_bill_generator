"use client";

import Link from "next/link";
import { ConnectionBadge } from "@/components/admin/order-oversight";
import type { ConnectionView } from "@/lib/agent-connection";

import { useState, useEffect, useCallback } from "react";
import { getUsers, createUser, createInviteLink, updateUser, deleteUser, topupUserCaseLimit, setOrderEntryAccess } from "@/actions/admin-users";
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
  caseLimit: number;
  orderEntryEnabled: boolean;
  wifibizzEmail: string | null;
  lastCrawlAt: string | null;
  connection: ConnectionView;
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
  const [viewTarget, setViewTarget] = useState<UserRow | null>(null);
  const [topupTarget, setTopupTarget] = useState<UserRow | null>(null);

  const loadUsers = useCallback(async () => {
    // First setState happens only after the await, so calling this from an
    // effect doesn't trigger a synchronous cascading render.
    try {
      const result = await getUsers();
      if (result.success) {
        setUsers(result.data);
        setError(null);
      } else {
        setError(result.error ?? "Failed to load users");
      }
    } catch {
      setError("Failed to connect to server");
    }
    setLoading(false);
  }, []);

  // Fetch on mount. setState lives inside the async .then callback (past the
  // await boundary), so it never runs synchronously in the effect body — no
  // cascading render. `loadUsers` is kept for the Retry button below.
  useEffect(() => {
    let active = true;
    getUsers()
      .then((result) => {
        if (!active) return;
        if (result.success) {
          setUsers(result.data);
          setError(null);
        } else {
          setError(result.error ?? "Failed to load users");
        }
      })
      .catch(() => {
        if (active) setError("Failed to connect to server");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleToggleOrderEntry(user: UserRow, enabled: boolean) {
    // Optimistic toggle; revert on failure.
    setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, orderEntryEnabled: enabled } : u)));
    const res = await setOrderEntryAccess(user.id, enabled);
    if (!res.success) {
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, orderEntryEnabled: !enabled } : u)));
      toast.error(res.error ?? "Failed to update Order Entry access");
    } else {
      toast.success(`Order Entry ${enabled ? "enabled" : "disabled"} for ${user.name || user.email}`);
    }
  }

  function openCreate() {
    setEditingUser(null);
    setModalMode("create");
  }

  async function inviteUser(user: UserRow) {
    const res = await createInviteLink(user.id);
    if (!res.success || !res.url) {
      toast.error(res.error ?? "Could not create the invite link");
      return;
    }
    // Clipboard is the delivery — admin pastes it into whatever channel they
    // already use with this agent. The URL is also shown, because clipboard
    // access can be refused and a link you cannot see is a link you cannot send.
    try {
      await navigator.clipboard.writeText(res.url);
      toast.success(`Invite link copied for ${user.name || user.email}`, { description: res.url });
    } catch {
      toast.info("Copy this invite link", { description: res.url, duration: 15000 });
    }
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
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-[#697386] uppercase tracking-wider hidden md:table-cell">Case Limit</th>
                <th className="text-center px-4 py-3 text-[11px] font-semibold text-[#697386] uppercase tracking-wider">Order Entry</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-[#697386] uppercase tracking-wider hidden md:table-cell">Connection</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-[#697386] uppercase tracking-wider hidden lg:table-cell">Notes</th>
                <th className="text-left px-4 py-3 text-[11px] font-semibold text-[#697386] uppercase tracking-wider hidden md:table-cell">Created</th>
                <th className="text-right px-4 py-3 text-[11px] font-semibold text-[#697386] uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E3E8EF]/60">
              {users.map((user) => (
                <tr key={user.id} className="hover:bg-[#F6F9FC] transition-colors duration-100">
                  <td className="px-4 py-3 font-medium">
                    {/* Third way into the agent page, beside the By-agent table
                        and every order row — this is the list you are already
                        looking at when you wonder how somebody is doing. */}
                    <Link href={`/admin/agents/${user.id}`}
                      className="text-[#0A2540] hover:text-[#635BFF] hover:underline">
                      {user.name || user.email || "—"}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-[#425466] hidden sm:table-cell">{user.email || "—"}</td>
                  <td className="px-4 py-3 hidden lg:table-cell">
                    {user.passwordRaw ? (
                      <PasswordCell password={user.passwordRaw} />
                    ) : (
                      /* Password-less = invited: the agent sets their own
                         through the link, and there is nothing here to show. */
                      <span className="rounded-full bg-[#EFF4FF] px-2 py-0.5 text-[11px] text-[#3538CD]">Invited</span>
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
                      {user.caseLimit}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={!!user.orderEntryEnabled}
                      aria-label={`Order Entry access for ${user.name || user.email}`}
                      onClick={() => handleToggleOrderEntry(user, !user.orderEntryEnabled)}
                      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer ${
                        user.orderEntryEnabled ? "bg-[#635BFF]" : "bg-[#CBD2DC]"
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                          user.orderEntryEnabled ? "translate-x-4.5" : "translate-x-0.5"
                        }`}
                      />
                    </button>
                  </td>
                  {/* Beside Order Entry deliberately: both answer "can this
                      agent work right now", and access being on while the
                      session is dead is exactly the pairing worth seeing. */}
                  <td className="px-4 py-3 hidden md:table-cell">
                    <ConnectionBadge view={user.connection} />
                  </td>
                  <td className="px-4 py-3 max-w-50 truncate text-[#697386] text-xs hidden lg:table-cell">{user.notes || "—"}</td>
                  <td className="px-4 py-3 text-xs text-[#697386] tabular-nums hidden md:table-cell">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button
                        onClick={() => setViewTarget(user)}
                        className="inline-flex items-center px-2.5 py-1 text-xs font-medium text-[#425466] hover:bg-[#F6F9FC] rounded-md transition-colors"
                      >
                        View
                      </button>
                      <button
                        onClick={() => setTopupTarget(user)}
                        className="inline-flex items-center px-2.5 py-1 text-xs font-medium text-[#09825D] hover:bg-green-50 rounded-md transition-colors"
                      >
                        Topup
                      </button>
                      <button
                        onClick={() => void inviteUser(user)}
                        className="inline-flex items-center px-2.5 py-1 text-xs font-medium text-[#425466] hover:bg-[#F6F9FC] rounded-md transition-colors"
                        title="Copy a 7-day set-password link. Clicking again mints a fresh one."
                      >
                        Invite
                      </button>
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
                  <td colSpan={10} className="px-4 py-16 text-center">
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

      {/* Topup Modal */}
      {topupTarget && (
        <TopupModal
          user={topupTarget}
          onClose={() => setTopupTarget(null)}
          onSaved={loadUsers}
        />
      )}

      {/* User History Panel */}
      {viewTarget && (
        <UserHistoryPanel
          user={viewTarget}
          onClose={() => setViewTarget(null)}
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
    const formData = {
      name: fd.get("name") as string,
      email: fd.get("email") as string,
      password: fd.get("password") as string,
      notes: fd.get("notes") as string,
      caseLimit: parseInt(fd.get("caseLimit") as string) || 10,
      wifibizzEmail: fd.get("wifibizzEmail") as string,
    };

    let result;
    if (mode === "create") {
      result = await createUser(formData);
    } else {
      result = await updateUser(user!.id, {
        name: formData.name,
        email: formData.email,
        password: formData.password || undefined,
        notes: formData.notes,
        wifibizzEmail: formData.wifibizzEmail,
      });
    }

    if (result.success) {
      // A password-less create is an INVITE flow: hand the admin the link in
      // the same gesture, so "create then hunt for the Invite button" never
      // happens on the happy path.
      // `result` is a union with updateUser's return, which TS cannot narrow
      // through `in` here — the create branch is the only one that sets it.
      const createdId = (result as { userId?: string }).userId;
      if (mode === "create" && !formData.password && createdId) {
        const invite = await createInviteLink(createdId);
        if (invite.success && invite.url) {
          try {
            await navigator.clipboard.writeText(invite.url);
            toast.success("User created — invite link copied", { description: invite.url });
          } catch {
            toast.info("User created — copy the invite link", { description: invite.url, duration: 15000 });
          }
        } else {
          toast.success("User created — use the Invite button to make a link");
        }
      } else {
        toast.success(mode === "create" ? "User created" : "User updated");
      }
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
                  placeholder={mode === "edit" ? "••••••••" : "leave blank to invite instead"}
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
                <Label htmlFor="caseLimit" className="text-xs font-medium text-[#425466]">Case Limit</Label>
                {mode === "edit" ? (
                  <>
                    <Input id="caseLimit" name="caseLimit" type="number" value={user?.caseLimit ?? 10} readOnly className="rounded-lg h-9 border-[#E3E8EF] bg-[#F6F9FC] text-[#697386] cursor-not-allowed" />
                    <p className="text-[11px] text-[#697386]">Use the Topup button to increase</p>
                  </>
                ) : (
                  <Input id="caseLimit" name="caseLimit" type="number" min={0} defaultValue={10} className="rounded-lg h-9 border-[#E3E8EF]" />
                )}
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

// ── Topup Modal ──

function TopupModal({
  user,
  onClose,
  onSaved,
}: {
  user: UserRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  const QUICK_AMOUNTS = [100, 500, 1000, 5000];
  const parsedAmount = parseInt(amount) || 0;
  const newLimit = user.caseLimit + parsedAmount;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (parsedAmount <= 0) {
      setError("Amount must be a positive number");
      return;
    }
    if (!reason.trim()) {
      setError("Reason is required");
      return;
    }

    setSaving(true);
    setError("");

    const result = await topupUserCaseLimit(user.id, {
      amount: parsedAmount,
      reason: reason.trim(),
    });

    if (result.success) {
      toast.success(`Topped up ${parsedAmount.toLocaleString()} cases for ${user.name || user.email}`);
      onSaved();
      onClose();
    } else {
      setError(result.error ?? "Failed to topup");
    }

    setSaving(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="w-full max-w-sm mx-4 bg-white rounded-lg border border-[#E3E8EF] shadow-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E3E8EF]">
          <h2 className="text-sm font-semibold text-[#0A2540]">Topup Cases</h2>
          <p className="text-xs text-[#697386] mt-0.5">
            {user.name || user.email} &middot; Current limit: <span className="font-medium text-[#0A2540] tabular-nums">{user.caseLimit.toLocaleString()}</span>
          </p>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="topupAmount" className="text-xs font-medium text-[#425466]">Amount to add</Label>
            <Input
              id="topupAmount"
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="Enter number of cases"
              className="rounded-lg h-9 border-[#E3E8EF]"
              autoFocus
            />
            <div className="flex gap-1.5 pt-1">
              {QUICK_AMOUNTS.map((qty) => (
                <button
                  key={qty}
                  type="button"
                  onClick={() => setAmount(String(qty))}
                  className={`px-2.5 py-1 text-[11px] font-medium rounded-md transition-colors ${
                    amount === String(qty)
                      ? "bg-[#635BFF] text-white"
                      : "bg-[#F6F9FC] text-[#697386] hover:bg-[#E3E8EF]"
                  }`}
                >
                  +{qty.toLocaleString()}
                </button>
              ))}
            </div>
          </div>

          {parsedAmount > 0 && (
            <div className="rounded-lg bg-green-50 border border-green-200 px-4 py-2.5">
              <p className="text-xs text-[#09825D]">
                New limit: <span className="font-semibold tabular-nums">{user.caseLimit.toLocaleString()}</span>
                {" + "}
                <span className="font-semibold tabular-nums">{parsedAmount.toLocaleString()}</span>
                {" = "}
                <span className="font-semibold tabular-nums">{newLimit.toLocaleString()}</span> cases
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="topupReason" className="text-xs font-medium text-[#425466]">
              Reason <span className="text-[#DF1B41]">*</span>
            </Label>
            <Input
              id="topupReason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Monthly subscription renewal"
              className="rounded-lg h-9 border-[#E3E8EF]"
            />
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
            <Button
              type="submit"
              disabled={saving || parsedAmount <= 0}
              className="rounded-lg bg-[#09825D] hover:bg-[#09825D]/90 text-white transition-colors duration-150"
            >
              {saving ? "Processing..." : `Topup +${parsedAmount > 0 ? parsedAmount.toLocaleString() : "0"} Cases`}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── User History Panel ──

interface UsageLogEntry {
  caseNo: string;
  caseName: string | null;
  billType: string;
  chargedAt: string;
}

interface LimitChangeEntry {
  previousLimit: number;
  newLimit: number;
  changedBy: string;
  reason: string | null;
  changedAt: string;
}

interface UsageHistoryData {
  summary: { casesUsed: number; limit: number; remaining: number; internetBills: number; utilityBills: number };
  usageLog: UsageLogEntry[];
  limitChangeLog: LimitChangeEntry[];
}

function UserHistoryPanel({ user, onClose }: { user: UserRow; onClose: () => void }) {
  const [data, setData] = useState<UsageHistoryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"usage" | "limits">("usage");

  useEffect(() => {
    fetch(`/api/admin/users/${user.id}/usage-history`)
      .then((res) => res.json())
      .then((d: UsageHistoryData) => setData(d))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user.id]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="w-full max-w-2xl mx-4 bg-white rounded-lg border border-[#E3E8EF] shadow-xl overflow-hidden max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-[#E3E8EF] flex items-center justify-between shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-[#0A2540]">{user.name || user.email}</h2>
            <p className="text-xs text-[#697386] mt-0.5">Usage history & limit changes</p>
          </div>
          <button onClick={onClose} className="text-[#697386] hover:text-[#0A2540] transition-colors p-1">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
          </button>
        </div>

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-[#635BFF] border-t-transparent" />
          </div>
        ) : data ? (
          <>
            {/* Summary */}
            <div className="px-6 py-4 border-b border-[#E3E8EF] shrink-0">
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-[11px] font-medium text-[#697386] uppercase tracking-wider">Cases Used</p>
                  <p className="text-xl font-semibold text-[#0A2540] tabular-nums">{data.summary.casesUsed} <span className="text-sm font-normal text-[#697386]">/ {data.summary.limit}</span></p>
                </div>
                <div>
                  <p className="text-[11px] font-medium text-[#697386] uppercase tracking-wider">Remaining</p>
                  <p className="text-xl font-semibold text-[#0A2540] tabular-nums">{data.summary.remaining}</p>
                </div>
                <div>
                  <p className="text-[11px] font-medium text-[#697386] uppercase tracking-wider">Bills</p>
                  <p className="text-sm text-[#425466] tabular-nums">{data.summary.internetBills} internet, {data.summary.utilityBills} utility</p>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="px-6 border-b border-[#E3E8EF] flex gap-4 shrink-0">
              <button
                onClick={() => setTab("usage")}
                className={`py-2.5 text-xs font-medium border-b-2 transition-colors ${tab === "usage" ? "border-[#635BFF] text-[#0A2540]" : "border-transparent text-[#697386] hover:text-[#425466]"}`}
              >
                Usage Log ({data.usageLog.length})
              </button>
              <button
                onClick={() => setTab("limits")}
                className={`py-2.5 text-xs font-medium border-b-2 transition-colors ${tab === "limits" ? "border-[#635BFF] text-[#0A2540]" : "border-transparent text-[#697386] hover:text-[#425466]"}`}
              >
                Limit History ({data.limitChangeLog.length})
              </button>
            </div>

            {/* Tab Content */}
            <div className="overflow-y-auto flex-1">
              {tab === "usage" ? (
                data.usageLog.length === 0 ? (
                  <div className="text-center py-8 text-sm text-[#697386]">No usage yet</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#E3E8EF]">
                        <th className="text-left px-6 py-2.5 text-[11px] font-semibold text-[#697386] uppercase tracking-wider">Case No.</th>
                        <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-[#697386] uppercase tracking-wider hidden sm:table-cell">Customer</th>
                        <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-[#697386] uppercase tracking-wider">Bill Type</th>
                        <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-[#697386] uppercase tracking-wider">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E3E8EF]/60">
                      {data.usageLog.map((entry, i) => (
                        <tr key={i} className="hover:bg-[#F6F9FC] transition-colors">
                          <td className="px-6 py-2.5 font-medium text-[#0A2540] tabular-nums">{entry.caseNo}</td>
                          <td className="px-3 py-2.5 text-[#425466] max-w-45 truncate hidden sm:table-cell">{entry.caseName || "—"}</td>
                          <td className="px-3 py-2.5">
                            <span className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded-md ${
                              entry.billType === "internet" ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700"
                            }`}>
                              {entry.billType === "internet" ? "Internet" : "Utility"}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-xs text-[#697386] tabular-nums">
                            {new Date(entry.chargedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              ) : (
                data.limitChangeLog.length === 0 ? (
                  <div className="text-center py-8 text-sm text-[#697386]">No limit changes yet</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#E3E8EF]">
                        <th className="text-left px-6 py-2.5 text-[11px] font-semibold text-[#697386] uppercase tracking-wider">Date</th>
                        <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-[#697386] uppercase tracking-wider">Previous</th>
                        <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-[#697386] uppercase tracking-wider">New</th>
                        <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-[#697386] uppercase tracking-wider hidden sm:table-cell">Changed By</th>
                        <th className="text-left px-3 py-2.5 text-[11px] font-semibold text-[#697386] uppercase tracking-wider hidden sm:table-cell">Reason</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#E3E8EF]/60">
                      {data.limitChangeLog.map((entry, i) => (
                        <tr key={i} className="hover:bg-[#F6F9FC] transition-colors">
                          <td className="px-6 py-2.5 text-xs text-[#697386] tabular-nums">
                            {new Date(entry.changedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
                          </td>
                          <td className="px-3 py-2.5 tabular-nums text-[#0A2540]">{entry.previousLimit}</td>
                          <td className="px-3 py-2.5 tabular-nums font-medium text-[#0A2540]">{entry.newLimit}</td>
                          <td className="px-3 py-2.5 text-[#425466] hidden sm:table-cell">{entry.changedBy}</td>
                          <td className="px-3 py-2.5 text-xs text-[#697386] max-w-45 truncate hidden sm:table-cell">{entry.reason || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              )}
            </div>
          </>
        ) : (
          <div className="text-center py-8 text-sm text-[#DF1B41]">Failed to load history</div>
        )}
      </div>
    </div>
  );
}
