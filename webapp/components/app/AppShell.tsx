"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
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
import { PROFILE_EVENT } from "@/lib/profileEvent";
import { fmtUsd, modeLabel } from "@/lib/format";
import { adoptLocale, useIntlLocale, useT } from "@/lib/i18n";
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

// Названия разделов живут в словаре: здесь только порядок, адрес и картинка.
const NAV = [
  // Терминал первым: это рабочий стол трейдера, с него начинается день,
  // и с него же открывается кабинет.
  // Дальше рынок и анализы, остальное — как было.
  { href: "/app/scalping", key: "scalping", icon: Waves, mobile: false },
  { href: "/app/market", key: "market", icon: Globe, mobile: true },
  { href: "/app/analysis", key: "analysis", icon: ImageIcon, mobile: true },
  { href: "/app/news", key: "news", icon: Tv, mobile: false },
  { href: "/app/analytics", key: "analytics", icon: BarChart3, mobile: false },
  { href: "/app/shop", key: "shop", icon: ShoppingBag, mobile: true },
  { href: "/app/profile", key: "profile", icon: User, mobile: true },
] as const;

const MODE_COLORS: Record<string, string> = {
  moderate: "text-accent-cyan border-accent-cyan/40 bg-accent-cyan/10",
  turbo: "text-accent-gold border-accent-gold/40 bg-accent-gold/10",
  vip: "text-purple-400 border-purple-400/40 bg-purple-400/10",
};

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const t = useT();
  const numbers = useIntlLocale();
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

  // Профиль перечитывается не только при входе.
  //
  // Баланс в шапке приезжает отсюда, а новый ученик подключает ключи WEEX уже
  // внутри кабинета: счёт после этого перестаёт быть нулём, а шапка об этом не
  // знала и показывала ноль до перезагрузки страницы. Теперь она слушает
  // событие изнутри вкладки, переходы между разделами и возврат на вкладку -
  // тем же способом, каким живёт баланс монет.
  const reloadProfile = useCallback(
    (first: boolean) => {
      const token = getAccessToken();
      if (!token) {
        if (first) router.replace("/login");
        return;
      }
      api
        .profile(token)
        .then((p) => {
          setProfile(p);
          // Язык человек выбирает один раз, а заходит с разных устройств:
          // выбор приезжает вместе с профилем и включается сразу.
          adoptLocale(p.language);
        })
        .catch((err) => {
          // Выкидываем из кабинета только на первой загрузке. Дальше отказ -
          // это чаще всего моргнувшая сеть, и выбрасывать за неё человека,
          // который сидит в терминале, нельзя.
          if (!first) return;
          console.error("Auth error, redirecting to login:", err);
          logout();
          router.replace("/login");
        });
    },
    [router],
  );

  useEffect(() => {
    if (!getAccessToken()) {
      router.replace("/login");
      return;
    }
    setReady(true);
    reloadProfile(true);
  }, [router, reloadProfile]);

  // Переходы между разделами: ключи подключают в профиле, а цифру видят из
  // любого раздела.
  useEffect(() => {
    if (!ready) return;
    reloadProfile(false);
  }, [pathname, ready, reloadProfile]);

  useEffect(() => {
    const again = () => reloadProfile(false);
    const onVisible = () => {
      if (document.visibilityState === "visible") again();
    };
    window.addEventListener(PROFILE_EVENT, again);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(PROFILE_EVENT, again);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [reloadProfile]);

  function doLogout() {
    logout();
    router.push("/");
  }

  if (!ready) {
    return (
      <div className="grid min-h-screen place-items-center bg-bg-deep">
        <div className="flex flex-col items-center gap-4">
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-accent-cyan/20 border-t-accent-cyan" />
          <p className="text-sm text-text-muted">{t.common.loadingPlatform}</p>
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
      {/*
        Лента вынесена из-под размытия намеренно.
        Она была внутри шапки, а у той `backdrop-blur-2xl`: браузер пересобирал
        размытие фона на каждом кадре её движения - по всей ширине экрана,
        шестьдесят раз в секунду. Отсюда и рывки, и нагрев на пустом месте.
        Теперь размыт только ряд навигации, а лента едет над своим непрозрачным
        фоном и ничего за собой не тянет.
      */}
      <div className="fixed inset-x-0 top-0 z-50">
        <MarketTicker />

        <header className="border-b border-border bg-bg-deep/80 backdrop-blur-2xl">
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
                  <span className="relative">{t.shell.nav[n.key]}</span>
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
                title={t.shell.coinsTitle}
              >
                <Coins className="h-3.5 w-3.5" />
                <span className="font-mono text-sm font-bold tabular">
                  {coins.toLocaleString(numbers)}
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
              title={t.shell.logout}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-border text-text-muted transition hover:border-danger/40 hover:text-danger"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
        </header>
      </div>

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
                {t.shell.nav[n.key]}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
