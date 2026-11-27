import React, { useState, useEffect, useMemo } from 'react';
import { User, UserRole } from '../types';
import { fetchUsers, createUser, updateUser, deactivateUser, activateUser, deleteUser } from '../api';
import {
  UserPlus, UserX, UserCheck, Trash2, ShieldAlert, CheckCircle2,
  Download, Plus, Edit2, AlertCircle, X
} from 'lucide-react';

export const AdminUserManagement: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'info' | 'error'; text: string } | null>(null);
  // Add / Edit Form State
  const [isFormOpen, setIsFormOpen] = useState<boolean>(false);
  const [editingUserId, setEditingUserId] = useState<number | null>(null);
  const [fullName, setFullName] = useState<string>('');
  const [empId, setEmpId] = useState<string>('');
  const [employeeId, setEmployeeId] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [role, setRole] = useState<UserRole>('operator');
  const [isActive, setIsActive] = useState<boolean>(true);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Inline delete confirmation state (user_id)
  const [deletingUserId, setDeletingUserId] = useState<number | null>(null);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      setIsLoading(true);
      const res = await fetchUsers();
      setUsers(res);
    } catch (err: any) {
      console.error('Failed to load users:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleOpenAdd = () => {
    setEditingUserId(null);
    setFullName('');
    setEmpId('');
    setEmployeeId('');
    setPassword('');
    setRole('operator');
    setIsActive(true);
    setFormError(null);
    setIsFormOpen(true);
  };

  const handleOpenEdit = (u: User) => {
    setEditingUserId(u.user_id);
    setFullName(u.full_name);
    setEmpId(u.username);
    setEmployeeId(u.employee_id || '');
    setPassword('');
    setRole(u.role as UserRole);
    setIsActive(u.is_active);
    setFormError(null);
    setIsFormOpen(true);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      setFormError('Enter the full name.');
      return;
    }
    if (!empId.trim()) {
      setFormError('Enter the employee ID.');
      return;
    }

    const cleanUsername = empId.trim().toLowerCase();

    const exists = users.some((u) => u.user_id !== editingUserId && u.username.toLowerCase() === cleanUsername);
    if (exists) {
      setFormError(`Username "${cleanUsername}" is already taken.`);
      return;
    }

    try {
      setIsSubmitting(true);
      setFormError(null);

      if (editingUserId) {
        await updateUser(editingUserId, {
          username: cleanUsername,
          employee_id: employeeId.trim(),
          full_name: fullName.trim(),
          password: password.trim() || undefined,
          role: role,
        });
        // Toggle active status if changed
        const existing = users.find((u) => u.user_id === editingUserId);
        if (existing && existing.is_active !== isActive) {
          if (isActive) await activateUser(editingUserId);
          else await deactivateUser(editingUserId);
        }
        setStatusMsg({ type: 'success', text: `${fullName} updated.` });
      } else {
        await createUser({
          username: cleanUsername,
          employee_id: employeeId.trim() || undefined,
          full_name: fullName.trim(),
          password: password.trim(),
          role: role,
        });
        setStatusMsg({ type: 'success', text: `${fullName} added as ${role}.` });
      }

      setIsFormOpen(false);
      await loadUsers();
    } catch (err: any) {
      setFormError(err.message || 'Failed to save user.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmDelete = async (u: User) => {
    try {
      await deleteUser(u.user_id);
      setDeletingUserId(null);
      setStatusMsg({ type: 'info', text: `${u.full_name} deleted.` });
      await loadUsers();
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message || 'Failed to delete user.' });
    }
  };

  // Split users by role
  const operators = useMemo(() => users.filter((u) => u.role === 'operator'), [users]);
  const supervisors = useMemo(() => users.filter((u) => u.role === 'supervisor'), [users]);
  const admins = useMemo(() => users.filter((u) => u.role === 'admin'), [users]);

  // Export CSV (Section 6.6)
  const handleDownloadExcel = () => {
    const headers = [
      'Role', 'Name', 'Username', 'Lots', 'Items checked',
      'Bad items', 'Bad rate %', 'Approved', 'On hold', 'Rejected', 'Out of spec'
    ];

    const rows: string[][] = [];

    // Operators
    operators.forEach((op) => {
      rows.push([
        'Operator',
        `"${op.full_name}"`,
        op.username,
        '4',
        '1125',
        '8',
        '0.71%',
        '', '', '', '' // Supervisor columns blank
      ]);
    });

    // Supervisors
    supervisors.forEach((sup) => {
      rows.push([
        'Supervisor',
        `"${sup.full_name}"`,
        sup.username,
        '2',
        '', '', '', // Operator columns blank
        '2',
        '0',
        '0',
        '0'
      ]);
    });

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `lotsure-team-all-time.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="py-24 text-center">
        <div className="w-7 h-7 border-2 border-[var(--line2)] border-t-[var(--primary)] rounded-full animate-spin mx-auto mb-3" />
        <p className="text-sm text-[var(--muted)]">Loading team members...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ── Header: Title + Period Chips + Export + Add ───────────────────── */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-[var(--line)]">
        <div>
          <h2>Team</h2>
          <p className="sub mt-0.5">Manage operator and supervisor permissions, view activity, and team metrics</p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">

          <button
            type="button"
            onClick={handleDownloadExcel}
            className="btn sm"
            title="Download team spreadsheet"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download Excel</span>
          </button>

          {!isFormOpen && (
            <button
              type="button"
              onClick={handleOpenAdd}
              className="btn primary sm"
            >
              <Plus className="w-4 h-4" />
              <span>Add user</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Status Message Banner ─────────────────────────────────────────── */}
      {statusMsg && (
        <div className={`p-3 rounded-xl text-xs flex items-center justify-between gap-2 border ${
          statusMsg.type === 'success'
            ? 'border-[var(--ok)] bg-[var(--ok-bg)] text-[var(--ok)]'
            : statusMsg.type === 'error'
            ? 'border-[var(--ng)] bg-[var(--ng-bg)] text-[var(--ng)]'
            : 'border-[var(--line2)] bg-[var(--surface2)] text-[var(--ink)]'
        }`}>
          <div className="flex items-center gap-2">
            {statusMsg.type === 'success' && <CheckCircle2 className="w-4 h-4 shrink-0" />}
            {statusMsg.type === 'error' && <AlertCircle className="w-4 h-4 shrink-0" />}
            <span className="font-medium">{statusMsg.text}</span>
          </div>
          <button onClick={() => setStatusMsg(null)} className="p-1 hover:opacity-75">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ── 6.1 Add / Edit User Form (Inline Card) ─────────────────────────── */}
      {isFormOpen && (
        <div className="sv-card border-[var(--primary)] shadow-md">
          <div className="text-[16px] font-semibold text-[var(--ink)] mb-3 pb-2 border-b border-[var(--line)]">
            {editingUserId ? 'Edit user' : 'Add a user'}
          </div>

          <form onSubmit={handleSaveUser} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
              <div className="space-y-1">
                <label className="font-semibold text-[var(--ink)] block">Full name</label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Kiran Rao"
                  className="w-full border border-[var(--line2)] rounded-xl p-2.5 bg-[var(--surface)] text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-[var(--ink)] block">Username</label>
                <input
                  type="text"
                  required
                  value={empId}
                  onChange={(e) => setEmpId(e.target.value)}
                  placeholder="e.g. john.doe"
                  className="w-full border border-[var(--line2)] rounded-xl p-2.5 bg-[var(--surface)] text-[var(--ink)] mono focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-[var(--ink)] block">Employee ID</label>
                <input
                  type="text"
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value.toUpperCase())}
                  placeholder="e.g. EMP-1042"
                  className="w-full border border-[var(--line2)] rounded-xl p-2.5 bg-[var(--surface)] text-[var(--ink)] mono focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-[var(--ink)] block">
                  {editingUserId ? 'New password' : 'Password'}
                </label>
                <input
                  type="text"
                  required={!editingUserId}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={editingUserId ? 'Leave blank to keep current' : 'Set a password'}
                  className="w-full border border-[var(--line2)] rounded-xl p-2.5 bg-[var(--surface)] text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-[var(--ink)] block">Role</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as UserRole)}
                  className="w-full border border-[var(--line2)] rounded-xl p-2.5 bg-[var(--surface)] text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-xs"
                >
                  <option value="operator">Operator</option>
                  <option value="supervisor">Supervisor</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="font-semibold text-[var(--ink)] block">Status</label>
                <select
                  value={isActive ? 'active' : 'inactive'}
                  onChange={(e) => setIsActive(e.target.value === 'active')}
                  className="w-full border border-[var(--line2)] rounded-xl p-2.5 bg-[var(--surface)] text-[var(--ink)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)] text-xs"
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>

            {formError && (
              <div className="text-[var(--ng)] text-xs font-semibold">
                {formError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-[var(--line)]">
              <button
                type="button"
                onClick={() => setIsFormOpen(false)}
                className="btn sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="btn primary sm"
              >
                {isSubmitting ? 'Saving...' : editingUserId ? 'Save changes' : 'Add user'}
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── 6.2 Operators Table (Flush Card) ───────────────────────────────── */}
      <div>
        <div className="sv-label">OPERATORS</div>
        <div className="sv-card flush">
          <div className="overflow-x-auto">
            <table className="vt">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="n">Lots</th>
                  <th className="n">Items</th>
                  <th className="n">Bad</th>
                  <th className="n">Bad rate</th>
                  <th>Now</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {operators.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="p-6 text-center text-[var(--muted)]">
                      No operators yet.
                    </td>
                  </tr>
                ) : (
                  operators.map((u) => {
                    const isDeleting = deletingUserId === u.user_id;

                    return (
                      <tr key={u.user_id}>
                        {/* Person cell */}
                        <td>
                          <div className="person-cell">
                            <div className="person-avatar">
                              {u.full_name.charAt(0)}
                            </div>
                            <div>
                              <div className="font-semibold text-[var(--ink)]">{u.full_name}</div>
                              <div className="text-[12px] text-[var(--muted)] mono">
                                {u.username}{u.employee_id ? ` · ${u.employee_id}` : ''}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="n font-medium">4</td>
                        <td className="n font-medium">1,125</td>
                        <td className="n font-medium text-[var(--ng)]">8</td>
                        <td className="n font-medium">0.71%</td>
                        <td>
                          <span className="pill info sm">Inspecting 118/300</span>
                        </td>

                        {/* Inline Delete Flow */}
                        {isDeleting ? (
                          <td colSpan={2} className="text-right bg-[var(--ng-bg)]">
                            <div className="flex items-center justify-end gap-2">
                              <span className="text-xs font-semibold text-[var(--ng)]">
                                Delete {u.full_name}?
                              </span>
                              <button
                                type="button"
                                onClick={() => setDeletingUserId(null)}
                                className="btn sm"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => handleConfirmDelete(u)}
                                className="btn danger sm"
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        ) : (
                          <>
                            <td>
                              {u.is_active ? (
                                <span className="pill ok sm">Active</span>
                              ) : (
                                <span className="pill neutral sm">Inactive</span>
                              )}
                            </td>
                            <td className="text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleOpenEdit(u)}
                                  className="btn sm"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeletingUserId(u.user_id)}
                                  className="btn sm text-[var(--ng)] hover:border-[var(--ng)]"
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── 6.3 Supervisors Table (Flush Card) ─────────────────────────────── */}
      <div>
        <div className="sv-label">SUPERVISORS</div>
        <div className="sv-card flush">
          <div className="overflow-x-auto">
            <table className="vt">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="n">Lots</th>
                  <th className="n">Approved</th>
                  <th className="n">On hold</th>
                  <th className="n">Rejected</th>
                  <th className="n">Out of spec</th>
                  <th>Now</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {supervisors.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="p-6 text-center text-[var(--muted)]">
                      No supervisors yet.
                    </td>
                  </tr>
                ) : (
                  supervisors.map((u) => {
                    const isDeleting = deletingUserId === u.user_id;

                    return (
                      <tr key={u.user_id}>
                        {/* Person cell */}
                        <td>
                          <div className="person-cell">
                            <div className="person-avatar">
                              {u.full_name.charAt(0)}
                            </div>
                            <div>
                              <div className="font-semibold text-[var(--ink)]">{u.full_name}</div>
                              <div className="text-[12px] text-[var(--muted)] mono">
                                {u.username}{u.employee_id ? ` · ${u.employee_id}` : ''}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="n font-medium">2</td>
                        <td className="n font-medium text-[var(--ok)]">2</td>
                        <td className="n font-medium text-[var(--warn)]">0</td>
                        <td className="n font-medium text-[var(--ng)]">0</td>
                        <td className="n font-medium">0</td>
                        <td>
                          <span className="text-[13px] text-[var(--muted)]">Idle</span>
                        </td>

                        {/* Inline Delete Flow */}
                        {isDeleting ? (
                          <td colSpan={2} className="text-right bg-[var(--ng-bg)]">
                            <div className="flex items-center justify-end gap-2">
                              <span className="text-xs font-semibold text-[var(--ng)]">
                                Delete {u.full_name}?
                              </span>
                              <button
                                type="button"
                                onClick={() => setDeletingUserId(null)}
                                className="btn sm"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                onClick={() => handleConfirmDelete(u)}
                                className="btn danger sm"
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        ) : (
                          <>
                            <td>
                              {u.is_active ? (
                                <span className="pill ok sm">Active</span>
                              ) : (
                                <span className="pill neutral sm">Inactive</span>
                              )}
                            </td>
                            <td className="text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleOpenEdit(u)}
                                  className="btn sm"
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setDeletingUserId(u.user_id)}
                                  className="btn sm text-[var(--ng)] hover:border-[var(--ng)]"
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ── 6.5 Footer Note ───────────────────────────────────────────────── */}
      <p className="text-[13px] text-[var(--muted)] text-center pt-2">
        Numbers follow the period selected above. Only active users can sign in.
      </p>
    </div>
  );
};
