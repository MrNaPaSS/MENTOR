"use client";

// Подключение биржевого счёта.
//
// Ключи уходят на сервер один раз и обратно не возвращаются: показывается
// только хвост из четырёх символов, чтобы владелец узнал свой ключ. Сервер
// проверяет их запросом баланса до сохранения — иначе неверный ключ всплыл бы
// в момент ордера, то есть в самый неподходящий.

import Link from "next/link";

import { useT } from "@/lib/i18n";
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { balance as loadBalance, dropKeys, saveKeys, type TradingStatus } from "@/lib/trading";

/**
 * Доступный остаток из ответа биржи.
 *
 * Поля называются по-разному и приходят то массивом монет, то одним объектом.
 * Не разобрали — не беда: подключение подтверждается самим фактом ответа.
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
const BUILD = "trade-2026-09-06";

const FIELD =
  "w-full rounded-md border border-[var(--pane-border)] bg-[var(--pane-deep)] px-2.5 py-2 font-mono text-[13px] " +
  "text-[var(--pane-text)] outline-none transition-colors duration-150 ease-out focus:border-[var(--pane-accent-soft)]";

const BUTTON =
  "rounded-md px-4 py-2 text-[12px] font-semibold transition-[background-color,transform] " +
  "duration-150 ease-out active:scale-[0.98]";

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

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Остаток на счёте — самое честное подтверждение, что ключи работают: он
  // приходит с биржи, а не из нашей базы.
  useEffect(() => {
    if (!status.connected || !reachable) return;
    let cancelled = false;
    loadBalance()
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
  }, [status.connected, reachable]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await saveKeys(apiKey.trim(), secret.trim(), passphrase.trim());
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
    try {
      await dropKeys();
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : d.disconnectFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid animate-fade-in place-items-center bg-black/60 p-4 motion-reduce:animate-none"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-[440px] max-w-full animate-dialog-in rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] shadow-2xl motion-reduce:animate-none"
      >
        <div className="flex items-start justify-between border-b border-[var(--pane-border)] px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-[var(--pane-text)]">
              {d.title}{" "}
              <span className="font-mono text-[10px] font-normal text-[var(--pane-muted)]">{BUILD}</span>
            </p>
            <p className="mt-0.5 text-[11px] text-[var(--pane-muted)]">
              {status.connected
                ? d.keyTail(status.key_tail)
                : d.canPlace}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!reachable ? (
          <p className="px-5 py-6 text-center text-[12px] leading-relaxed text-[var(--pane-muted)]">
            {d.unreachable}
          </p>
        ) : !status.enabled ? (
          <p className="px-5 py-6 text-center text-[12px] leading-relaxed text-[var(--pane-muted)]">
            {d.vaultOff}
          </p>
        ) : status.connected && !replacing ? (
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
                <span className="text-[var(--pane-text-2)]">{status.key_tail}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--pane-muted)]">{d.available}</span>
                <span className="text-[var(--pane-text-2)]">
                  {funds !== null ? `${funds} USDT` : checked ? "-" : d.asking}
                </span>
              </div>
              {status.updated_at && (
                <div className="flex justify-between">
                  <span className="text-[var(--pane-muted)]">{d.since}</span>
                  <span className="text-[var(--pane-text-2)]">
                    {new Date(status.updated_at).toLocaleString("ru", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              )}
            </div>

            <p className="text-[11px] leading-snug text-[var(--pane-muted)]">
              {d.liveNote}
            </p>

            <button
              onClick={() => setReplacing(true)}
              className="text-[11px] text-[var(--pane-accent)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
            >
              {d.replaceKeys}
            </button>
          </div>
        ) : (
          <div className="space-y-3 px-5 py-4">
            {/* Дорога к ключу - первой строкой, до полей.
                Три поля с надписями «ключ», «секрет» и «кодовая фраза» тому,
                кто их ни разу не создавал, не говорят ничего: он ищет не форму,
                а место на бирже, где эти слова появляются.

                Той же вкладкой, а не новой: новая уводит человека из кабинета
                в отдельное окно, из которого назад ведёт только кнопка
                браузера. Инструкция - часть подключения, а не отдельное
                чтение, и с неё возвращаются в терминал ссылкой сверху. */}
            <Link
              href="/app/faq"
              onClick={onClose}
              className="block text-[11px] text-[var(--pane-accent)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
            >
              {d.howTo}
            </Link>
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

        <div className="flex items-center justify-between border-t border-[var(--pane-border)] px-5 py-3">
          {status.connected ? (
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
            {(!status.connected || replacing) && (
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
