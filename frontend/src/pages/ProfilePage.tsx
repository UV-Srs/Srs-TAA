import React, { useState } from 'react';
import { User } from '../types';
import { changePassword } from '../api';
import { Lock, Eye, EyeOff, CheckCircle2, AlertCircle, ShieldCheck, User as UserIcon } from 'lucide-react';

interface ProfilePageProps {
  currentUser: User;
}

const ROLE_COLOR: Record<string, string> = {
  admin:      'bg-violet-100 text-violet-700',
  supervisor: 'bg-blue-100 text-blue-700',
  operator:   'bg-emerald-100 text-emerald-700',
};

function PasswordStrength({ password }: { password: string }) {
  if (!password) return null;
  const checks = [
    { label: 'At least 6 characters', ok: password.length >= 6 },
    { label: 'Contains a number',     ok: /\d/.test(password) },
    { label: 'Contains a letter',     ok: /[a-zA-Z]/.test(password) },
  ];
  const score = checks.filter(c => c.ok).length;
  const bar = ['bg-red-400', 'bg-amber-400', 'bg-emerald-500'][score - 1] ?? 'bg-slate-200';

  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex gap-1">
        {[0, 1, 2].map(i => (
          <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i < score ? bar : 'bg-slate-200'}`} />
        ))}
      </div>
      <div className="space-y-1">
        {checks.map(c => (
          <div key={c.label} className={`flex items-center gap-1.5 text-[11px] ${c.ok ? 'text-emerald-600' : 'text-slate-400'}`}>
            <CheckCircle2 className={`w-3 h-3 shrink-0 ${c.ok ? 'text-emerald-500' : 'text-slate-300'}`} />
            {c.label}
          </div>
        ))}
      </div>
    </div>
  );
}

function PasswordInput({
  id, label, value, onChange, placeholder,
}: {
  id: string; label: string; value: string;
  onChange: (v: string) => void; placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-semibold text-slate-700 mb-1.5">{label}</label>
      <div className="relative">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full px-3 py-2.5 pr-10 border border-slate-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-shadow"
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setShow(s => !s)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition-colors"
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}

export const ProfilePage: React.FC<ProfilePageProps> = ({ currentUser }) => {
  const [currentPwd, setCurrentPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirmPwd, setConfirmPwd] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const mismatch = confirmPwd.length > 0 && newPwd !== confirmPwd;
  const canSubmit = currentPwd.length > 0 && newPwd.length >= 6 && newPwd === confirmPwd && !isSubmitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setIsSubmitting(true);
    setResult(null);
    try {
      const res = await changePassword(currentPwd, newPwd);
      // Rotate the JWT so the old token is superseded
      if (res.new_token) {
        localStorage.setItem('taa_jwt_token', res.new_token);
      }
      setResult({ ok: true, msg: 'Password changed successfully. Your session has been refreshed.' });
      setCurrentPwd('');
      setNewPwd('');
      setConfirmPwd('');
    } catch (err: any) {
      setResult({ ok: false, msg: err.message ?? 'Failed to change password.' });
    } finally {
      setIsSubmitting(false);
    }
  };

  const initials = currentUser.full_name
    .split(' ')
    .map(w => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* ── Profile card ──────────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        {/* Cover band */}
        <div className="h-20 bg-gradient-to-r from-indigo-600 to-indigo-500" />

        <div className="px-6 pb-6">
          {/* Avatar */}
          <div className="-mt-10 mb-4 flex items-end justify-between">
            <div className="w-20 h-20 rounded-2xl bg-slate-900 text-white flex items-center justify-center font-black text-2xl ring-4 ring-white select-none shadow-lg">
              {initials}
            </div>
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${ROLE_COLOR[currentUser.role] ?? 'bg-slate-100 text-slate-600'}`}>
              {currentUser.role}
            </span>
          </div>

          <div>
            <h2 className="text-xl font-bold text-slate-900">{currentUser.full_name}</h2>
            <p className="text-sm text-slate-500 mt-0.5">@{currentUser.username}</p>
          </div>

          {/* Info row */}
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="bg-slate-50 rounded-lg px-4 py-3 flex items-center gap-3">
              <UserIcon className="w-4 h-4 text-slate-400 shrink-0" />
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold">Username</p>
                <p className="text-sm font-semibold text-slate-800">@{currentUser.username}</p>
              </div>
            </div>
            <div className="bg-slate-50 rounded-lg px-4 py-3 flex items-center gap-3">
              <ShieldCheck className="w-4 h-4 text-slate-400 shrink-0" />
              <div>
                <p className="text-[10px] text-slate-400 uppercase tracking-wide font-semibold">Role</p>
                <p className="text-sm font-semibold text-slate-800 capitalize">{currentUser.role}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Change password ───────────────────────────────────── */}
      <div className="bg-white border border-slate-200 rounded-xl p-6">
        <div className="flex items-center gap-2.5 mb-5">
          <div className="w-8 h-8 rounded-lg bg-indigo-50 flex items-center justify-center">
            <Lock className="w-4 h-4 text-indigo-600" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-slate-900">Change Password</h3>
            <p className="text-xs text-slate-500">Update your login credentials</p>
          </div>
        </div>

        {result && (
          <div className={`flex items-start gap-2.5 p-3.5 rounded-lg mb-5 text-sm
            ${result.ok ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>
            {result.ok
              ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
              : <AlertCircle  className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
            }
            <span>{result.msg}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <PasswordInput
            id="current-pwd"
            label="Current Password"
            value={currentPwd}
            onChange={setCurrentPwd}
            placeholder="Enter your current password"
          />

          <div>
            <PasswordInput
              id="new-pwd"
              label="New Password"
              value={newPwd}
              onChange={setNewPwd}
              placeholder="Choose a new password"
            />
            <PasswordStrength password={newPwd} />
          </div>

          <div>
            <PasswordInput
              id="confirm-pwd"
              label="Confirm New Password"
              value={confirmPwd}
              onChange={setConfirmPwd}
              placeholder="Repeat the new password"
            />
            {mismatch && (
              <p className="mt-1.5 text-xs text-red-600 flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> Passwords do not match
              </p>
            )}
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 text-white font-semibold text-sm rounded-lg transition-colors"
            >
              {isSubmitting ? 'Saving…' : 'Update Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
