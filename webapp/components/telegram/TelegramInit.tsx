"use client";

// Кабинет внутри Telegram: развернуть окно и покрасить его в наши цвета.
//
// Сам скрипт мини-приложения приезжает после того, как страница ожила, а не до
// неё: он нужен одному входу из нескольких, а ждали его все. Поэтому здесь мы
// его дожидаемся - недолго и без блокировки. Не дождались (обычный браузер,
// закрытый telegram.org) - тихо уходим: снаружи Telegram настраивать нечего.

import { useEffect } from "react";

/** Сколько ждём скрипт мини-приложения и как часто спрашиваем. */
const WAIT_MS = 5000;
const EVERY_MS = 100;

export default function TelegramInit() {
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const until = Date.now() + WAIT_MS;

    const setup = () => {
      const tg = (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram
        ?.WebApp;
      if (!tg) return Date.now() > until;

      tg.ready();
      tg.expand();

      try { tg.requestFullscreen?.(); } catch { /* нет в старых версиях TG */ }
      try { tg.disableVerticalSwipes?.(); } catch { /* нет */ }
      try { tg.setHeaderColor?.("#0A0A1A"); } catch { /* нет */ }
      try { tg.setBackgroundColor?.("#0A0A1A"); } catch { /* нет */ }
      try { tg.setBottomBarColor?.("#0A0A1A"); } catch { /* нет */ }
      return true;
    };

    if (!setup()) {
      timer = setInterval(() => {
        if (setup() && timer) {
          clearInterval(timer);
          timer = null;
        }
      }, EVERY_MS);
    }

    return () => {
      if (timer) clearInterval(timer);
    };
  }, []);

  return null;
}

/** То немногое, что нам нужно от мини-приложения Telegram. */
type TelegramWebApp = {
  ready: () => void;
  expand: () => void;
  requestFullscreen?: () => void;
  disableVerticalSwipes?: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  setBottomBarColor?: (color: string) => void;
};
