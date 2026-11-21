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
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-4 select-none">
      <div className="w-full max-w-sm bg-white border border-slate-200 rounded-2xl p-8 shadow-sm space-y-6">
        {/* Brand */}
        <div className="text-center space-y-2">
          <div className="w-12 h-12 bg-black text-white font-black text-base rounded-xl flex items-center justify-center mx-auto tracking-tight shadow-sm">
            TAA
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-900 tracking-tight">
              Inspection System
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Sign in with your role account
            </p>
          </div>
        </div>

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div className="space-y-1.5">
            <label className="block font-semibold text-slate-700">Username</label>
            <div className="relative">
              <input
                type="text"
                required
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3.5 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent transition-all placeholder-slate-400 font-medium"
                placeholder="e.g. operator, supervisor, admin"
              />
              <UserCheck className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block font-semibold text-slate-700">Password</label>
            <div className="relative">
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border border-slate-300 rounded-xl px-3.5 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-black focus:border-transparent transition-all placeholder-slate-400"
                placeholder="Enter your password"
              />
              <Key className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
            </div>
          </div>

          {errorMsg && (
            <div className="border border-red-200 bg-red-50 text-red-700 p-3 rounded-xl flex items-center gap-2 text-xs leading-snug">
              <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{errorMsg}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading || !username || !password}
            className="w-full py-2.5 bg-black hover:bg-slate-800 text-white font-bold rounded-xl flex items-center justify-center gap-2 transition-all shadow-sm disabled:opacity-40 cursor-pointer mt-2"
          >
            <LogIn className="w-4 h-4" />
            <span>{isLoading ? 'Signing In...' : 'Sign In'}</span>
          </button>
        </form>

        {/* Demo Credentials Box */}
        <div className="pt-4 border-t border-slate-100 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
              Demo Credentials
            </span>
            <span className="text-[10px] text-slate-400">Click to fill</span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => { setUsername('operator'); setPassword('oper123'); }}
              className="p-2 bg-slate-50 hover:bg-slate-100 border border-slate-200/80 rounded-xl text-left transition-all group cursor-pointer"
            >
              <div className="text-[11px] font-bold text-slate-800 group-hover:text-black">Operator</div>
              <div className="text-[10px] text-slate-500 font-mono mt-0.5 truncate">operator</div>
              <div className="text-[10px] text-slate-400 font-mono">oper123</div>
            </button>
            <button
              type="button"
              onClick={() => { setUsername('supervisor'); setPassword('super123'); }}
              className="p-2 bg-slate-50 hover:bg-slate-100 border border-slate-200/80 rounded-xl text-left transition-all group cursor-pointer"
            >
              <div className="text-[11px] font-bold text-slate-800 group-hover:text-black">Supervisor</div>
              <div className="text-[10px] text-slate-500 font-mono mt-0.5 truncate">supervisor</div>
              <div className="text-[10px] text-slate-400 font-mono">super123</div>
            </button>
            <button
              type="button"
              onClick={() => { setUsername('admin'); setPassword('admin123'); }}
              className="p-2 bg-slate-50 hover:bg-slate-100 border border-slate-200/80 rounded-xl text-left transition-all group cursor-pointer"
            >
              <div className="text-[11px] font-bold text-slate-800 group-hover:text-black">Admin</div>
              <div className="text-[10px] text-slate-500 font-mono mt-0.5 truncate">admin</div>
              <div className="text-[10px] text-slate-400 font-mono">admin123</div>
            </button>
          </div>
        </div>

        <div className="pt-1 text-center text-[11px] text-slate-400 border-t border-slate-100">
          Industrial Quality & Batch Inspection Management
        </div>
      </div>
    </div>
  );
};
