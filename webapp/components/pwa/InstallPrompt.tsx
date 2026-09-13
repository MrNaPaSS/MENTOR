"use client";

// Баннер установки кабинета: короткое предложение внизу экрана.
//
// Слушателя браузера здесь больше нет, и это главное. Событие
// `beforeinstallprompt` браузер шлёт один раз и вскоре после загрузки
// страницы, а ловили его двое: этот баннер и модуль `lib/installApp`, из
// которого работает кнопка «Установить» в настройках. Модуль приезжал вместе
// со страницей профиля, то есть почти всегда позже события, - и кнопка в
// настройках отвечала подсказкой «поставьте руками через меню браузера», хотя
// браузер был готов поставить сам.
//
// Теперь предложение придерживает один модуль (`lib/installApp`), а баннер и
// кнопка настроек берут его оттуда. Модуль грузится вместе с этим баннером, то
// есть с корневым макетом, - раньше, чем браузер успеет прислать событие.

import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";

import { useT } from "@/lib/i18n";
import { installApp, isInstalled, useCanInstall } from "@/lib/installApp";

const DISMISS_KEY = "nmnh_install_dismissed";

/** Баннер установки PWA (ТЗ §11): Android и десктоп - кнопка, iOS - инструкция. */
export default function InstallPrompt() {
  const t = useT();
  const canInstall = useCanInstall();
  const [dismissed, setDismissed] = useState(true);
  const [iosHint, setIosHint] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // Закрытый баннер не возвращаем: человек сказал «нет». Кнопка в настройках
    // при этом остаётся - там он говорит «да» сам.
    if (localStorage.getItem(DISMISS_KEY)) return;
    if (isInstalled()) return;
    setDismissed(false);

    // iOS Safari о `beforeinstallprompt` не знает вовсе: там единственный путь
    // - показать, как это делается руками.
    const ua = window.navigator.userAgent;
    const isIos = /iphone|ipad|ipod/i.test(ua);
    const isSafari = /^((?!chrome|crios|android).)*safari/i.test(ua);
    if (isIos && isSafari) setIosHint(true);
  }, []);

  function dismiss() {
    setDismissed(true);
    localStorage.setItem(DISMISS_KEY, "1");
  }

  async function install() {
    await installApp();
    dismiss();
  }

  if (dismissed || !(canInstall || iosHint)) return null;

  return (
    <div className="fixed inset-x-3 bottom-3 z-[60] mx-auto max-w-md md:left-auto md:right-4">
      <div className="glass flex items-center gap-3 rounded-2xl p-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-accent-cyan/15 text-accent-cyan ring-1 ring-accent-cyan/30">
          <Download className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text-primary">{t.tools.install.title}</p>
          {iosHint ? (
            <p className="flex items-center gap-1 text-xs text-text-muted">
              {t.tools.install.iosPrefix} <Share className="inline h-3 w-3" /> {t.tools.install.iosHint}
            </p>
          ) : (
            <p className="text-xs text-text-muted">{t.tools.install.hint}</p>
          )}
        </div>
        {!iosHint && (
          <button onClick={() => void install()} className="btn-primary px-3 py-1.5 text-xs">
            {t.tools.install.action}
          </button>
        )}
        <button
          onClick={dismiss}
          className="grid h-8 w-8 place-items-center rounded-lg text-text-muted hover:text-text-primary"
          aria-label={t.common.close}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
