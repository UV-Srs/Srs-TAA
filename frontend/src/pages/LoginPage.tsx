import React, { useState } from 'react';
import { loginUser } from '../api';
import { User } from '../types';
import { LogIn, Key, UserCheck, AlertCircle } from 'lucide-react';

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
    <div className="min-h-screen bg-slate-50 flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-sm bg-white border border-slate-200 rounded-2xl p-7 shadow-sm space-y-6">
        {/* Brand */}
        <div className="text-center space-y-1.5">
          <div className="inline-block bg-slate-900 text-white font-bold text-xs px-2.5 py-1 rounded-md tracking-wider mb-1">
            TAA
          </div>
          <h1 className="text-lg font-bold text-slate-900 tracking-tight">
            Inspection System
          </h1>
          <p className="text-xs text-slate-500">
            Sign in to access your quality checksheet
          </p>
        </div>

        {/* Quick Demo Switcher */}
        <div className="bg-slate-50 p-1.5 rounded-xl border border-slate-200 text-xs flex gap-1">
          <button
            type="button"
            onClick={() => setDemoRole('operator', 'oper123')}
            className={`flex-1 py-1.5 rounded-lg font-medium transition-all ${
              username === 'operator'
                ? 'bg-white text-slate-900 shadow-sm font-semibold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Operator
          </button>
          <button
            type="button"
            onClick={() => setDemoRole('supervisor', 'super123')}
            className={`flex-1 py-1.5 rounded-lg font-medium transition-all ${
              username === 'supervisor'
                ? 'bg-white text-slate-900 shadow-sm font-semibold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Supervisor
          </button>
          <button
            type="button"
            onClick={() => setDemoRole('admin', 'admin123')}
            className={`flex-1 py-1.5 rounded-lg font-medium transition-all ${
              username === 'admin'
                ? 'bg-white text-slate-900 shadow-sm font-semibold'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Admin
          </button>
        </div>

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div className="space-y-1">
            <label className="block font-medium text-slate-700">Username</label>
            <div className="relative">
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all"
                placeholder="Enter username"
              />
              <UserCheck className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
            </div>
          </div>

          <div className="space-y-1">
            <label className="block font-medium text-slate-700">Password</label>
            <div className="relative">
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-transparent transition-all"
                placeholder="Enter password"
              />
              <Key className="w-4 h-4 text-slate-400 absolute right-3 top-2.5" />
            </div>
          </div>

          {errorMsg && (
            <div className="border border-red-200 bg-red-50 text-red-700 p-2.5 rounded-lg flex items-center gap-2 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isLoading}
            className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-semibold rounded-lg flex items-center justify-center gap-2 transition-all shadow-sm disabled:opacity-50 mt-1"
          >
            <LogIn className="w-4 h-4" />
            {isLoading ? 'Signing In...' : 'Sign In'}
          </button>
        </form>

        <div className="pt-2 text-center text-[11px] text-slate-400">
          Factory TFT Touchscreen & USB/Bluetooth Scanner Ready
        </div>
      </div>
    </div>
  );
};
