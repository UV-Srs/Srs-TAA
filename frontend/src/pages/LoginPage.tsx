import React, { useState } from 'react';
import { loginUser } from '../api';
import { User } from '../types';
import { ShieldCheck, LogIn, Key, UserCheck, AlertCircle } from 'lucide-react';

interface LoginPageProps {
  onLoginSuccess: (user: User) => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({ onLoginSuccess }) => {
  const [username, setUsername] = useState<string>('operator');
  const [password, setPassword] = useState<string>('oper123');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsLoading(true);
      setErrorMsg(null);
      const res = await loginUser(username, password);
      onLoginSuccess(res.user);
    } catch (err: any) {
      setErrorMsg(err.message || 'Login failed. Please verify credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  const setDemoRole = (u: string, p: string) => {
    setUsername(u);
    setPassword(p);
    setErrorMsg(null);
  };

  return (
    <div className="min-h-screen bg-white flex flex-col justify-center items-center p-4">
      {/* Container */}
      <div className="w-full max-w-md border-4 border-black p-8 bg-white shadow-2xl">
        {/* Brand header */}
        <div className="border-b-2 border-black pb-5 mb-6 text-center">
          <div className="inline-block bg-black text-white font-extrabold text-2xl px-4 py-1 tracking-tighter mb-2">
            TAA
          </div>
          <h1 className="text-lg font-black text-black uppercase tracking-tight">
            Inspection Management System
          </h1>
          <p className="text-xs font-mono text-zinc-600 mt-1">
            IFM Checksheet & Batch Quality Platform (v2.0)
          </p>
        </div>

        {/* Quick Demo Role Selector */}
        <div className="mb-6 space-y-2">
          <span className="text-[11px] font-bold font-mono uppercase tracking-wider text-black block text-center">
            Shop-Floor Quick Access:
          </span>
          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setDemoRole('operator', 'oper123')}
              className={`p-2 border-2 border-black font-mono text-xs font-bold transition-colors ${
                username === 'operator' ? 'bg-black text-white' : 'bg-white text-black hover:bg-zinc-100'
              }`}
            >
              Operator
            </button>
            <button
              type="button"
              onClick={() => setDemoRole('supervisor', 'super123')}
              className={`p-2 border-2 border-black font-mono text-xs font-bold transition-colors ${
                username === 'supervisor' ? 'bg-black text-white' : 'bg-white text-black hover:bg-zinc-100'
              }`}
            >
              Supervisor
            </button>
            <button
              type="button"
              onClick={() => setDemoRole('admin', 'admin123')}
              className={`p-2 border-2 border-black font-mono text-xs font-bold transition-colors ${
                username === 'admin' ? 'bg-black text-white' : 'bg-white text-black hover:bg-zinc-100'
              }`}
            >
              Admin
            </button>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-mono font-bold uppercase tracking-wider text-black mb-1">
              Username / Operator ID:
            </label>
            <div className="relative">
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full border-2 border-black px-3 py-2 text-xs font-mono font-bold focus:outline-none focus:ring-2 focus:ring-black bg-zinc-50"
                placeholder="Enter username..."
              />
              <UserCheck className="w-4 h-4 text-black absolute right-3 top-2.5 opacity-60" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-mono font-bold uppercase tracking-wider text-black mb-1">
              Password:
            </label>
            <div className="relative">
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border-2 border-black px-3 py-2 text-xs font-mono font-bold focus:outline-none focus:ring-2 focus:ring-black bg-zinc-50"
                placeholder="Enter password..."
              />
              <Key className="w-4 h-4 text-black absolute right-3 top-2.5 opacity-60" />
            </div>
          </div>

          {errorMsg && (
            <div className="border border-black bg-black text-white p-2.5 flex items-center gap-2 text-xs font-mono">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-3 bg-black hover:bg-zinc-800 text-white font-extrabold text-xs uppercase tracking-wider flex items-center justify-center gap-2 border-2 border-black transition-colors disabled:opacity-50 mt-2"
          >
            <LogIn className="w-4 h-4" />
            {isLoading ? 'Authenticating...' : 'Sign In to Inspection Terminal'}
          </button>
        </form>

        {/* High-Contrast Design Note */}
        <div className="mt-8 pt-4 border-t-2 border-zinc-200 text-center text-[10px] font-mono text-zinc-500">
          Industrial White & Black High-Contrast Theme (Ratio &gt; 15:1) • Wired/Wireless TFT Scanner Ready
        </div>
      </div>
    </div>
  );
};
