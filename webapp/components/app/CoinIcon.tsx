"use client";

// Монета NMNH - та, что на самой монете: логотип, корона и свечи.
//
// Две чеканки под две темы: на светлой - белая монета с чёрным рисунком, на
// тёмной - чёрная с белым. Одна монета на обе темы терялась бы на одной из
// них: белая сливается со светлым листом, чёрная - с тёмным.

import { useTerminalTheme, type TerminalTheme } from "@/lib/terminalTheme";

export function coinSrc(theme: TerminalTheme): string {
  return theme === "light" ? "/coin/coin-light.webp" : "/coin/coin-dark.webp";
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
