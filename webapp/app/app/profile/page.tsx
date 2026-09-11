"use client";

import { useEffect, useState } from "react";
import { ChevronRight, Key, LogOut, MonitorDown, Moon, RefreshCw, ShieldCheck, Sun, Volume2, VolumeX } from "lucide-react";
import { api, API_URL, Profile } from "@/lib/api";
import { getAccessToken, logout } from "@/lib/auth";
import { profileChanged } from "@/lib/profileEvent";
import { installApp, useCanInstall } from "@/lib/installApp";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { fmtUsd, maskUid } from "@/lib/format";
import { tradingStatus, type TradingStatus } from "@/lib/trading";
import ExchangeDialog from "@/components/scalping/ExchangeDialog";
import { setTerminalTheme, useTerminalTheme } from "@/lib/terminalTheme";
import { setSoundOn, useSoundOn } from "@/lib/notifySound";
import { intlLocale, setLocale, useLocale, useT, type Locale } from "@/lib/i18n";
import { PaneHead, PaneScope } from "@/components/app/Pane";
import FramedAvatar from "@/components/avatar/FramedAvatar";
import Motto, { BRAND_MOTTO } from "@/components/app/Motto";

const ADMIN_WEEX_UID = "6613031308";

// Карточки красятся палитрой темы: страница светлеет вместе с терминалом, а
// неоновая бирюза, вписанная числом, на белом листе слепит.
const CARD = "rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] p-3";

// Кнопки действий - золотой обводкой, как на макете: «Обновить», «Изменить».
const GOLD_BTN =
  "flex items-center gap-1.5 rounded-lg border border-accent-gold/60 bg-[color:color-mix(in_srgb,var(--pane-gold)_8%,transparent)] " +
  "px-3 py-2 text-[12px] font-semibold text-[var(--pane-gold)] transition-colors duration-150 " +
  "hover:bg-[color:color-mix(in_srgb,var(--pane-gold)_15%,transparent)]";

// Выбранный вариант переключателя - золотом, остальные приглушены.
const SEG_ON =
  "border border-accent-gold/60 bg-[color:color-mix(in_srgb,var(--pane-gold)_12%,transparent)] text-[var(--pane-text)]";
const SEG_OFF = "border border-transparent text-[var(--pane-muted)] hover:text-[var(--pane-text-2)]";

export default function ProfilePage() {
  const router = useRouter();
  const t = useT();
  const locale = useLocale();
  const [p, setP] = useState<Profile | null>(null);
  const [exchange, setExchange] = useState<TradingStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Окно ключей открывается прямо здесь. Раньше кнопка уводила в терминал:
  // человек спрашивал «подключено ли» на этой странице, а отвечать на это его
  // отправляли в другой раздел и искать там нужную кнопку.
  const [keysOpen, setKeysOpen] = useState(false);
  // Тема нужна самой странице: переключатель показывает, какая сейчас стоит.
  // Цвета панелей на страницу приносит PaneScope - окну ключей внутри неё
  // отдельная обёртка больше не нужна.
  const theme = useTerminalTheme();
  const sound = useSoundOn();
  // Браузер сам решает, когда готов установить сайт: кнопку показываем только
  // в этот момент и только тем, у кого кабинет ещё не установлен.
  const canInstall = useCanInstall();

  useEffect(() => {
    const token = getAccessToken();
    if (!token) return;
    api.profile(token).then(setP).catch(() => {});
    // Состояние биржевого счёта: ключи вводятся в терминале, а вопрос
    // «подключено ли» человек задаёт себе именно здесь.
    tradingStatus()
      .then(setExchange)
      .catch(() => {});
  }, []);

  /**
   * Сменить язык интерфейса.
   *
   * Локальный выбор переключается сразу, не дожидаясь ответа сервера: человек
   * нажал на кнопку и вправе увидеть результат немедленно, а не через сетевую
   * задержку. На сервер он уезжает тем же PATCH, что и остальные настройки -
   * чтобы вернуться вместе с профилем на другом устройстве.
   */
  function changeLocale(next: Locale) {
    setLocale(next);
    void patch({ language: next });
  }

  async function patch(body: Partial<Profile>) {
    const token = getAccessToken();
    if (!token || !p) return;
    setSaving(true);
    try { setP(await api.patchProfile(token, body)); }
    catch { /* noop */ }
    finally { setSaving(false); }
  }

  async function refreshBalance() {
    const token = getAccessToken();
    if (!token) return;
    setRefreshing(true);
    try {
      setP(await api.refreshBalance(token));
      // Шапке сайта - вслух: баланс в ней из того же профиля, и без этого она
      // держала бы старую цифру до перезагрузки страницы.
      profileChanged();
    } finally {
      setRefreshing(false);
    }
  }

  /** Ключи подключили или сменили: и состояние счёта, и баланс теперь другие. */
  async function afterKeys() {
    setKeysOpen(false);
    tradingStatus()
      .then(setExchange)
      .catch(() => {});
    await refreshBalance();
  }

  if (!p) {
    return (
      <div className="space-y-3">
        <div className="skeleton h-32 w-full rounded-xl" />
        <div className="skeleton h-40 w-full rounded-xl" />
      </div>
    );
  }

  const initial = (p.username || "U").slice(0, 1).toUpperCase();
  const isAdmin = p.weex_uid === ADMIN_WEEX_UID;

  return (
    // Колонкой во всю высоту окна: нижний баннер прижат к низу страницы, а не
    // висит сразу под кнопкой выхода. 128 - отступы кабинета сверху и снизу.
    <PaneScope className="flex flex-col gap-3 lg:min-h-[calc(100dvh-128px)]">
      <PaneHead title={t.shell.nav.profile} hint={`@${p.username || "-"}`} />

      {/* Два столбца на широком экране: слева про счёт, справа про
          обустройство кабинета. Одной колонкой всё это выстраивалось в
          лестницу, где до настроек надо было доскроллить. */}
      <div className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-3">
        {/* Кто я и сколько у меня. Без градиента и свечения: терминал рядом
            собран из ровных панелей, и цветное пятно здесь читалось бы куском
            другого приложения. */}
        <div className="relative overflow-hidden rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] p-4">
          {/* Горы с короной, свечами и граффити NMNH - на прозрачном фоне, во
              всю высоту карточки. Стоят между именем с балансом и правой
              колонкой, где девиз и кнопка «Обновить»: на картинку они не
              ложатся. Левый край гор растворяется, чтобы под именем и
              балансом оставалось чистое поле. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/art/profile/card-crown.webp"
            alt=""
            aria-hidden
            // Место картинки - рамка от трети ширины почти до правого края: её
            // правый склон уходит под девиз и кнопку, они стоят поверх. На
            // узкой карточке она уменьшается, а не наезжает на баланс.
            className="profile-art pointer-events-none absolute bottom-0 left-[34%] right-[72px] top-1 hidden h-[calc(100%-0.25rem)] w-[calc(66%-72px)] object-contain object-bottom sm:block"
            style={{
              maskImage: "linear-gradient(90deg, transparent 0%, #000 14%)",
              WebkitMaskImage: "linear-gradient(90deg, transparent 0%, #000 14%)",
            }}
          />
          {/* Девиз набран текстом, а не впечатан в картинку: так он читается и
              на тёмной теме. */}
          <Motto
            lines={BRAND_MOTTO}
            className="absolute right-5 top-5 hidden !text-[11px] !tracking-[0.42em] !text-[var(--pane-text-2)] md:block"
          />
          <div className="relative flex items-center gap-4">
            {/* Аватарка из Telegram, если она есть. Файл отдаёт бэкенд, поэтому
                к пути добавляем API_URL: сайт живёт на другом домене. Нет
                аватарки - остаётся буква, как было. */}
            {/* В рамке, купленной в маркете: квадрат со скруглением 8 точек,
                как в наборе рамок. Рамка выходит наружу и места не занимает. */}
            <div className="relative shrink-0">
              <div
                className={`rounded-full ${p.avatar_frame ? "" : "p-[3px] shadow-[0_6px_20px_-6px_rgba(240,185,11,0.6)]"}`}
                style={p.avatar_frame ? undefined : { background: "linear-gradient(135deg, #f5d27a, #b8860b 55%, #f0b90b)" }}
              >
                <FramedAvatar
                  src={p.avatar_url ? `${API_URL}${p.avatar_url}` : null}
                  name={p.username || initial || t.profile.avatarAlt}
                  size={80}
                  frame={p.avatar_frame}
                />
              </div>
              {isAdmin && (
                <span className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-[var(--pane-gold)]">
                  <ShieldCheck className="h-3 w-3 text-[var(--pane-bg)]" />
                </span>
              )}
            </div>
            <div className="min-w-0">
              <div className="truncate text-[20px] font-bold text-[var(--pane-text)]">@{p.username || "-"}</div>
              <div className="mt-0.5 font-mono text-[12px] text-[var(--pane-muted)]">WEEX UID: {maskUid(p.weex_uid)}</div>
            </div>
          </div>

          {/* Balance */}
          <div className="relative mt-4 flex items-end justify-between gap-3">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[var(--pane-muted)]">{t.profile.balance}</div>
              <div className="font-mono text-[28px] font-bold leading-tight tabular-nums text-[var(--pane-text)]">
                {fmtUsd(p.balance_usdt)}
                <span className="ml-1 text-[11px] font-semibold text-[var(--pane-muted)]">USDT</span>
              </div>
              {/* Откуда цифра. Ключи ученика и партнёрская ручка по UID - разные
                  источники, и разница между ними видна: одна показывает то же,
                  что приложение биржи, другая приходит с задержкой. */}
              <div className="text-[10px] text-[var(--pane-muted)]">
                {p.balance_source === "api_keys"
                  ? t.profile.balanceFromKeys
                  : p.balance_source === "affiliate_api"
                    ? t.profile.balanceFromAffiliate
                    : t.profile.balanceManual}
              </div>
            </div>
            <button
              onClick={refreshBalance}
              disabled={refreshing}
              className={`${GOLD_BTN} relative !bg-[var(--pane-bg)] disabled:opacity-50`}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} />
              {t.common.refresh}
            </button>
          </div>
        </div>
        {/* ── Биржевой счёт ──
            Ключи вводятся в терминале, но вопрос «подключено ли» человек задаёт
            себе здесь - и ответа тут не было вовсе. */}
        <div className={`${CARD} relative overflow-hidden`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/art/brand/weex.webp"
            alt=""
            aria-hidden
            className="pointer-events-none absolute -bottom-2 -right-2 hidden h-32 w-auto sm:block"
          />
          <div className="relative mb-3 flex items-center justify-between gap-3 sm:pr-40">
            <span className="text-[14px] font-bold text-[var(--pane-text)]">
              {t.profile.exchangeTitle}
            </span>
            <span
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                exchange?.connected ? "bg-[color:color-mix(in_srgb,var(--pane-up)_10%,transparent)] text-[var(--pane-up)]" : "bg-[var(--pane-hover)] text-[var(--pane-muted)]"
              }`}
            >
              {exchange?.connected ? t.profile.connected : t.profile.disconnected}
            </span>
          </div>

          <div className="relative flex items-center gap-3 sm:pr-40">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl border border-accent-gold/40 bg-black text-[var(--pane-gold)]">
              <Key className="h-4 w-4" />
            </div>
            <div className="min-w-0 text-[12px]">
              <div className="font-semibold text-[var(--pane-text)]">WEEX Futures</div>
              <div className="mt-0.5 text-[12px] text-[var(--pane-muted)]">
                {exchange?.connected ? (
                  <>
                    {t.profile.keyTail(exchange.key_tail)}
                    {exchange.updated_at && (
                      <>
                        {t.profile.keySince(
                          new Date(exchange.updated_at).toLocaleDateString(intlLocale(locale))
                        )}
                      </>
                    )}
                  </>
                ) : exchange && !exchange.enabled ? (
                  t.profile.vaultOff
                ) : (
                  t.profile.noKeys
                )}
              </div>
            </div>
            <button
              onClick={() => setKeysOpen(true)}
              className={`ml-auto shrink-0 ${GOLD_BTN}`}
            >
              {exchange?.connected ? t.common.change : t.common.connect}
            </button>
          </div>

          <p className="relative mt-4 text-[11px] leading-relaxed text-[var(--pane-muted)] sm:pr-40">
            {t.profile.keysNote}
          </p>
        </div>

        </div>

        <div className="flex flex-col gap-3">
        {/* ── НАСТРОЙКИ ──
            Здесь только то, что человек меняет про себя: как выглядит кабинет,
            на каком языке, что звучит и как он подписан на карточках.

            Режим торговли и риск на сделку отсюда убраны. Это не настройки
            интерфейса, а параметры расчёта сигнала: их место рядом с самим
            расчётом, а в списке личных предпочтений они читались как «сделай
            мне турбо» и ставились наугад. Данные никуда не делись - ими
            по-прежнему пользуются рассылка сигналов и калькулятор. */}
        {/* Коробка тянется до низа «Биржевого счёта»: края колонок совпадают. */}
        <div className={`${CARD} flex-1`}>
          <div className="mb-3 text-[14px] font-bold text-[var(--pane-text)]">{t.profile.settings}</div>

          <div className="space-y-3">

            {/* Тема. Общая на весь кабинет: терминал светлеет вместе с шапкой и
                страницами, иначе панели выглядят вырезанными из другого
                приложения. */}
            <SettingRow label={t.profile.theme}>
              <div
                className="flex rounded-xl p-1"
                style={{ background: "rgb(var(--bg-deep) / 0.3)", border: "1px solid rgb(var(--border) / 0.7)" }}
              >
                {([
                  ["light", t.profile.themeLight, Sun],
                  ["dark", t.profile.themeDark, Moon],
                ] as const).map(([value, label, Icon]) => {
                  const active = theme === value;
                  return (
                    <button
                      key={value}
                      onClick={() => setTerminalTheme(value)}
                      className={`relative flex flex-1 items-center justify-center gap-1.5 rounded py-1.5 text-[11px] font-semibold transition-colors duration-150 ${
                        active ? SEG_ON : SEG_OFF
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {label}
                      {active && (
                        <span className="absolute inset-x-3 bottom-0 h-[2px] rounded-full bg-[var(--pane-gold)]" />
                      )}
                    </button>
                  );
                })}
              </div>
            </SettingRow>

            {/* Язык */}
            <SettingRow label={t.profile.language}>
              <div
                className="flex rounded-xl p-1"
                style={{ background: "rgb(var(--bg-deep) / 0.3)", border: "1px solid rgb(var(--border) / 0.7)" }}
              >
                {(["ru", "en"] as const).map((l) => {
                  const active = locale === l;
                  return (
                    <button
                      key={l}
                      onClick={() => changeLocale(l)}
                      disabled={saving}
                      className={`relative flex-1 rounded py-1.5 text-[11px] font-bold uppercase tracking-wider transition-colors duration-150 disabled:opacity-60 ${
                        active ? SEG_ON : SEG_OFF
                      }`}
                    >
                      {l}
                      {active && (
                        <span className="absolute inset-x-3 bottom-0 h-[2px] rounded-full bg-[var(--pane-gold)]" />
                      )}
                    </button>
                  );
                })}
              </div>
            </SettingRow>

            {/* Звук событий. Настройка человека, а не страницы: раньше она жила
                внутри рабочего места терминала, и выключить её можно было только
                оттуда. */}
            <SettingRow label={t.profile.sound}>
              <div
                className="flex rounded-xl p-1"
                style={{ background: "rgb(var(--bg-deep) / 0.3)", border: "1px solid rgb(var(--border) / 0.7)" }}
              >
                {([
                  [true, t.common.on, Volume2],
                  [false, t.common.off, VolumeX],
                ] as const).map(([value, label, Icon]) => {
                  const active = sound === value;
                  return (
                    <button
                      key={label}
                      onClick={() => setSoundOn(value)}
                      className={`relative flex flex-1 items-center justify-center gap-1.5 rounded py-1.5 text-[11px] font-semibold transition-colors duration-150 ${
                        active ? SEG_ON : SEG_OFF
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      {label}
                      {active && (
                        <span className="absolute inset-x-3 bottom-0 h-[2px] rounded-full bg-[var(--pane-gold)]" />
                      )}
                    </button>
                  );
                })}
              </div>
            </SettingRow>

            {/* Установка на рабочий стол. Показываем только там, где браузер и
                правда готов её выполнить: кнопка, которая ничего не делает,
                хуже её отсутствия. Уже установленный кабинет её не показывает
                вовсе. */}
            {canInstall && (
              <SettingRow label={t.profile.install}>
                <button
                  onClick={() => void installApp()}
                  title={t.profile.installHint}
                  className="flex items-center gap-1.5 rounded-lg border border-[var(--pane-border)] bg-[var(--pane-hover)] px-2.5 py-1.5 text-[11px] font-semibold text-[var(--pane-text-2)] transition-colors duration-150 hover:border-[var(--pane-accent-soft)] hover:text-[var(--pane-accent)]"
                >
                  <MonitorDown className="h-4 w-4" />
                  {t.profile.installAction}
                </button>
              </SettingRow>
            )}

            {/* Подпись на карточке. Отдельно от ника Telegram: тот переписывается
                при каждом входе, а карточку показывают другим. */}
            <SettingRow label={t.profile.cardName}>
              <div className="flex items-center gap-2">
                <input
                  defaultValue={p.card_name ?? ""}
                  placeholder={p.username || t.profile.cardNamePlaceholder}
                  maxLength={32}
                  onBlur={(e) => {
                    const next = e.target.value.trim();
                    if (next !== (p.card_name ?? "")) patch({ card_name: next });
                  }}
                  className="input w-44 text-center font-mono"
                />
              </div>
            </SettingRow>
            <p className="-mt-2 text-right text-[11px] text-[var(--pane-muted)]">
              {t.profile.cardNameHint}
            </p>
          </div>
        </div>

        </div>
      </div>

      {/* ── ADMIN ── */}
      {isAdmin && (
        <Link
          href="/admin"
          className="flex items-center justify-between rounded-xl border border-[var(--pane-gold-soft)] bg-[color:color-mix(in_srgb,var(--pane-gold)_10%,transparent)] px-3 py-2.5 transition-colors duration-150 hover:bg-[color:color-mix(in_srgb,var(--pane-gold)_15%,transparent)]"
        >
          <div className="flex items-center gap-3">
            <div className="grid h-8 w-8 place-items-center rounded-lg border border-[var(--pane-gold-soft)] bg-[color:color-mix(in_srgb,var(--pane-gold)_15%,transparent)]">
              <ShieldCheck className="h-4 w-4 text-[var(--pane-gold)]" />
            </div>
            <span className="text-[12px] font-semibold text-[var(--pane-text)]">{t.profile.adminPanel}</span>
          </div>
          <ChevronRight className="h-4 w-4 text-[var(--pane-gold)]" />
        </Link>
      )}

      {/* ── LOGOUT ── */}
      <button
        onClick={() => { logout(); router.push("/"); }}
        className="flex w-full items-center gap-3 rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] px-3 py-2.5 text-[12px] font-semibold text-[var(--pane-down)] transition-colors duration-150 hover:bg-[color:color-mix(in_srgb,var(--pane-down)_8%,transparent)]"
      >
        <span className="grid h-8 w-8 place-items-center rounded-lg border border-[color:color-mix(in_srgb,var(--pane-down)_30%,transparent)]">
          <LogOut className="h-4 w-4" />
        </span>
        <span className="flex-1 text-left">{t.profile.logoutAccount}</span>
        <ChevronRight className="h-4 w-4 text-[var(--pane-muted)]" />
      </button>

      {/* Окно ключей - то же самое, что в терминале. Оно красится палитрой
          панелей, а она живёт на классе: без обёртки переменные не подставятся
          и окно выйдет бесцветным. */}
      {keysOpen && (
        <div>
          <ExchangeDialog
            status={
              exchange ?? { enabled: false, connected: false, key_tail: "", updated_at: null }
            }
            reachable={exchange !== null}
            onClose={() => setKeysOpen(false)}
            onSaved={() => void afterKeys()}
          />
        </div>
      )}
    </PaneScope>
  );
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // Строка целиком - одна настройка: подпись слева, переключатель справа.
    // Подсветка при наведении показывает границы строки: без неё соседние
    // настройки сливались в столбик слов и столбик кнопок.
    <div className="-mx-1.5 flex items-center justify-between gap-3 rounded-lg px-1.5 py-1 transition-colors duration-150 hover:bg-[var(--pane-hover)]">
      <span className="shrink-0 text-[12px] text-[var(--pane-text-2)]">{label}</span>
      <div className="w-44 shrink-0">{children}</div>
    </div>
  );
}
