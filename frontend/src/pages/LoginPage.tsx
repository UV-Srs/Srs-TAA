import React, { useState } from 'react';
import { loginUser } from '../api';
import { User } from '../types';
import { LogIn, Key, UserCheck, AlertCircle } from 'lucide-react';

interface LoginPageProps {
  onLoginSuccess: (user: User) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setErrorMsg('Please enter both your username and password.');
      return;
    }

    try {
      setIsLoading(true);
      setErrorMsg(null);
      const res = await loginUser(username.trim(), password);
      onLoginSuccess(res.user);
    } catch (err: any) {
      setErrorMsg(err.message || 'Login failed. Please check your username and password.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen flex flex-col justify-center items-center p-4 select-none"
      style={{ background: 'var(--bg)' }}
    >
      <div
        className="w-full max-w-[400px] p-10 space-y-6"
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--line)',
          borderRadius: 16,
          boxShadow: 'var(--shadow)',
        }}
      >
        {/* Brand */}
        <div className="text-center space-y-3">
          <div
            className="w-11 h-11 text-white font-black text-base flex items-center justify-center mx-auto tracking-tight select-none"
            style={{ background: 'var(--primary)', borderRadius: 12 }}
          >
            TAA
          </div>
          <div>
            <h1 className="text-[22px] font-semibold leading-tight" style={{ color: 'var(--ink)' }}>
              TAA Inspection System
            </h1>
            <p className="text-[14px] mt-1" style={{ color: 'var(--muted)' }}>
              Sign in with your role account
            </p>
          </div>
        </div>

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-4 text-[14px]">
          <div className="space-y-1.5">
            <label className="block font-medium" style={{ color: 'var(--ink)' }}>Username</label>
            <div className="relative">
              <input
                type="text"
                required
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3.5 py-2.5 text-[14px] outline-none transition-all placeholder:text-[#9ba8b7]"
                style={{
                  border: '1px solid var(--line2)',
                  borderRadius: 12,
                  color: 'var(--ink)',
                  background: 'var(--surface)',
                }}
                onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--accent-soft)'; }}
                onBlur={e => { e.currentTarget.style.borderColor = 'var(--line2)'; e.currentTarget.style.boxShadow = 'none'; }}
                placeholder="e.g. operator, supervisor, admin"
              />
              <UserCheck className="w-4 h-4 absolute right-3 top-3 pointer-events-none" style={{ color: 'var(--muted)' }} />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block font-medium" style={{ color: 'var(--ink)' }}>Password</label>
            <div className="relative">
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3.5 py-2.5 text-[14px] outline-none transition-all placeholder:text-[#9ba8b7]"
                style={{
                  border: '1px solid var(--line2)',
                  borderRadius: 12,
                  color: 'var(--ink)',
                  background: 'var(--surface)',
                }}
                onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.boxShadow = '0 0 0 3px var(--accent-soft)'; }}
                onBlur={e => { e.currentTarget.style.borderColor = 'var(--line2)'; e.currentTarget.style.boxShadow = 'none'; }}
                placeholder="Enter your password"
              />
              <Key className="w-4 h-4 absolute right-3 top-3 pointer-events-none" style={{ color: 'var(--muted)' }} />
            </div>
          </div>

          {errorMsg && (
            <div
              className="p-3 rounded-xl flex items-center gap-2 text-[13px] leading-snug"
              style={{ background: 'var(--ng-bg)', border: '1px solid #f1b8b5', color: 'var(--ng)' }}
            >
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || !username || !password}
            className="w-full py-3 text-[15px] font-semibold flex items-center justify-center gap-2 transition-all disabled:opacity-40 cursor-pointer mt-2"
            style={{
              background: 'var(--primary)',
              color: 'var(--on-primary)',
              borderRadius: 12,
              minHeight: 44,
            }}
          >
            <LogIn className="w-4 h-4" />
            <span>{isLoading ? 'Signing In...' : 'Sign In'}</span>
          </button>
        </form>

        <div
          className="pt-3 text-center text-[12px]"
          style={{ color: 'var(--muted)', borderTop: '1px solid var(--line)' }}
        >
          Powered by SRS Consulting
        </div>
      </div>
    </div>
  );
};
