"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BarChart3,
  Globe,
  Trophy,
  User,
  LogOut,
  ChevronDown,
  ImageIcon,
  ShoppingBag,
  Waves,
} from "lucide-react";
import Logo from "@/components/ui/Logo";
import Ambient from "@/components/ui/Ambient";
import RadioChip from "@/components/app/RadioChip";
import CommandPalette from "@/components/app/CommandPalette";
import { api, Profile } from "@/lib/api";
import { getAccessToken, logout } from "@/lib/auth";
import { attend } from "@/lib/chat/store";
import { useCoins } from "@/lib/useCoins";
import { useRewardNotices } from "@/lib/rewards";
import RewardsChip from "@/components/app/RewardsChip";
import CertificateHost from "@/components/cert/CertificateHost";
import { PROFILE_EVENT } from "@/lib/profileEvent";
import { fmtUsd, modeLabel } from "@/lib/format";
import { adoptLocale, useT } from "@/lib/i18n";
import MarketTicker from "@/components/market/MarketTicker";
import HeadArt from "@/components/app/HeadArt";
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
import { tradingStatus, type TradingStatus } from "@/lib/trading";
import ExchangeDialog from "@/components/scalping/ExchangeDialog";
import ThemeSwitch from "@/components/ui/ThemeSwitch";

// Названия разделов живут в словаре: здесь только порядок, адрес и картинка.
const NAV = [
  // Терминал первым: это рабочий стол трейдера, с него начинается день,
  // и с него же открывается кабинет.
  // Дальше рынок и анализы, остальное — как было.
  //
  // top - в верхней панели, mobile - в нижнем меню телефона. «Анализы» из
  // верхней панели убраны (11.09.2026), но раздел живёт: на телефоне терминала
  // нет, и вход с телефона ведёт именно туда.
  { href: "/app/scalping", key: "scalping", icon: Waves, top: true, mobile: false },
  { href: "/app/market", key: "market", icon: Globe, top: true, mobile: true },
  { href: "/app/analysis", key: "analysis", icon: ImageIcon, top: false, mobile: true },
  { href: "/app/analytics", key: "analytics", icon: BarChart3, top: true, mobile: false },
  { href: "/app/shop", key: "shop", icon: ShoppingBag, top: true, mobile: true },
  { href: "/app/profile", key: "profile", icon: User, top: true, mobile: true },
] as const;

// Кнопка справа от монет: в ней либо баланс биржи, либо приглашение
// подключить счёт. Класс общий на оба случая - это одно и то же место, и
// разъехавшись, они выглядели бы двумя разными кнопками.
const BALANCE_CHIP =
  "hidden items-center rounded-xl border border-border bg-bg-panel/60 px-3 py-1.5 transition hover:border-accent-cyan/40 sm:flex";

const MODE_COLORS: Record<string, string> = {
  moderate: "text-accent-cyan border-accent-cyan/40 bg-accent-cyan/10",
  turbo: "text-accent-gold border-accent-gold/40 bg-accent-gold/10",
  vip: "text-purple-400 border-purple-400/40 bg-purple-400/10",
};

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const t = useT();
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  // Подключён ли биржевой счёт. Пусто - сервер об этом не сказал: тогда шапка
  // ведёт себя как раньше и лишнего не обещает.
  const [trading, setTrading] = useState<TradingStatus | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  // Баланс монет обновляется сам: их начисляет ещё и академия — снаружи вкладки.
  // Шапка ещё и спрашивает сервер раз в двадцать секунд: награда за сделку
  // приходит, пока трейдер сидит в терминале, и о ней надо сказать сразу.
  const { coins, pending, pendingTotal, pendingCount } = useCoins(pathname, { poll: 20_000 });
  useRewardNotices(pending, coins !== null);
  // Тема терминала красит весь сайт: подписка нужна, чтобы оболочка сменила
  // цвета в тот же момент, что и панели, а не после перезагрузки.
  const terminalTheme = useTerminalTheme();

  // Сделка идёт на бирже, а не на экране: лимитка исполняется и позиция
  // закрывается, пока трейдер смотрит анализы или выбирает награду в маркете.
  // Наблюдение живёт в оболочке, поэтому событие догонит его в любом разделе.
  //
  // Пока открыт терминал, наблюдение молчит: там оно своё и знает больше.
  const toasts = useSyncExternalStore(subscribeToasts, snapshotToasts, serverToasts);
  useEffect(() => watchTrades(), []);

  // Присутствие в чате держит вся оболочка, а не одна панель терминала.
  // «В сети» - это про человека на сайте: ушедший в анализы или в маркет
  // никуда не делся, а из комнаты пропадал. Ленту при этом не тянем - только
  // соединение.
  useEffect(() => {
    if (!ready) return;
    return attend();
  }, [ready]);

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

  /**
   * Подключён ли счёт биржи.
   *
   * Спрашиваем один раз на вход и после каждого подключения. Без этого место
   * баланса в шапке показывало новому ученику честный ноль - и он читался как
   * «денег нет», хотя на бирже они есть, а платформа про них просто не знает.
   */
  const reloadTrading = useCallback(() => {
    if (!getAccessToken()) return;
    tradingStatus()
      .then(setTrading)
      .catch(() => setTrading(null));
  }, []);

  useEffect(() => {
    if (!ready) return;
    reloadTrading();
  }, [ready, reloadTrading]);

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
  // Ключей нет - и это точно известно: хранилище на сервере настроено, а счёт
  // не подключён. Сервер промолчал - ничего не обещаем и показываем баланс.
  const needsKeys = Boolean(trading?.enabled) && trading?.connected === false;

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

        <header className="relative border-b border-border bg-bg-deep/80 backdrop-blur-2xl">
        <HeadArt pathname={pathname} />
        <div className="relative z-10 flex h-14 items-center justify-between px-4 md:px-6">
          {/* Лого и радио: музыку включают на весь рабочий день, и место ей
              рядом со знаком, а не среди кнопок сделки. */}
          <div className="flex items-center gap-2">
            {/* Знак ведёт в терминал, а не на витрину.
                Здесь человек уже вошёл, и лендинг ему рассказывать нечего:
                нажатие по знаку - это «домой», а дом трейдера - рабочий стол. */}
            <Logo href="/app/scalping" />
            <RadioChip />
          </div>

          {/* Навигация - десктоп */}
          <nav className="hidden items-center gap-0.5 lg:flex">
            {NAV.filter((n) => n.top).map((n) => {
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
            {/* Тема - слева от монет. В терминале её не показываем: там своё
                рабочее место со своими настройками, и вторая кнопка рядом с
                графиком только мешает. */}
            {!pathname.startsWith("/app/scalping") && <ThemeSwitch className="hidden md:flex" />}
            {/* Монеты NMNH и награды, ждущие получения. Нажатие открывает
                окно наград; из него же - история в аналитике и маркет. */}
            {coins !== null && (
              <RewardsChip
                coins={coins}
                pending={pending}
                pendingTotal={pendingTotal}
                pendingCount={pendingCount}
              />
            )}

            {/* Баланс биржи. Пока ключей нет, в этой же кнопке стоит
                «Подключиться».
                Не второй кнопкой рядом: место у баланса одно, и новый ученик
                смотрит именно сюда - «сколько у меня». Ноль здесь означал бы
                «денег нет», хотя они есть: платформа про них ещё не знает.
                Нажатие открывает то же окно ключей, что и в терминале. */}
            {profile && (
              needsKeys ? (
                <button
                  onClick={() => setConnectOpen(true)}
                  title={t.shell.connectApiTitle}
                  className={`${BALANCE_CHIP} text-sm font-semibold text-accent-cyan`}
                >
                  {t.shell.connectApi}
                </button>
              ) : (
                <Link href="/app/profile" className={BALANCE_CHIP}>
                  <span className="font-mono text-sm font-bold text-text-primary tabular">
                    ${balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                </Link>
              )
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

      {/* Окно подключения счёта - то же самое, что в терминале.
          Второго такого окна заводить нельзя: ключи - место, где ошибка стоит
          дорого, и две разные формы для одного действия однажды разойдутся.
          Оболочка кабинета цветов панелей не знает, поэтому окно живёт внутри
          панели - и панель берёт тему терминала. Прибитое к тёмной, оно
          открывалось чёрным поверх белого терминала: окно из другого
          приложения посреди своего. */}
      {connectOpen && (
        <div className={terminalTheme === "light" ? "pane-light" : "pane-dark"}>
          <ExchangeDialog
            status={
              trading ?? { enabled: false, connected: false, key_tail: "", updated_at: null }
            }
            reachable={trading !== null}
            onClose={() => setConnectOpen(false)}
            onSaved={() => {
              reloadTrading();
              reloadProfile(false);
              setConnectOpen(false);
            }}
          />
        </div>
      )}

      {/* Уведомления о сделках. В терминале их показывает он сам - над графиком,
          там, куда смотрят; здесь они висят под шапкой, поверх раздела.
          Список общий, поэтому показать его дважды нельзя: он бы задвоился. */}
      {!isActive("/app/scalping") && (
        <Toasts items={toasts} onClose={dismissToast} onPick={dismissSymbol} place="shell" />
      )}

      {/* Сертификаты трейдера: уведомление о новом и окно с подписью и печатью. */}
      <CertificateHost pathKey={pathname} />

      {/* Палитра символов по Ctrl+K. В оболочке, а не в терминале: сочетание
          должно работать и на «Рынке», и в полном экране, где шапки нет. */}
      <CommandPalette />

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
