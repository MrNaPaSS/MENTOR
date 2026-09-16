"use client";

// Подключение биржевых счетов.
//
// Бирж несколько, и у ученика может быть подключено сразу несколько счетов.
// Вкладка сверху - биржа; под ней всё про её счёт: ключ, остаток, замена и
// отключение. Одна из подключённых - активная: на неё уходят новые сделки.
// Идущие сделки активная биржа не трогает - каждая ведётся там, где открыта.
//
// Ключи уходят на сервер один раз и обратно не возвращаются: показывается
// только хвост из четырёх символов, чтобы владелец узнал свой ключ. Сервер
// проверяет их запросом баланса до сохранения - иначе неверный ключ всплыл бы
// в момент ордера, то есть в самый неподходящий.

import Link from "next/link";

import { useT } from "@/lib/i18n";
import { venueName } from "@/lib/venues";
import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import {
  balance as loadBalance,
  dropKeys,
  saveKeys,
  setActiveExchange,
  type ExchangeAccount,
  type TradingStatus,
} from "@/lib/trading";

/**
 * Доступный остаток из ответа биржи.
 *
 * Поля называются по-разному и приходят то массивом монет, то одним объектом.
 * Не разобрали - не беда: подключение подтверждается самим фактом ответа.
 */
function availableUsdt(payload: unknown): string | null {
  const rows = Array.isArray(payload) ? payload : [payload];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const item = row as Record<string, unknown>;
    const coin = String(item.asset ?? item.marginCoin ?? item.coin ?? "USDT").toUpperCase();
    if (coin !== "USDT") continue;
    const value = item.availableBalance ?? item.available ?? item.balance;
    const amount = Number(value);
    if (Number.isFinite(amount)) return amount.toFixed(2);
  }
  return null;
}

// Метка сборки: единственный способ отличить «не работает» от «развёрнута
// старая версия». Меняется вместе с торговой частью.
const BUILD = "trade-2026-09-14";

const FIELD =
  "w-full rounded-md border border-[var(--pane-border)] bg-[var(--pane-deep)] px-2.5 py-2 font-mono text-[13px] " +
  "text-[var(--pane-text)] outline-none transition-colors duration-150 ease-out focus:border-[var(--pane-accent-soft)]";

const BUTTON =
  "rounded-md px-4 py-2 text-[12px] font-semibold transition-[background-color,transform] " +
  "duration-150 ease-out active:scale-[0.98]";

/**
 * Счета из ответа сервера.
 *
 * Сервер, собранный до мультибиржи, списка не присылает - тогда показываем
 * один счёт WEEX из прежних полей, чтобы окно работало и с ним.
 */
function accountsOf(status: TradingStatus): ExchangeAccount[] {
  if (status.accounts?.length) return status.accounts;
  return [
    {
      exchange: "weex",
      title: "WEEX Futures",
      connected: status.connected,
      key_tail: status.key_tail,
      updated_at: status.updated_at,
    },
  ];
}

export default function ExchangeDialog({
  status,
  reachable = true,
  onClose,
  onSaved,
}: {
  status: TradingStatus;
  /** Состояние счёта удалось получить с сервера. */
  reachable?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useT();
  const d = t.dialogs.exchange;
  const accounts = useMemo(() => accountsOf(status), [status]);
  const active = status.active || status.exchange || "";
  // Открываем на активной бирже: чаще всего спрашивают про неё. Счетов нет -
  // на первой в списке.
  const [code, setCode] = useState(active || accounts[0]?.exchange || "weex");
  const account = accounts.find((one) => one.exchange === code) ?? accounts[0];

  const [apiKey, setApiKey] = useState("");
  const [secret, setSecret] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Подключённый счёт показываем как подключённый. Пустые поля ввода на месте
  // готового подключения выглядят так, будто его нет.
  const [replacing, setReplacing] = useState(false);
  const [funds, setFunds] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  // Биржа закрыта, пока академия не подтвердила счёт ученика на ней. Сервер,
  // собранный до этого правила, поля не присылает - тогда как раньше.
  const locked = account?.may_connect === false && !account?.connected;

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Другая биржа - другой счёт: введённое и ошибка прежней вкладки к ней не
  // относятся.
  useEffect(() => {
    setApiKey("");
    setSecret("");
    setPassphrase("");
    setError(null);
    setReplacing(false);
    setFunds(null);
    setChecked(false);
  }, [code]);

  // Остаток на счёте - самое честное подтверждение, что ключи работают: он
  // приходит с биржи, а не из нашей базы.
  useEffect(() => {
    if (!account?.connected || !reachable) return;
    let cancelled = false;
    loadBalance(account.exchange)
      .then((body) => {
        if (cancelled) return;
        setFunds(availableUsdt(body?.balance));
        setChecked(true);
      })
      .catch(() => {
        if (!cancelled) setChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [account?.connected, account?.exchange, reachable]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await saveKeys(apiKey.trim(), secret.trim(), passphrase.trim(), code);
      setApiKey("");
      setSecret("");
      setPassphrase("");
      setReplacing(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : d.connectFailed);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setError(null);
    try {
      await dropKeys(code);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : d.disconnectFailed);
    } finally {
      setBusy(false);
    }
  }

  async function makeActive() {
    setBusy(true);
    setError(null);
    try {
      await setActiveExchange(code);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : d.activeFailed);
    } finally {
      setBusy(false);
    }
  }

  const connected = Boolean(account?.connected);
  const isActive = connected && account?.exchange === active;

  return (
    <div
      className="fixed inset-0 z-modal grid animate-fade-in place-items-center bg-black/60 p-4 motion-reduce:animate-none"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-[460px] max-w-full animate-dialog-in rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] shadow-2xl motion-reduce:animate-none"
      >
        <div className="flex items-start justify-between border-b border-[var(--pane-border)] px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-[var(--pane-text)]">
              {d.title}{" "}
              <span className="font-mono text-[10px] font-normal text-[var(--pane-muted)]">{BUILD}</span>
            </p>
            <p className="mt-0.5 text-[11px] text-[var(--pane-muted)]">
              {connected ? d.keyTail(account.key_tail) : d.canPlace}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Биржи - вкладками. Точка - подключён ли счёт, подпись - на какой
            из них сейчас ставятся сделки.

            Имена короткие и ряд прокручивается: бирж пять, и «WEEX Futures»
            пять раз подряд за край окна не помещались - последняя вкладка
            обрезалась на середине слова. */}
        {accounts.length > 1 && (
          <div
            className="flex gap-1 overflow-x-auto border-b border-[var(--pane-border)] px-3 py-2"
            role="tablist"
          >
            {accounts.map((one) => {
              const on = one.exchange === code;
              return (
                <button
                  key={one.exchange}
                  role="tab"
                  aria-selected={on}
                  onClick={() => setCode(one.exchange)}
                  className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-[12px] font-semibold transition-colors duration-150 ease-out ${
                    on
                      ? "bg-[var(--pane-accent-faint)] text-[var(--pane-text)]"
                      : "text-[var(--pane-muted)] hover:text-[var(--pane-text)]"
                  }`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      one.connected
                        ? "bg-[var(--pane-up)]"
                        : one.may_connect === false
                          ? "bg-[var(--pane-border)] opacity-50"
                          : "bg-[var(--pane-border)]"
                    }`}
                  />
                  {venueName(one.exchange)}
                  {one.connected && one.exchange === active && (
                    <span className="rounded bg-[var(--pane-hover)] px-1 py-px text-[9px] font-medium text-[var(--pane-accent)]">
                      {d.activeBadge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {!reachable ? (
          <p className="px-5 py-6 text-center text-[12px] leading-relaxed text-[var(--pane-muted)]">
            {d.unreachable}
          </p>
        ) : !status.enabled ? (
          <p className="px-5 py-6 text-center text-[12px] leading-relaxed text-[var(--pane-muted)]">
            {d.vaultOff}
          </p>
        ) : locked ? (
          // Биржа открывается подтверждением академии. Поля ключей здесь были
          // бы обманом: сервер такую заявку всё равно отклонит, а человек
          // решил бы, что ошибся в ключах.
          <p className="px-5 py-6 text-center text-[12px] leading-relaxed text-[var(--pane-muted)]">
            {d.needsAcademy}
          </p>
        ) : connected && !replacing ? (
          <div className="space-y-3 px-5 py-5">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-[var(--pane-up)]" />
              <span className="text-[13px] font-semibold text-[var(--pane-text)]">
                {d.connected}
              </span>
            </div>

            <div className="space-y-1 font-mono text-[12px] tabular-nums">
              <div className="flex justify-between">
                <span className="text-[var(--pane-muted)]">{d.key}</span>
                <span className="text-[var(--pane-text-2)]">{account.key_tail}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--pane-muted)]">{d.available}</span>
                <span className="text-[var(--pane-text-2)]">
                  {funds !== null ? `${funds} USDT` : checked ? "-" : d.asking}
                </span>
              </div>
              {account.updated_at && (
                <div className="flex justify-between">
                  <span className="text-[var(--pane-muted)]">{d.since}</span>
                  <span className="text-[var(--pane-text-2)]">
                    {new Date(account.updated_at).toLocaleString("ru", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              )}
            </div>

            {/* Через академию счёт или свой: от этого зависят комиссия и
                кешбэк, и ученик должен видеть это там же, где ключ. */}
            <p
              className={`text-[11px] leading-snug ${
                account.access === "academy" ? "text-[var(--pane-accent)]" : "text-[var(--pane-muted)]"
              }`}
            >
              {account.access === "academy" ? d.viaAcademy : d.ownAccount}
            </p>

            <p className="text-[11px] leading-snug text-[var(--pane-muted)]">
              {isActive ? d.activeNote : d.liveNote}
            </p>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {!isActive && (
                <button
                  onClick={makeActive}
                  disabled={busy}
                  className="text-[11px] font-semibold text-[var(--pane-accent)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)] disabled:opacity-40"
                >
                  {d.makeActive}
                </button>
              )}
              <button
                onClick={() => setReplacing(true)}
                className="text-[11px] text-[var(--pane-accent)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
              >
                {d.replaceKeys}
              </button>
            </div>

            {error && (
              <p className="rounded-md bg-[var(--pane-down-faint)] px-3 py-2 text-[11px] text-[var(--pane-down)]">{error}</p>
            )}
          </div>
        ) : (
          <div className="space-y-3 px-5 py-4">
            {/* Дорога к ключу - первой строкой, до полей. Пошаговая
                инструкция пока написана для WEEX; у остальных бирж ключ
                создаётся в разделе API их приложения. */}
            {code === "weex" ? (
              <Link
                href="/app/faq"
                onClick={onClose}
                className="block text-[11px] text-[var(--pane-accent)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
              >
                {d.howTo}
              </Link>
            ) : (
              <p className="text-[11px] leading-snug text-[var(--pane-muted)]">{d.howToOther}</p>
            )}
            <label className="block">
              <span className="mb-1 block text-[11px] text-[var(--pane-muted)]">API Key</span>
              <input
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="off"
                className={FIELD}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-[var(--pane-muted)]">Secret Key</span>
              <input
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                autoComplete="new-password"
                className={FIELD}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-[var(--pane-muted)]">Passphrase</span>
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                autoComplete="new-password"
                className={FIELD}
              />
            </label>

            <p className="text-[11px] leading-snug text-[var(--pane-muted)]">
              {d.keysNote}
            </p>

            {error && (
              <p className="rounded-md bg-[var(--pane-down-faint)] px-3 py-2 text-[11px] text-[var(--pane-down)]">{error}</p>
            )}
          </div>
        )}

        {/* Все биржи и условия - отдельной страницей: здесь ключи одного счёта,
            там выбор, где вообще заводить. */}
        <div className="px-5 pb-1 pt-0">
          <Link
            href="/app/exchanges"
            onClick={onClose}
            className="text-[11px] text-[var(--pane-accent)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
          >
            {t.exchanges.title}
          </Link>
        </div>

        <div className="flex items-center justify-between border-t border-[var(--pane-border)] px-5 py-3">
          {connected ? (
            <button
              onClick={disconnect}
              disabled={busy}
              className={`${BUTTON} text-[var(--pane-down)] hover:bg-[var(--pane-down-faint)] disabled:opacity-40`}
            >
              {d.disconnect}
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button onClick={onClose} className={`${BUTTON} text-[var(--pane-muted)] hover:text-[var(--pane-text)]`}>
              {t.common.close}
            </button>
            {(!connected || replacing) && (
              <button
                onClick={submit}
                disabled={busy || !reachable || !status.enabled || !apiKey || !secret || !passphrase}
                className={`${BUTTON} bg-[var(--pane-accent-faint)] text-[var(--pane-accent)] disabled:opacity-40`}
              >
                {busy ? d.checking : t.common.connect}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
