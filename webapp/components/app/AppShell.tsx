"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard,
  Radio,
  BarChart3,
  Trophy,
  MessageCircle,
  User,
  LogOut,
} from "lucide-react";
import Logo from "@/components/ui/Logo";
import Ambient from "@/components/ui/Ambient";
import { api, Profile } from "@/lib/api";
import { getAccessToken, logout } from "@/lib/auth";
import { fmtUsd, modeLabel } from "@/lib/format";

const NAV = [
  { href: "/app/dashboard", label: "Дашборд", icon: LayoutDashboard, mobile: true },
  { href: "/app/signals", label: "Сигналы", icon: Radio, mobile: true },
  { href: "/app/analytics", label: "Аналитика", icon: BarChart3, mobile: true },
  { href: "/app/leaderboard", label: "Лидерборд", icon: Trophy, mobile: false },
  { href: "/app/chat", label: "Чат", icon: MessageCircle, mobile: true },
  { href: "/app/profile", label: "Профиль", icon: User, mobile: true },
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    setReady(true);
    api.profile(token).then(setProfile).catch(() => {});
  }, [router]);

  function doLogout() {
    logout();
    router.push("/");
  }

  if (!ready) {
    return (
      <div className="grid min-h-screen place-items-center text-text-muted">Загрузка…</div>
    );
  }

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  return (
    <div className="min-h-screen">
      <Ambient />
      {/* Топ-навигация */}
      <header className="glass fixed inset-x-0 top-0 z-50 border-b border-white/10 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 md:px-6">
          <Logo />
          <nav className="hidden items-center gap-1 lg:flex">
            {NAV.map((n) => {
              const Icon = n.icon;
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition ${
                    isActive(n.href)
                      ? "bg-accent-cyan/12 text-accent-cyan"
                      : "text-text-secondary hover:text-white"
                  }`}
                >
                  <Icon className="h-4 w-4" /> {n.label}
                </Link>
              );
            })}
          </nav>
          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <div className="font-mono text-sm font-bold text-white tabular">
                {fmtUsd(profile?.balance_usdt)} <span className="text-text-muted">USDT</span>
              </div>
              <div className="text-[10px] text-text-muted">{modeLabel(profile?.mode || "moderate")}</div>
            </div>
            <button
              onClick={doLogout}
              className="grid h-9 w-9 place-items-center rounded-lg text-text-secondary ring-1 ring-border transition hover:text-danger hover:ring-danger/40"
              aria-label="Выйти"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Контент */}
      <main className="mx-auto max-w-6xl px-4 pb-28 pt-20 md:px-6 md:pb-12">{children}</main>

      {/* Нижняя навигация (мобайл) */}
      <nav className="glass fixed inset-x-0 bottom-0 z-50 border-t border-white/10 lg:hidden">
        <div className="mx-auto flex max-w-md items-stretch justify-around px-2">
          {NAV.filter((n) => n.mobile).map((n) => {
            const Icon = n.icon;
            const active = isActive(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition ${
                  active ? "text-accent-cyan" : "text-text-muted"
                }`}
              >
                <Icon className="h-5 w-5" />
                {n.label}
                <span className={`mt-0.5 h-0.5 w-5 rounded-full ${active ? "bg-accent-cyan" : "bg-transparent"}`} />
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
