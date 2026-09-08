"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  Globe,
  Tv,
  Trophy,
  User,
  LogOut,
  ChevronDown,
  Calculator,
  ImageIcon,
  Coins,
  ShoppingBag,
  Waves,
} from "lucide-react";
import Logo from "@/components/ui/Logo";
import Ambient from "@/components/ui/Ambient";
import RadioChip from "@/components/app/RadioChip";
import { api, Profile } from "@/lib/api";
import { getAccessToken, logout } from "@/lib/auth";
import { useCoins } from "@/lib/useCoins";
import { fmtUsd, modeLabel } from "@/lib/format";
import MarketTicker from "@/components/market/MarketTicker";
import Toasts from "@/components/scalping/Toasts";
import {
  dismissSymbol,
  dismissToast,
  serverSnapshot as serverToasts,
  snapshot as snapshotToasts,
  subscribe as subscribeToasts,
  watchTrades,
} from "@/lib/tradeAlerts";
import { useTerminalTheme } from "@/lib/terminalTheme";

const NAV = [
  // Терминал первым: это рабочий стол трейдера, с него начинается день,
  // и с него же открывается кабинет.
  // Дальше рынок и анализы, остальное — как было.
  { href: "/app/scalping", label: "Терминал", icon: Waves, mobile: false },
  { href: "/app/market", label: "Рынок", icon: Globe, mobile: true },
  { href: "/app/analysis", label: "Анализы", icon: ImageIcon, mobile: true },
  { href: "/app/news", label: "ТВ", icon: Tv, mobile: false },
  { href: "/app/analytics", label: "Аналитика", icon: BarChart3, mobile: false },
  { href: "/app/shop", label: "Маркет", icon: ShoppingBag, mobile: true },
  { href: "/app/calculator", label: "Калькулятор", icon: Calculator, mobile: false },
  { href: "/app/profile", label: "Профиль", icon: User, mobile: true },
];

const MODE_COLORS: Record<string, string> = {
  moderate: "text-accent-cyan border-accent-cyan/40 bg-accent-cyan/10",
  turbo: "text-accent-gold border-accent-gold/40 bg-accent-gold/10",
  vip: "text-purple-400 border-purple-400/40 bg-purple-400/10",
};

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  // Баланс монет обновляется сам: их начисляет ещё и академия — снаружи вкладки.
  const { coins } = useCoins(pathname);
  // Тема терминала красит весь сайт: подписка нужна, чтобы оболочка сменила
  // цвета в тот же момент, что и панели, а не после перезагрузки.
  useTerminalTheme();

  // Сделка идёт на бирже, а не на экране: лимитка исполняется и позиция
  // закрывается, пока трейдер смотрит анализы или выбирает награду в маркете.
  // Наблюдение живёт в оболочке, поэтому событие догонит его в любом разделе.
  //
  // Пока открыт терминал, наблюдение молчит: там оно своё и знает больше.
  const toasts = useSyncExternalStore(subscribeToasts, snapshotToasts, serverToasts);
  useEffect(() => watchTrades(), []);

  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    setReady(true);
    api.profile(token)
      .then(setProfile)
      .catch((err) => {
        console.error("Auth error, redirecting to login:", err);
        logout();
        router.replace("/login");
      });
  }, [router]);

  function doLogout() {
    logout();
    router.push("/");
  }

  if (!ready) {
    return (
      <div className="grid min-h-screen place-items-center bg-bg-deep">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-accent-cyan/20 border-t-accent-cyan" />
          <p className="text-sm text-text-muted">Загрузка платформы…</p>
        </div>
      </div>
    );
  }

  const isActive = (href: string) => pathname === href || pathname.startsWith(href + "/");

  const balance = parseFloat(profile?.balance_usdt || "0");
  const mode = profile?.mode || "moderate";

  return (
    <div className="min-h-screen bg-bg-deep">
      <Ambient />

      {/* ─── Верхний header ─── */}
      <header className="fixed inset-x-0 top-0 z-50 border-b border-border bg-bg-deep/80 backdrop-blur-2xl">
        {/* Бегущая строка тикер */}
        <MarketTicker />

        <div className="flex h-14 items-center justify-between px-4 md:px-6">
          {/* Лого и радио: музыку включают на весь рабочий день, и место ей
              рядом со знаком, а не среди кнопок сделки. */}
          <div className="flex items-center gap-2">
            <Logo />
            <RadioChip />
          </div>

          {/* Навигация - десктоп */}
          <nav className="hidden items-center gap-0.5 lg:flex">
            {NAV.map((n) => {
              const Icon = n.icon;
              const active = isActive(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`relative flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-all duration-150 ${
                    active
                      ? "text-accent-cyan"
                      : "text-text-muted hover:text-text-primary"
                  }`}
                >
                  {active && (
                    <span className="absolute inset-0 rounded-lg bg-accent-cyan/[0.08]" />
                  )}
                  <Icon className="relative h-4 w-4" />
                  <span className="relative">{n.label}</span>
                  {active && (
                    <span className="absolute bottom-0 inset-x-3 h-px bg-accent-cyan" />
                  )}
                </Link>
              );
            })}
          </nav>

          {/* Правая часть - баланс + профиль */}
          <div className="flex items-center gap-3">
            {/* Монеты NMNH */}
            {coins !== null && (
              // Монеты ведут в аналитику, а не в маркет: там видно, за что они
              // начислены и что осталось сделать до следующей награды. Маркет
              // отвечает на вопрос «на что потратить», а нажимают на счётчик,
              // чтобы понять, откуда он взялся.
              <Link
                href="/app/analytics"
                className="coin-chip hidden items-center gap-1.5 rounded-xl border px-3 py-1.5 sm:flex"
                title="NMNH монеты - за что начислены"
              >
                <Coins className="h-3.5 w-3.5" />
                <span className="font-mono text-sm font-bold tabular">
                  {coins.toLocaleString("ru")}
                </span>
                <span className="text-[9px] font-bold opacity-60">NMNH</span>
              </Link>
            )}

            {/* Баланс */}
            {profile && (
              <Link
                href="/app/profile"
                className="hidden items-center rounded-xl border border-border bg-bg-panel/60 px-3 py-1.5 transition hover:border-accent-cyan/40 sm:flex"
              >
                <span className="font-mono text-sm font-bold text-text-primary tabular">
                  ${balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </Link>
            )}

            {/* Выйти */}
            <button
              onClick={doLogout}
              title="Выйти"
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-border text-text-muted transition hover:border-danger/40 hover:text-danger"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Уведомления о сделках. В терминале их показывает он сам - над графиком,
          там, куда смотрят; здесь они висят под шапкой, поверх раздела.
          Список общий, поэтому показать его дважды нельзя: он бы задвоился. */}
      {!isActive("/app/scalping") && (
        <Toasts items={toasts} onClose={dismissToast} onPick={dismissSymbol} place="shell" />
      )}

      {/* ─── Контент (отступ под header + ticker = 14px + 38px ≈ 96px) ─── */}
      <main className="px-4 pb-24 pt-[96px] md:px-6 lg:pb-8">
        {children}
      </main>

      {/* ─── Нижняя мобильная навигация ─── */}
      <nav className="fixed inset-x-0 bottom-0 z-50 border-t border-border bg-bg-deep/90 backdrop-blur-2xl lg:hidden">
        <div className="flex items-stretch justify-around">
          {NAV.filter((n) => n.mobile).map((n) => {
            const Icon = n.icon;
            const active = isActive(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`relative flex flex-1 flex-col items-center gap-1 px-1 py-3 text-[10px] font-medium transition-all ${
                  active ? "text-accent-cyan" : "text-text-muted"
                }`}
              >
                {active && (
                  <span className="absolute left-1/2 top-0 h-px w-8 -translate-x-1/2 bg-accent-cyan shadow-[0_0_8px_rgba(10,255,224,0.8)]" />
                )}
                <Icon className="h-5 w-5" />
                {n.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
