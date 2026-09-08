"use client";

// Счёт не подключён: сказать об этом до расчёта, а не после.
//
// Раньше терминал пускал считать сделку и молчал до самого конца: трейдер
// набирал сумму, плечо, двигал стоп, жал «Открыть» - и только там узнавал, что
// счёта нет. Это потраченная минута и обманутое ожидание: расчёт выглядел
// настоящим ровно до последнего нажатия.
//
// Поэтому окно встречает на входе и говорит одно: чего не хватает и куда
// нажать. Кнопка ровно одна - выбор здесь не нужен, нужен следующий шаг.

import { useEffect } from "react";
import { KeyRound, LogIn, X } from "lucide-react";

/** Чего именно не хватает: входа в кабинет или ключей биржи. */
export type ConnectNeed = "login" | "keys";

const BUTTON =
  "flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-semibold " +
  "transition-[background-color,transform] duration-150 ease-out active:scale-[0.98]";

export default function ConnectDialog({
  need,
  onConnect,
  onClose,
}: {
  need: ConnectNeed;
  /** Следующий шаг: окно ключей или страница входа. */
  onConnect: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
      if (event.key === "Enter") onConnect();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, onConnect]);

  const login = need === "login";

  return (
    <div
      className="fixed inset-0 z-[60] grid animate-fade-in place-items-center bg-black/60 p-4 motion-reduce:animate-none"
      onClick={onClose}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="w-[380px] max-w-full animate-dialog-in rounded-xl border border-[var(--pane-border)] bg-[var(--pane-bg)] shadow-2xl motion-reduce:animate-none"
      >
        <div className="flex items-start justify-between border-b border-[var(--pane-border)] px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-[var(--pane-border)] text-[var(--pane-gold)]">
              {login ? <LogIn className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
            </div>
            <div>
              <div className="text-[13px] font-semibold text-[var(--pane-text)]">
                {login ? "Нужен вход в кабинет" : "Биржевой счёт не подключён"}
              </div>
              <p className="mt-0.5 text-[11px] text-[var(--pane-muted)]">
                {login
                  ? "Сделки считаются на вашем счёте, а его ещё нет"
                  : "Считать сделку можно, а отправить её на биржу - нет"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            title="Закрыть"
            className="text-[var(--pane-muted)] transition-colors duration-150 ease-out hover:text-[var(--pane-text)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4">
          <p className="text-[12px] leading-relaxed text-[var(--pane-text-2)]">
            {login
              ? "Войдите по UID WEEX - после этого можно подключить ключи и торговать прямо из терминала."
              : "Подключите ключи WEEX с правом на торговлю и без права на вывод средств. Они хранятся зашифрованными и в браузер не возвращаются."}
          </p>

          <button
            onClick={onConnect}
            className={`${BUTTON} mt-4 bg-[var(--pane-accent)] text-[var(--pane-deep)] hover:opacity-90`}
          >
            {login ? <LogIn className="h-4 w-4" /> : <KeyRound className="h-4 w-4" />}
            {login ? "Войти" : "Подключиться"}
          </button>
          <button
            onClick={onClose}
            className={`${BUTTON} mt-2 text-[var(--pane-muted)] hover:text-[var(--pane-text)]`}
          >
            Не сейчас
          </button>
        </div>
      </div>
    </div>
  );
}
