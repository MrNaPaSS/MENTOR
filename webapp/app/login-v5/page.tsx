"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

/**
 * Разбор макета LoginV5 со скриншота: карточка на чёрном фоне, поля почты и
 * пароля с глазком, кнопка с состоянием загрузки. Страница-демонстрация,
 * с рабочим входом академии (app/login) не связана.
 */
export default function LoginV5() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    // login logic here
    setTimeout(() => setLoading(false), 1500);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-black">
      <div className="w-full max-w-md p-8 rounded-2xl border border-zinc-800 bg-zinc-900/70 backdrop-blur-xl">
        <h1 className="text-3xl font-bold text-white mb-2 text-center">Welcome Back 👋</h1>
        <p className="text-zinc-400 text-center mb-6">Login to your account</p>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="email" className="block text-sm text-zinc-400 mb-2">
              Email
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              className="w-full px-4 py-3 rounded-xl border border-zinc-800 bg-zinc-950/60 text-white placeholder-zinc-600 outline-none transition focus:border-zinc-600 focus:ring-2 focus:ring-zinc-700"
            />
          </div>

          <div>
            <label htmlFor="password" className="block text-sm text-zinc-400 mb-2">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="********"
                autoComplete="current-password"
                className="w-full px-4 py-3 pr-12 rounded-xl border border-zinc-800 bg-zinc-950/60 text-white placeholder-zinc-600 outline-none transition focus:border-zinc-600 focus:ring-2 focus:ring-zinc-700"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                className="absolute inset-y-0 right-0 flex items-center px-4 text-zinc-500 transition hover:text-zinc-300"
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between text-sm">
            <label className="flex items-center gap-2 text-zinc-400">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-zinc-700 bg-zinc-950 accent-white"
              />
              Remember me
            </label>
            <a href="#" className="text-zinc-400 transition hover:text-white">
              Forgot password?
            </a>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl bg-white font-semibold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-zinc-500">
          Don&apos;t have an account?{" "}
          <a href="#" className="text-white transition hover:text-zinc-300">
            Sign up
          </a>
        </p>
      </div>
    </div>
  );
}
