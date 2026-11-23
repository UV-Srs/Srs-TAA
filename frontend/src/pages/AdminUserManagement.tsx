import React, { useState, useEffect } from 'react';
import { User, UserRole } from '../types';
import { fetchUsers, createUser, deactivateUser, activateUser, deleteUser, adminResetPassword } from '../api';
import { UserPlus, UserX, UserCheck, Trash2, ShieldAlert, CheckCircle2, KeyRound } from 'lucide-react';

export const AdminUserManagement: React.FC = () => {
  const [users, setUsers] = useState<User[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'info' | 'error'; text: string } | null>(null);

  // New User Form State
  const [username, setUsername] = useState<string>('');
  const [fullName, setFullName] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [role, setRole] = useState<UserRole>('operator');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      setIsLoading(true);
      const res = await fetchUsers();
      setUsers(res);
    } catch (err: any) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !fullName || !password) return;
    try {
      setIsSubmitting(true);
      setStatusMsg(null);
      await createUser({ username, full_name: fullName, password, role });
      setUsername('');
      setFullName('');
      setPassword('');
      setStatusMsg({ type: 'success', text: `User account '${username}' created successfully.` });
      await loadUsers();
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message || 'Failed to create user' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeactivate = async (u: User) => {
    try {
      const res = await deactivateUser(u.user_id);
      setStatusMsg({
        type: 'info',
        text: `FR-005: User '${u.username}' deactivated. ${res.purged_audit_logs_count} audit logs purged.`
      });
      await loadUsers();
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message || 'Failed to deactivate user' });
    }
  };

  const handleActivate = async (u: User) => {
    try {
      await activateUser(u.user_id);
      setStatusMsg({ type: 'success', text: `User '${u.username}' activated.` });
      await loadUsers();
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message || 'Failed to activate user' });
    }
  };

  const handleResetPassword = async (u: User) => {
    const newPwd = window.prompt(`Set a new password for '${u.username}' (min 6 characters):`);
    if (!newPwd) return;
    if (newPwd.length < 6) { setStatusMsg({ type: 'error', text: 'Password must be at least 6 characters.' }); return; }
    try {
      await adminResetPassword(u.user_id, newPwd);
      setStatusMsg({ type: 'success', text: `Password reset for '${u.username}'. All existing sessions invalidated.` });
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message || 'Failed to reset password' });
    }
  };

  const handleDelete = async (u: User) => {
    if (!window.confirm(`Are you sure you want to permanently delete user '${u.username}'?`)) return;
    try {
      const res = await deleteUser(u.user_id);
      setStatusMsg({
        type: 'info',
        text: `FR-005: User '${u.username}' deleted. ${res.purged_audit_logs_count} audit logs purged.`
      });
      await loadUsers();
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message || 'Failed to delete user' });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b border-slate-200 pb-4">
        <h2 className="text-lg font-bold text-slate-900 tracking-tight">
          User Management
        </h2>
        <p className="text-xs text-slate-500">
          Manage Admin, Supervisor, and Operator accounts. Enforces FR-005 audit log purge on account deactivation.
        </p>
      </div>

      {statusMsg && (
        <div className={`p-3 rounded-lg text-xs flex items-center gap-2 border ${
          statusMsg.type === 'info'
            ? 'border-blue-200 bg-blue-50 text-blue-800'
            : statusMsg.type === 'success'
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
            : 'border-red-200 bg-red-50 text-red-800'
        }`}>
          {statusMsg.type === 'info' && <ShieldAlert className="w-4 h-4 shrink-0 text-blue-600" />}
          {statusMsg.type === 'success' && <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />}
          <span>{statusMsg.text}</span>
        </div>
      )}

      {/* Grid: Create User & User Table */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 text-xs">
        {/* Create User Form */}
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <h3 className="font-semibold text-slate-900 pb-2 border-b border-slate-100 flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-slate-500" />
            Add New User
          </h3>

          <form onSubmit={handleCreateUser} className="space-y-3">
            <div className="space-y-1">
              <label className="font-medium text-slate-600">Username</label>
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. op_line1_raj"
                className="w-full border border-slate-300 rounded-lg p-2 font-medium focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div className="space-y-1">
              <label className="font-medium text-slate-600">Full Name</label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Rajesh Kumar"
                className="w-full border border-slate-300 rounded-lg p-2 font-medium focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div className="space-y-1">
              <label className="font-medium text-slate-600">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full border border-slate-300 rounded-lg p-2 font-medium focus:outline-none focus:ring-2 focus:ring-slate-900"
              />
            </div>

            <div className="space-y-1">
              <label className="font-medium text-slate-600">Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as UserRole)}
                className="w-full border border-slate-300 rounded-lg p-2 font-medium focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white"
              >
                <option value="operator">Operator</option>
                <option value="supervisor">Supervisor</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white font-medium rounded-lg transition-all shadow-sm disabled:opacity-50 mt-1"
            >
              {isSubmitting ? 'Creating...' : 'Create Account'}
            </button>
          </form>
        </div>

        {/* User Accounts List */}
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-800">User Accounts</span>
            <span className="text-xs text-slate-400">{users.length} total</span>
          </div>

          <div className="overflow-x-auto">
            <table className="clean-table min-w-full text-xs">
              <thead>
                <tr>
                  <th className="w-16">ID</th>
                  <th>Username</th>
                  <th>Full Name</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th className="text-center w-36">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.user_id}>
                    <td className="font-semibold text-slate-500">#{u.user_id}</td>
                    <td className="font-semibold text-slate-900">{u.username}</td>
                    <td className="text-slate-700">{u.full_name}</td>
                    <td className="capitalize text-slate-700 font-medium">{u.role}</td>
                    <td>
                      <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                        u.is_active ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-500 border border-slate-200'
                      }`}>
                        {u.is_active ? 'Active' : 'Deactivated'}
                      </span>
                    </td>
                    <td className="text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {u.is_active ? (
                          <button
                            onClick={() => handleDeactivate(u)}
                            className="px-2 py-1 text-[11px] font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded transition-colors"
                            title="Deactivate and purge user audit logs (FR-005)"
                          >
                            Deactivate
                          </button>
                        ) : (
                          <button
                            onClick={() => handleActivate(u)}
                            className="px-2 py-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded transition-colors"
                            title="Activate Account"
                          >
                            Activate
                          </button>
                        )}

                        <button
                          onClick={() => handleResetPassword(u)}
                          className="p-1 text-slate-400 hover:text-amber-600 rounded transition-colors"
                          title="Reset Password (invalidates all sessions)"
                        >
                          <KeyRound className="w-3.5 h-3.5" />
                        </button>

                        <button
                          onClick={() => handleDelete(u)}
                          className="p-1 text-slate-400 hover:text-red-600 rounded transition-colors"
                          title="Delete User"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};
