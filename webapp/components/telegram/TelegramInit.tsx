"use client";

import { useEffect } from "react";

export default function TelegramInit() {
  useEffect(() => {
    const tg = (window as any).Telegram?.WebApp;
    if (!tg) return;

    tg.ready();
    tg.expand();

    try { tg.requestFullscreen?.(); } catch { /* unsupported in old TG versions */ }
    try { tg.disableVerticalSwipes?.(); } catch { /* unsupported */ }
    try { tg.setHeaderColor?.("#0A0A1A"); } catch { /* unsupported */ }
    try { tg.setBackgroundColor?.("#0A0A1A"); } catch { /* unsupported */ }
    try { tg.setBottomBarColor?.("#0A0A1A"); } catch { /* unsupported */ }
  }, []);

  return null;
}
