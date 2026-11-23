import React, { useState } from 'react';
import { User } from '../types';
import { changePassword } from '../api';
import { Lock, Eye, EyeOff, CheckCircle2, AlertCircle, ShieldCheck, User as UserIcon } from 'lucide-react';

interface ProfilePageProps {
  currentUser: User;
}

const ROLE_STYLE: Record<string, React.CSSProperties> = {
  admin:      { background: 'var(--accent-soft)', color: 'var(--accent)' },
  supervisor: { background: 'var(--ok-bg)', color: 'var(--ok)' },
  operator:   { background: 'var(--surface2)', color: 'var(--muted)' },
};

function PasswordStrength({ password }: { password: string }) {
  if (!password) return null;
  const checks = [
    { label: 'At least 6 characters', ok: password.length >= 6 },
    { label: 'Contains a number',     ok: /\d/.test(password) },
    { label: 'Contains a letter',     ok: /[a-zA-Z]/.test(password) },
  ];
  const score = checks.filter(c => c.ok).length;
  const barColor = ['var(--ng)', 'var(--warn)', 'var(--ok)'][score - 1] ?? 'var(--line)';

  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex gap-1">
        {[0, 1, 2].map(i => (
          <div key={i} className="h-1 flex-1 rounded-full transition-colors"
            style={{ background: i < score ? barColor : 'var(--line)' }} />
        ))}
      </div>
      <div className="space-y-1">
        {checks.map(c => (
          <div key={c.label} className="flex items-center gap-1.5 text-[11px]"
            style={{ color: c.ok ? 'var(--ok)' : 'var(--muted)' }}>
            <CheckCircle2 className="w-3 h-3 shrink-0" style={{ color: c.ok ? 'var(--ok)' : 'var(--line2)' }} />
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
      <label htmlFor={id} className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--ink)' }}>{label}</label>
      <div className="relative">
        <input
          id={id}
          type={show ? 'text' : 'password'}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full px-3 py-2.5 pr-10 rounded-lg text-sm outline-none transition-shadow"
          style={{ border: '1px solid var(--line2)', background: 'var(--surface)', color: 'var(--ink)' }}
          onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--accent-soft)'; }}
          onBlur={e => { e.currentTarget.style.borderColor = 'var(--line2)'; e.currentTarget.style.boxShadow = 'none'; }}
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setShow(s => !s)}
          className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
          style={{ color: 'var(--muted)' }}
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
      <div className="overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16 }}>
        {/* Cover band */}
        <div className="h-20" style={{ background: 'var(--primary)' }} />

        <div className="px-6 pb-6">
          {/* Avatar */}
          <div className="-mt-10 mb-4 flex items-end justify-between">
            <div className="w-20 h-20 rounded-2xl flex items-center justify-center font-black text-2xl ring-4 ring-white select-none shadow-lg"
              style={{ background: 'var(--accent-soft)', color: 'var(--primary)' }}>
              {initials}
            </div>
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full capitalize pill"
              style={ROLE_STYLE[currentUser.role] ?? { background: 'var(--surface2)', color: 'var(--muted)' }}>
              {currentUser.role}
            </span>
          </div>

          <div>
            <h2 className="text-xl font-semibold" style={{ color: 'var(--ink)' }}>{currentUser.full_name}</h2>
            <p className="text-sm mt-0.5" style={{ color: 'var(--muted)' }}>@{currentUser.username}</p>
          </div>

          {/* Info row */}
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-lg px-4 py-3 flex items-center gap-3" style={{ background: 'var(--surface2)' }}>
              <UserIcon className="w-4 h-4 shrink-0" style={{ color: 'var(--muted)' }} />
              <div>
                <p className="text-[10px] uppercase tracking-wide font-semibold" style={{ color: 'var(--muted)' }}>Username</p>
                <p className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>@{currentUser.username}</p>
              </div>
            </div>
            <div className="rounded-lg px-4 py-3 flex items-center gap-3" style={{ background: 'var(--surface2)' }}>
              <ShieldCheck className="w-4 h-4 shrink-0" style={{ color: 'var(--muted)' }} />
              <div>
                <p className="text-[10px] uppercase tracking-wide font-semibold" style={{ color: 'var(--muted)' }}>Role</p>
                <p className="text-sm font-semibold capitalize" style={{ color: 'var(--ink)' }}>{currentUser.role}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Change password ───────────────────────────────────── */}
      <div className="p-6" style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 16 }}>
        <div className="flex items-center gap-2.5 mb-5">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'var(--accent-soft)' }}>
            <Lock className="w-4 h-4" style={{ color: 'var(--primary)' }} />
          </div>
          <div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Change Password</h3>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>Update your login credentials</p>
          </div>
        </div>

        {result && (
          <div className="flex items-start gap-2.5 p-3.5 rounded-lg mb-5 text-sm"
            style={result.ok
              ? { background: 'var(--ok-bg)', border: '1px solid #b2dcc5', color: 'var(--ok)' }
              : { background: 'var(--ng-bg)', border: '1px solid #f1b8b5', color: 'var(--ng)' }
            }>
            {result.ok
              ? <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--ok)' }} />
              : <AlertCircle  className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'var(--ng)' }} />
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
              <p className="mt-1.5 text-xs flex items-center gap-1" style={{ color: 'var(--ng)' }}>
                <AlertCircle className="w-3 h-3" /> Passwords do not match
              </p>
            )}
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={!canSubmit}
              className="w-full py-2.5 font-semibold text-sm rounded-lg transition-colors disabled:opacity-40"
              style={{ background: 'var(--primary)', color: 'var(--on-primary)' }}
            >
              {isSubmitting ? 'Saving…' : 'Update Password'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
