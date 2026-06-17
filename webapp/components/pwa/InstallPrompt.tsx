"use client";

import { useEffect, useState } from "react";
import { Download, X, Share } from "lucide-react";

interface BIPEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "nmnh_install_dismissed";

/** Кнопка/баннер установки PWA (ТЗ §11): Android - beforeinstallprompt, iOS - инструкция. */
export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BIPEvent | null>(null);
  const [iosHint, setIosHint] = useState(false);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem(DISMISS_KEY)) return;

    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;
    if (standalone) return;

    const onBIP = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BIPEvent);
      setShow(true);
    };
    window.addEventListener("beforeinstallprompt", onBIP);

    // iOS Safari не поддерживает beforeinstallprompt → показываем инструкцию
    const ua = window.navigator.userAgent;
    const isIos = /iphone|ipad|ipod/i.test(ua);
    const isSafari = /^((?!chrome|crios|android).)*safari/i.test(ua);
    if (isIos && isSafari) {
      setIosHint(true);
      setShow(true);
    }

    return () => window.removeEventListener("beforeinstallprompt", onBIP);
  }, []);

  function dismiss() {
    setShow(false);
    localStorage.setItem(DISMISS_KEY, "1");
  }

  async function install() {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    dismiss();
  }

  if (!show) return null;

  return (
    <div className="fixed inset-x-3 bottom-3 z-[60] mx-auto max-w-md md:left-auto md:right-4">
      <div className="glass flex items-center gap-3 rounded-2xl p-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-cyan/15 text-accent-cyan ring-1 ring-accent-cyan/30">
          <Download className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-white">Установить NMNH</p>
          {iosHint ? (
            <p className="flex items-center gap-1 text-xs text-text-muted">
              Нажми <Share className="inline h-3 w-3" /> «Поделиться» → «На экран Домой»
            </p>
          ) : (
            <p className="text-xs text-text-muted">Быстрый доступ с домашнего экрана</p>
          )}
        </div>
        {!iosHint && (
          <button onClick={install} className="btn-primary px-3 py-1.5 text-xs">
            Установить
          </button>
        )}
        <button onClick={dismiss} className="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:text-white" aria-label="Закрыть">
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
