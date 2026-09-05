"use client";

// Подключение биржевого счёта.
//
// Ключи уходят на сервер один раз и обратно не возвращаются: показывается
// только хвост из четырёх символов, чтобы владелец узнал свой ключ. Сервер
// проверяет их запросом баланса до сохранения — иначе неверный ключ всплыл бы
// в момент ордера, то есть в самый неподходящий.

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { dropKeys, saveKeys, type TradingStatus } from "@/lib/trading";

const FIELD =
  "w-full rounded-md border border-border bg-bg-deep px-2.5 py-2 font-mono text-[13px] " +
  "text-text-primary outline-none transition-colors duration-150 ease-out focus:border-accent-cyan";

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
  const [apiKey, setApiKey] = useState("");
  const [secret, setSecret] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await saveKeys(apiKey.trim(), secret.trim(), passphrase.trim());
      setApiKey("");
      setSecret("");
      setPassphrase("");
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось подключить");
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
      setError(err instanceof Error ? err.message : "Не удалось отключить");
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
        className="w-[440px] max-w-full animate-dialog-in rounded-xl border border-border bg-bg-card shadow-2xl motion-reduce:animate-none"
      >
        <div className="flex items-start justify-between border-b border-border px-5 py-4">
          <div>
            <p className="text-sm font-semibold text-text-primary">Биржевой счёт WEEX</p>
            <p className="mt-0.5 text-[11px] text-text-muted">
              {status.connected
                ? `Подключён ключ ${status.key_tail}`
                : "Терминал сможет ставить ордера с вашего счёта"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted transition-colors duration-150 ease-out hover:text-text-primary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {!reachable ? (
          <p className="px-5 py-6 text-center text-[12px] leading-relaxed text-text-muted">
            Состояние счёта получить не удалось. Войдите в кабинет — торговый
            раздел привязан к ученику; если вход выполнен, значит сервер сейчас
            недоступен.
          </p>
        ) : !status.enabled ? (
          <p className="px-5 py-6 text-center text-[12px] leading-relaxed text-text-muted">
            На сервере не задан ключ шифрования, и торговля выключена целиком.
            Хранить ваши ключи открытым текстом мы не будем.
          </p>
        ) : (
          <div className="space-y-3 px-5 py-4">
            <label className="block">
              <span className="mb-1 block text-[11px] text-text-muted">API Key</span>
              <input
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="off"
                className={FIELD}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-text-muted">Secret Key</span>
              <input
                type="password"
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                autoComplete="new-password"
                className={FIELD}
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-text-muted">Passphrase</span>
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                autoComplete="new-password"
                className={FIELD}
              />
            </label>

            <p className="text-[11px] leading-snug text-text-muted">
              Ключи хранятся зашифрованными и наружу не отдаются. Заводите ключ
              только с правом торговли — вывод средств терминалу не нужен.
            </p>

            {error && (
              <p className="rounded-md bg-danger/10 px-3 py-2 text-[11px] text-danger">{error}</p>
            )}
          </div>
        )}

        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          {status.connected ? (
            <button
              onClick={disconnect}
              disabled={busy}
              className={`${BUTTON} text-danger hover:bg-danger/10 disabled:opacity-40`}
            >
              Отключить
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button onClick={onClose} className={`${BUTTON} text-text-muted hover:text-text-primary`}>
              Закрыть
            </button>
            <button
              onClick={submit}
              disabled={busy || !reachable || !status.enabled || !apiKey || !secret || !passphrase}
              className={`${BUTTON} bg-accent-cyan/20 text-accent-cyan disabled:opacity-40`}
            >
              {busy ? "Проверяем…" : "Подключить"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
