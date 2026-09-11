"use client";

// Монета NMNH - та, что на самой монете: логотип, корона и свечи.
//
// Две чеканки под две темы: на светлой - тёмная монета, на тёмной - светлая.
// Контраст с листом: светлая монета на белом листе сливалась бы с ним, тёмная
// на чёрном - тоже.

import { useTerminalTheme, type TerminalTheme } from "@/lib/terminalTheme";

export function coinSrc(theme: TerminalTheme): string {
  return theme === "light" ? "/coin/coin-dark.webp" : "/coin/coin-light.webp";
}

export default function CoinIcon({ size = 14, className = "" }: { size?: number; className?: string }) {
  const theme = useTerminalTheme();
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={coinSrc(theme)}
      alt=""
      aria-hidden
      draggable={false}
      width={size}
      height={size}
      className={`inline-block shrink-0 select-none ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
