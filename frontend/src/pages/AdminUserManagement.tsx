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

  // Inline password reset state
  const [resetTargetId, setResetTargetId] = useState<number | null>(null);
  const [resetPwdValue, setResetPwdValue] = useState<string>('');

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

  const handleResetPassword = (u: User) => {
    setResetTargetId(u.user_id);
    setResetPwdValue('');
  };

  const handleResetPasswordSubmit = async (u: User) => {
    if (resetPwdValue.length < 6) { setStatusMsg({ type: 'error', text: 'Password must be at least 6 characters.' }); return; }
    try {
      await adminResetPassword(u.user_id, resetPwdValue);
      setStatusMsg({ type: 'success', text: `Password reset for '${u.username}'. All existing sessions invalidated.` });
      setResetTargetId(null);
      setResetPwdValue('');
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
      <div className="pb-4" style={{ borderBottom: '1px solid var(--line)' }}>
        <h2 className="font-semibold" style={{ fontSize: 24, letterSpacing: '-0.015em', color: 'var(--ink)' }}>
          Team
        </h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>
          Manage Admin, Supervisor and Operator accounts.
        </p>
      </div>

      {statusMsg && (
        <div className="p-3 rounded-lg text-xs flex items-center gap-2" style={
          statusMsg.type === 'info'
            ? { border: '1px solid var(--line2)', background: 'var(--accent-soft)', color: 'var(--accent)' }
            : statusMsg.type === 'success'
            ? { border: '1px solid #b2dcc5', background: 'var(--ok-bg)', color: 'var(--ok)' }
            : { border: '1px solid #f1b8b5', background: 'var(--ng-bg)', color: 'var(--ng)' }
        }>
          {statusMsg.type === 'info' && <ShieldAlert className="w-4 h-4 shrink-0 text-blue-600" />}
          {statusMsg.type === 'success' && <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />}
          <span>{statusMsg.text}</span>
        </div>
      )}

      {/* Grid: Create User & User Table */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 text-xs">
        {/* Create User Form */}
        <div className="p-5 space-y-4" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16 }}>
          <h3 className="font-semibold pb-2 flex items-center gap-2" style={{ color: 'var(--ink)', borderBottom: '1px solid var(--line)' }}>
            <UserPlus className="w-4 h-4" style={{ color: 'var(--muted)' }} />
            Add New User
          </h3>

          <form onSubmit={handleCreateUser} className="space-y-3">
            <div className="space-y-1">
              <label className="font-medium" style={{ color: 'var(--ink)' }}>Username</label>
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. op_line1_raj"
                className="w-full p-2 font-medium outline-none"
                style={{ border: '1px solid var(--line2)', borderRadius: 10, color: 'var(--ink)' }}
              />
            </div>

            <div className="space-y-1">
              <label className="font-medium" style={{ color: 'var(--ink)' }}>Full Name</label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Rajesh Kumar"
                className="w-full p-2 font-medium outline-none"
                style={{ border: '1px solid var(--line2)', borderRadius: 10, color: 'var(--ink)' }}
              />
            </div>

            <div className="space-y-1">
              <label className="font-medium" style={{ color: 'var(--ink)' }}>Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full p-2 font-medium outline-none"
                style={{ border: '1px solid var(--line2)', borderRadius: 10, color: 'var(--ink)' }}
              />
            </div>

            <div className="space-y-1">
              <label className="font-medium" style={{ color: 'var(--ink)' }}>Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as UserRole)}
                className="w-full p-2 font-medium outline-none"
                style={{ border: '1px solid var(--line2)', borderRadius: 10, background: 'var(--surface)', color: 'var(--ink)' }}
              >
                <option value="operator">Operator</option>
                <option value="supervisor">Supervisor</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="btn primary w-full mt-1"
            >
              {isSubmitting ? 'Creating…' : 'Create Account'}
            </button>
          </form>
        </div>

        {/* User Accounts List */}
        <div className="lg:col-span-2 overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16 }}>
          <div className="px-5 py-3 flex items-center justify-between" style={{ borderBottom: '1px solid var(--line)' }}>
            <span className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>User Accounts</span>
            <span className="text-xs" style={{ color: 'var(--muted)' }}>{users.length} total</span>
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
                    <td className="font-semibold tabular-nums" style={{ color: 'var(--muted)' }}>#{u.user_id}</td>
                    <td className="font-semibold" style={{ color: 'var(--ink)' }}>{u.username}</td>
                    <td style={{ color: 'var(--ink)' }}>{u.full_name}</td>
                    <td className="capitalize font-medium" style={{ color: 'var(--ink)' }}>{u.role}</td>
                    <td>
                      <span className="pill" style={
                        u.is_active
                          ? { background: 'var(--ok-bg)', color: 'var(--ok)' }
                          : { background: 'var(--surface2)', color: 'var(--muted)' }
                      }>
                        {u.is_active ? 'Active' : 'Deactivated'}
                      </span>
                    </td>
                    <td className="text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        {u.is_active ? (
                          <button
                            onClick={() => handleDeactivate(u)}
                            className="px-2 py-1 text-[11px] font-medium rounded transition-colors"
                            style={{ background: 'var(--surface2)', color: 'var(--ink)' }}
                            title="Deactivate and purge user audit logs (FR-005)"
                          >
                            Deactivate
                          </button>
                        ) : (
                          <button
                            onClick={() => handleActivate(u)}
                            className="px-2 py-1 text-[11px] font-medium rounded transition-colors"
                            style={{ background: 'var(--ok-bg)', color: 'var(--ok)', border: '1px solid #b2dcc5' }}
                            title="Activate Account"
                          >
                            Activate
                          </button>
                        )}

                        {resetTargetId !== u.user_id ? (
                          <button
                            onClick={() => handleResetPassword(u)}
                            className="p-1 rounded transition-colors"
                            style={{ color: 'var(--muted)' }}
                            title="Reset Password"
                          >
                            <KeyRound className="w-3.5 h-3.5" />
                          </button>
                        ) : null}

                        <button
                          onClick={() => handleDelete(u)}
                          className="p-1 rounded transition-colors"
                          style={{ color: 'var(--muted)' }}
                          title="Delete User"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {resetTargetId === u.user_id && (
                        <div className="mt-2 flex items-center gap-2">
                          <input
                            type="password"
                            value={resetPwdValue}
                            onChange={e => setResetPwdValue(e.target.value)}
                            placeholder="New password (min 6 chars)"
                            className="flex-1 h-8 px-2 text-xs rounded border"
                            style={{ borderColor: 'var(--line2)', background: 'var(--surface)' }}
                            autoFocus
                          />
                          <button
                            onClick={() => handleResetPasswordSubmit(u)}
                            className="px-2 py-1 text-xs font-semibold rounded"
                            style={{ background: 'var(--primary)', color: '#fff' }}
                          >Save</button>
                          <button
                            onClick={() => { setResetTargetId(null); setResetPwdValue(''); }}
                            className="px-2 py-1 text-xs rounded"
                            style={{ background: 'var(--surface2)', color: 'var(--ink)' }}
                          >Cancel</button>
                        </div>
                      )}
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
