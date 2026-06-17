"use client";

import { useEffect } from "react";

export default function TelegramInit() {
  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    if (!tg) return;

    tg.ready();
    tg.expand();

    // Full screen mode (Bot API 8.0+)
    if (typeof tg.requestFullscreen === "function") {
      tg.requestFullscreen();
    }

    // Prevent accidental swipe-down close
    if (typeof tg.disableVerticalSwipes === "function") {
      tg.disableVerticalSwipes();
    }

    // Match app background
    if (typeof tg.setHeaderColor === "function") {
      tg.setHeaderColor("#0A0A1A");
    }
    if (typeof tg.setBackgroundColor === "function") {
      tg.setBackgroundColor("#0A0A1A");
    }
    if (typeof tg.setBottomBarColor === "function") {
      tg.setBottomBarColor("#0A0A1A");
    }
  }, []);

  return null;
}
