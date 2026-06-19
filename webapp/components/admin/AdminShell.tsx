"use client";

import { useEffect, useState, createContext, useContext } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  PlusCircle,
  ListOrdered,
  Users,
  LogOut,
  ShieldCheck,
  Radio,
  Images,
  BarChart2,
  ShoppingBag,
} from "lucide-react";
import Logo from "@/components/ui/Logo";
import Ambient from "@/components/ui/Ambient";
import { api } from "@/lib/api";
import { getMentorToken, setMentorToken, logoutMentor } from "@/lib/auth";

const NAV = [
  { href: "/admin", label: "Дашборд", icon: LayoutDashboard },
  { href: "/admin/broadcast", label: "Отправить анализ", icon: Radio },
  { href: "/admin/analyses", label: "Анализы на сайте", icon: BarChart2 },
  { href: "/admin/pnl", label: "PnL скриншоты", icon: Images },
  { href: "/admin/signal/new", label: "Новый сигнал", icon: PlusCircle },
  { href: "/admin/signals", label: "Сигналы", icon: ListOrdered },
  { href: "/admin/shop", label: "Маркет", icon: ShoppingBag },
  { href: "/admin/students", label: "Ученики", icon: Users },
];

const TokenCtx = createContext<string>("");
export const useMentorToken = () => useContext(TokenCtx);

export default function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setToken(getMentorToken());
    setReady(true);
  }, []);

  if (!ready) return <div className="grid min-h-screen place-items-center text-text-muted">…</div>;
  if (!token) return <MentorLogin onLogin={setToken} />;

  const isActive = (href: string) =>
    href === "/admin" ? pathname === "/admin" : pathname.startsWith(href);

  return (
    <TokenCtx.Provider value={token}>
      <div className="flex min-h-screen">
        <Ambient />
        {/* Сайдбар */}
        <aside className="glass fixed inset-y-0 left-0 z-40 hidden w-60 flex-col border-r border-white/10 p-4 lg:flex">
          <div className="flex items-center gap-2">
            <Logo />
            <span className="badge-gold">ADMIN</span>
          </div>
          <nav className="mt-8 flex flex-1 flex-col gap-1">
            {NAV.map((n) => {
              const Icon = n.icon;
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
                    isActive(n.href) ? "bg-accent-cyan/12 text-accent-cyan" : "text-text-secondary hover:text-white"
                  }`}
                >
                  <Icon className="h-4 w-4" /> {n.label}
                </Link>
              );
            })}
          </nav>
          <button
            onClick={() => {
              logoutMentor();
              setToken(null);
            }}
            className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm text-text-secondary transition hover:text-danger"
          >
            <LogOut className="h-4 w-4" /> Выйти
          </button>
        </aside>

        {/* Моб. верхняя панель */}
        <div className="glass fixed inset-x-0 top-0 z-40 flex items-center gap-2 border-b border-white/10 px-4 py-3 lg:hidden">
          <Logo />
          <span className="badge-gold">ADMIN</span>
          <div className="ml-auto flex gap-1 overflow-x-auto">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={`whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-semibold ${
                  isActive(n.href) ? "bg-accent-cyan/15 text-accent-cyan" : "text-text-muted"
                }`}
              >
                {n.label}
              </Link>
            ))}
          </div>
        </div>

        <main className="flex-1 px-4 pb-12 pt-20 md:px-8 lg:ml-60 lg:pt-10">{children}</main>
      </div>
    </TokenCtx.Provider>
  );
}

function MentorLogin({ onLogin }: { onLogin: (t: string) => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function login() {
    setLoading(true);
    setError(null);
    try {
      const res = await api.mentorLogin(password);
      setMentorToken(res.access_token);
      onLogin(res.access_token);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Неверный пароль");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <div className="card glass">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-accent-gold" />
          <h1 className="text-xl font-bold text-white">NMNH <span className="text-accent-gold">ADMIN</span></h1>
        </div>
        <input
          type="password"
          className="input mt-5"
          placeholder="Пароль ментора"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && login()}
        />
        <button className="btn-primary mt-3 w-full" onClick={login} disabled={!password || loading}>
          {loading ? "Вход…" : "Войти"}
        </button>
        {error && <p className="mt-3 text-sm text-danger">⚠️ {error}</p>}
      </div>
    </main>
  );
}
