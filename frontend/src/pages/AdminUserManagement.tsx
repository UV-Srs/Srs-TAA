import React, { useState, useEffect } from 'react';
import { User, UserRole } from '../types';
import { fetchUsers, createUser, deactivateUser, activateUser, deleteUser } from '../api';
import { UserPlus, UserX, UserCheck, Trash2, ShieldAlert, CheckCircle2 } from 'lucide-react';

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
        text: `FR-005 Compliance: User '${u.username}' deactivated. ${res.purged_audit_logs_count} audit logs purged from database while preserving historical batch records.`
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

  const handleDelete = async (u: User) => {
    if (!window.confirm(`Are you sure you want to permanently delete user '${u.username}'?`)) return;
    try {
      const res = await deleteUser(u.user_id);
      setStatusMsg({
        type: 'info',
        text: `FR-005 Compliance: User '${u.username}' deleted. ${res.purged_audit_logs_count} audit logs purged.`
      });
      await loadUsers();
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err.message || 'Failed to delete user' });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="border-b-2 border-black pb-4">
        <h2 className="text-xl font-black uppercase tracking-tight text-black">
          User Lifecycle & Access Governance
        </h2>
        <p className="text-xs font-mono text-zinc-600">
          Manage Admin, Supervisor, and Operator accounts. Automatically enforces FR-005 audit log purge on account deactivation.
        </p>
      </div>

      {statusMsg && (
        <div className={`p-3.5 text-xs font-mono border-2 flex items-start gap-2.5 ${
          statusMsg.type === 'info'
            ? 'border-black bg-zinc-100 text-black font-bold'
            : statusMsg.type === 'success'
            ? 'border-black bg-zinc-50 text-black font-bold'
            : 'border-black bg-black text-white font-bold'
        }`}>
          {statusMsg.type === 'info' && <ShieldAlert className="w-4 h-4 shrink-0 text-black" />}
          {statusMsg.type === 'success' && <CheckCircle2 className="w-4 h-4 shrink-0 text-black" />}
          <div>{statusMsg.text}</div>
        </div>
      )}

      {/* Grid: Create User & User Table */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 font-mono text-xs">
        {/* Create User Form */}
        <div className="border-2 border-black p-5 bg-white space-y-4">
          <h3 className="font-black text-sm uppercase tracking-wider text-black border-b-2 border-black pb-2 flex items-center gap-2">
            <UserPlus className="w-4 h-4" />
            Create Account (FR-002)
          </h3>

          <form onSubmit={handleCreateUser} className="space-y-3">
            <div>
              <label className="block font-bold uppercase mb-1">Username / ID:</label>
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. op_line1_raj"
                className="w-full border-2 border-black p-2 font-bold focus:outline-none"
              />
            </div>

            <div>
              <label className="block font-bold uppercase mb-1">Full Name:</label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Rajesh Kumar"
                className="w-full border-2 border-black p-2 font-bold focus:outline-none"
              />
            </div>

            <div>
              <label className="block font-bold uppercase mb-1">Password:</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full border-2 border-black p-2 font-bold focus:outline-none"
              />
            </div>

            <div>
              <label className="block font-bold uppercase mb-1">Assigned Role:</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as UserRole)}
                className="w-full border-2 border-black p-2 font-bold focus:outline-none bg-white"
              >
                <option value="operator">Operator (Inspection Execution)</option>
                <option value="supervisor">Supervisor (Review & Governance)</option>
                <option value="admin">Admin (System Configuration)</option>
              </select>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-2.5 bg-black hover:bg-zinc-800 text-white font-extrabold text-xs uppercase transition-colors disabled:opacity-50 mt-2"
            >
              {isSubmitting ? 'Creating...' : 'Create Account'}
            </button>
          </form>
        </div>

        {/* User Accounts List */}
        <div className="lg:col-span-2 border-2 border-black bg-white overflow-x-auto">
          <table className="industrial-table min-w-full text-left">
            <thead>
              <tr className="industrial-header text-[11px] divide-x-2 divide-black">
                <th className="p-3">User ID</th>
                <th className="p-3">Username</th>
                <th className="p-3">Full Name</th>
                <th className="p-3">Role</th>
                <th className="p-3">Status</th>
                <th className="p-3 text-center">Lifecycle Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y-2 divide-black">
              {users.map((u) => (
                <tr key={u.user_id} className="divide-x-2 divide-black hover:bg-zinc-50">
                  <td className="p-3 font-bold">#{u.user_id}</td>
                  <td className="p-3 font-extrabold">{u.username}</td>
                  <td className="p-3">{u.full_name}</td>
                  <td className="p-3 font-bold uppercase">{u.role}</td>
                  <td className="p-3">
                    <span className={`px-2 py-0.5 text-[10px] font-extrabold uppercase ${
                      u.is_active ? 'border border-black font-black' : 'bg-black text-white'
                    }`}>
                      {u.is_active ? 'ACTIVE' : 'DEACTIVATED'}
                    </span>
                  </td>
                  <td className="p-3 text-center">
                    <div className="flex items-center justify-center gap-2">
                      {u.is_active ? (
                        <button
                          onClick={() => handleDeactivate(u)}
                          className="px-2 py-1 border border-black hover:bg-zinc-100 font-bold text-[10px] uppercase flex items-center gap-1"
                          title="Deactivate and purge user audit logs (FR-005)"
                        >
                          <UserX className="w-3 h-3" />
                          Deactivate
                        </button>
                      ) : (
                        <button
                          onClick={() => handleActivate(u)}
                          className="px-2 py-1 bg-black text-white font-bold text-[10px] uppercase flex items-center gap-1"
                          title="Re-activate Account"
                        >
                          <UserCheck className="w-3 h-3" />
                          Activate
                        </button>
                      )}

                      <button
                        onClick={() => handleDelete(u)}
                        className="p-1 border border-black hover:bg-zinc-100 text-black"
                        title="Delete User and purge audit logs"
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
  );
};
